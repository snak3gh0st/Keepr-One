export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getCurrentAgentAccess } from '@/lib/agent-access'
import { decimalToNumber } from '@/lib/decimal'
import { periodFromDate, shiftPeriod, percentChange } from '@/lib/period'
import {
  currentCarrierChargebackSnapshot,
  projectedPayableSnapshotForPeriod,
  sumByPeriod,
  toVisibleCarrierCommissionRecords,
  totalForPeriod,
  totalOf,
} from '@/lib/national-life/commission-records'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { Shell } from '@/components/Shell'
import { ErrorBanner } from '@/components/ErrorBanner'
import { policyStatusLabel } from '@/components/StatusPill'
import { TrendChart } from '@/components/TrendChart'
import {
  KeeprDashboardMotion,
} from '@/components/KeeprDashboardMotion'
import { OperationSignals, type OperationSignal } from '@/components/OperationSignals'
import { getAgentPromotionSnapshot } from '@/lib/agent-promotion'
import { getLocalPromotionPreview } from '@/lib/promotion-preview'
import { getPromotionIdentity, getPromotionJourney } from '@/lib/promotion-journey'
import { JourneyDashboardPreview } from './JourneyDashboardPreview'
import { COMMISSION_EARNING_GRID_KEYS } from '@/lib/national-life/commission-grid-keys'
import { FollowUpActionCard } from '@/components/crm/FollowUpActionCard'
import { getDueFollowUpsForScope, nyDayBounds, type DueFollowUpView } from '@/lib/crm'
import {
  getCalendarConnectionForUser,
  getTodayCalendarSummary,
  getUpcomingCalendarEvents,
} from '@/lib/calendar'
import { mapDomainCalendarConnectionToUi, mapDomainCalendarEventToUi } from '@/components/calendar/server-adapter'
import { TodayMeetingsSection } from '@/components/calendar/TodayMeetingsSection'
import { UpcomingMeetingsSection } from '@/components/calendar/UpcomingMeetingsSection'
import type { CalendarConnectionView, CalendarEventView, CalendarSourceView } from '@/components/calendar/types'

const NATIONAL_LIFE_DASHBOARD_FINANCIAL_GRID_KEYS = [
  ...COMMISSION_EARNING_GRID_KEYS,
  'PAYABLE_GROSS_COMMISSIONS',
  'PAID_COMMISSIONS',
] as const

function BreakdownList({
  title,
  rows,
}: {
  title: string
  rows: { label: string; count: number }[]
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="keepr-accordion-panel min-h-[280px] border-b border-border-steel/75 bg-paper/74 p-6 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 sm:p-7">
      <h3 className="text-lg font-medium tracking-[-0.025em] text-ink">{title}</h3>
      <ul className="mt-7 flex flex-col gap-4">
        {rows.slice(0, 5).map((row) => (
          <li key={row.label} className="group flex items-center gap-3 text-sm">
            <span className="w-24 shrink-0 truncate text-ink-muted">{row.label}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas-deep">
              <span
                className="block h-full origin-left rounded-full bg-teal transition-transform duration-700 ease-out group-hover:scale-x-105"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-ink">
              {row.count}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-ink-muted">Nenhum dado disponível ainda.</li>}
      </ul>
    </div>
  )
}

function PriorityRow({
  href,
  label,
  value,
  tone,
}: {
  href: string
  label: string
  value: number | null
  tone: 'mint' | 'amber' | 'danger'
}) {
  const toneClass =
    value === null || value === 0
      ? 'bg-canvas-deep text-ink-muted'
      : tone === 'danger'
        ? 'bg-danger-pale text-danger'
        : tone === 'amber'
          ? 'bg-gold-pale text-gold-ink'
          : 'bg-teal-pale text-teal-deep'

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-transparent px-3 py-3 transition-all duration-300 hover:border-border-steel hover:bg-paper"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-semibold tabular-nums ${toneClass}`}>
        {value ?? '—'}
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-ink">{label}</span>
      <span aria-hidden className="text-ink-muted transition-transform duration-300 group-hover:translate-x-1">→</span>
    </Link>
  )
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCurrencyNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatMonthName(period: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00.000Z`))
}

function formatMonthShort(period: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00.000Z`))
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return null
  const positive = value > 0
  const negative = value < 0
  const accessibleLabel = positive
    ? `Aumento de ${Math.abs(value).toFixed(0)} por cento`
    : negative
      ? `Queda de ${Math.abs(value).toFixed(0)} por cento`
      : 'Sem variação percentual'
  const toneClass = positive
    ? 'bg-success-pale text-success'
    : negative
      ? 'bg-danger-pale text-danger'
      : 'bg-white/10 text-paper/70'

  return (
    <span
      aria-label={accessibleLabel}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${toneClass}`}
    >
      <span aria-hidden>{positive ? '↗' : negative ? '↘' : '→'}</span>
      {Math.abs(value).toFixed(0)}%
    </span>
  )
}

function safeGroupCount(groupCount: unknown): number {
  if (groupCount && typeof groupCount === 'object' && '_all' in groupCount) {
    const countObj = groupCount as { _all?: number }
    return countObj._all ?? 0
  }
  return 0
}

export default async function AgentDashboard({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>
}) {
  const { preview } = await searchParams
  const localPromotionPreview = getLocalPromotionPreview(preview)
  const agent = await getCurrentAgent()
  const [user, access, promotion] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    getCurrentAgentAccess(),
    getAgentPromotionSnapshot(agent.id),
  ])
  const scope = access.scopeAgentIds
  const teamAgentIds = scope.filter((id) => id !== agent.id)

  const availablePromotion = localPromotionPreview
    ? {
        personalPc: localPromotionPreview.personalPc,
        agencyPc: localPromotionPreview.agencyPc,
        estimatedPersonalPc: 0,
        estimatedAgencyPc: 0,
        pendingPersonalPc: 0,
        pendingAgencyPc: 0,
        hasPromotionData: true,
        highestAchievementRankId: 'executive-vice-president',
        mode: localPromotionPreview.mode,
        loadError: false,
      }
    : {
        personalPc: promotion.personalPc,
        agencyPc: promotion.agencyPc,
        estimatedPersonalPc: promotion.estimatedPersonalPc,
        estimatedAgencyPc: promotion.estimatedAgencyPc,
        pendingPersonalPc: promotion.pendingPersonalPc,
        pendingAgencyPc: promotion.pendingAgencyPc,
        hasPromotionData: promotion.hasPromotionData,
        highestAchievementRankId: promotion.highestAchievement?.rankId ?? null,
        mode: promotion.mode,
        loadError: promotion.loadError,
      }
  // The legacy promotion entitlement is intentionally not an authorization
  // source for the platform plan. An individual subscriber can keep their
  // personal journey without receiving agency production or achievements.
  const displayedPromotion = access.canViewAgencyNationalLife
    ? availablePromotion
    : {
        ...availablePromotion,
        agencyPc: 0,
        estimatedAgencyPc: 0,
        pendingAgencyPc: 0,
        highestAchievementRankId:
          getPromotionJourney({
            personalPc: availablePromotion.personalPc,
            agencyPc: 0,
            mode: 'individual',
          }).currentRank?.id ?? null,
        mode: 'individual' as const,
      }
  const previewPromotionIdentity = localPromotionPreview
    ? getPromotionIdentity(
        getPromotionJourney({
          personalPc: displayedPromotion.personalPc,
          agencyPc: displayedPromotion.agencyPc,
          mode: displayedPromotion.mode,
        }),
      )
    : undefined
  const journeyHref = localPromotionPreview && access.canViewAgencyNationalLife
    ? `/agent/journey?preview=${encodeURIComponent(preview ?? '')}`
    : '/agent/journey'

  const now = new Date()
  const localConnectorEnabled = getNationalLifeLocalConnectorConfig().enabled
  const currentP = periodFromDate(now)
  const previousP = shiftPeriod(currentP, -1)
  const trendStartP = shiftPeriod(currentP, -5)
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  // Work-queue counters are restricted by the subscription access resolved on
  // the server. Individual subscribers receive only their own records.
  let openCases = 0
  let awaitingIllustration = 0
  let openRequirements = 0
  let dueFollowUps = 0
  let dueFollowUpItems: DueFollowUpView[] = []
  let dueReviews = 0
  let atRiskPolicies = 0
  let txnExpected = 0
  let txnPaid = 0
  let txnChargeback = 0
  let includesCarrierExpected = false
  let includesCarrierPaid = false
  let includesCarrierChargeback = false
  let calendarConnection: CalendarConnectionView = {
    status: 'DISCONNECTED', email: null, displayName: null, lastSyncAt: null, errorMessage: null,
  }
  let calendarSources: CalendarSourceView[] = []
  let todayMeetings: CalendarEventView[] = []
  let upcomingMeetings: CalendarEventView[] = []

  let policyCount = 0
  let commissionTotalAmount = 0
  let commissionThisMonth = 0
  let commissionLastMonth = 0
  let commissionByPeriod: { period: string; total: number }[] = []
  let byStatus: { status: string; _count: { _all: number } }[] = []
  let byCarrier: { carrier: string; _count: { _all: number } }[] = []
  let byProduct: { product: string; _count: { _all: number } }[] = []
  let loadError = false
  const commissionScopeWhere = {
    agentId: { in: scope },
    policy: { agentId: { in: scope } },
    ...(!access.canViewTeamData ? { type: 'DIRECT' as const } : {}),
  }

  try {
    const [
      policyTotal,
      commissionAgg,
      commissionThisMonthAgg,
      commissionLastMonthAgg,
      commissionPeriodBuckets,
      statusBuckets,
      carrierBuckets,
      productBuckets,
      openCasesCount,
      awaitingIllustrationCount,
      openRequirementsCount,
      atRiskCount,
      txnByType,
      dueFollowUpsResult,
      dueReviewCount,
    ] = await Promise.all([
      prisma.policy.count({ where: { agentId: { in: scope } } }),
      prisma.commissionRecord.aggregate({ where: commissionScopeWhere, _sum: { amount: true } }),
      prisma.commissionRecord.aggregate({ where: { ...commissionScopeWhere, period: currentP }, _sum: { amount: true } }),
      prisma.commissionRecord.aggregate({ where: { ...commissionScopeWhere, period: previousP }, _sum: { amount: true } }),
      prisma.commissionRecord.groupBy({
        by: ['period'],
        where: { ...commissionScopeWhere, period: { gte: trendStartP, lte: currentP } },
        _sum: { amount: true },
        orderBy: { period: 'asc' },
      }),
      prisma.policy.groupBy({
        by: ['status'],
        where: { agentId: { in: scope } },
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
      prisma.policy.groupBy({
        by: ['carrier'],
        where: { agentId: { in: scope } },
        _count: { _all: true },
        orderBy: { carrier: 'asc' },
      }),
      prisma.policy.groupBy({
        by: ['product'],
        where: { agentId: { in: scope } },
        _count: { _all: true },
        orderBy: { product: 'asc' },
      }),
      prisma.insuranceCase.count({ where: { assignedAgentId: { in: scope }, status: 'OPEN' } }),
      prisma.insuranceCase.count({
        where: {
          assignedAgentId: { in: scope },
          crmStage: { systemKey: { in: ['QUALIFIED', 'CREATE_ILLUSTRATION', 'RESCHEDULE_ILLUSTRATION'] } },
        },
      }),
      prisma.applicationRequirement.count({
        where: { status: 'OPEN', application: { insuranceCase: { assignedAgentId: { in: scope } } } },
      }),
      prisma.policy.count({ where: { agentId: { in: scope }, status: 'LAPSED' } }),
      prisma.commissionTransaction.groupBy({
        by: ['type'],
        where: {
          agentId: { in: scope },
          policy: { agentId: { in: scope } },
          occurredAt: { gte: currentMonthStart, lt: nextMonthStart },
        },
        _sum: { amount: true },
      }),
      getDueFollowUpsForScope(scope, now),
      prisma.policyReview.count({
        where: {
          completedAt: null,
          dueAt: { lt: nyDayBounds(now).end },
          policy: { agentId: { in: scope } },
        },
      }),
    ])

    openCases = openCasesCount
    awaitingIllustration = awaitingIllustrationCount
    openRequirements = openRequirementsCount
    atRiskPolicies = atRiskCount
    dueFollowUpItems = dueFollowUpsResult
    dueFollowUps = dueFollowUpsResult.length
    dueReviews = dueReviewCount
    for (const t of txnByType) {
      const sum = decimalToNumber(t._sum.amount)
      if (t.type === 'EXPECTED') txnExpected = sum
      else if (t.type === 'PAID') txnPaid = sum
      else if (t.type === 'CHARGEBACK') txnChargeback = sum
    }

    policyCount = policyTotal
    commissionTotalAmount = decimalToNumber(commissionAgg._sum.amount)
    commissionThisMonth = decimalToNumber(commissionThisMonthAgg._sum.amount)
    commissionLastMonth = decimalToNumber(commissionLastMonthAgg._sum.amount)
    commissionByPeriod = commissionPeriodBuckets.map((bucket) => ({
      period: bucket.period,
      total: decimalToNumber(bucket._sum.amount),
    }))

    // The carrier's commission lives in the integration's own table, not in
    // CommissionRecord: that model requires a policyId and fewer than half the
    // transactions match a policy still in the book. The commissions page has
    // always read it directly; this dashboard summed only CommissionRecord,
    // which is empty, so the same agent saw real commission on one page and
    // zero here. Both read the same source now.
    if (localConnectorEnabled) {
      const carrierRows = await prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: { in: scope },
          deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
          gridKey: { in: [...NATIONAL_LIFE_DASHBOARD_FINANCIAL_GRID_KEYS] },
        },
        select: {
          id: true,
          agentId: true,
          gridKey: true,
          raw: true,
          amounts: true,
          primaryDate: true,
          fetchedAt: true,
        },
      })
      const carrierCommissionRows = carrierRows.filter((row) =>
        COMMISSION_EARNING_GRID_KEYS.some((gridKey) => gridKey === row.gridKey),
      )
      const payableRows = carrierRows.filter((row) => row.gridKey === 'PAYABLE_GROSS_COMMISSIONS')
      const paidStatementRows = carrierRows.filter((row) => row.gridKey === 'PAID_COMMISSIONS')
      // The homepage headline is the authenticated agent's total commission,
      // not only direct production. Keep member direct production available to
      // entitled agency owners, but include overrides only from this agent's
      // own National Life session—the same tenant-safe rule as the statement.
      const carrierRecords = toVisibleCarrierCommissionRecords(carrierCommissionRows, agent.id)
      const carrierPaidThisMonth = totalForPeriod(carrierRecords, currentP)
      const projectedPayable = projectedPayableSnapshotForPeriod(payableRows, currentP)
      const chargebackBalance = currentCarrierChargebackSnapshot(paidStatementRows)

      commissionTotalAmount += totalOf(carrierRecords)
      commissionThisMonth += carrierPaidThisMonth
      commissionLastMonth += totalForPeriod(carrierRecords, previousP)
      txnExpected += projectedPayable.total
      txnPaid += carrierPaidThisMonth
      txnChargeback += chargebackBalance.total
      includesCarrierExpected = projectedPayable.rowCount > 0
      includesCarrierPaid = carrierRecords.some((record) => record.period === currentP)
      includesCarrierChargeback = chargebackBalance.rowCount > 0

      const merged = new Map(commissionByPeriod.map((bucket) => [bucket.period, bucket.total]))
      for (const bucket of sumByPeriod(carrierRecords, { from: trendStartP, to: currentP })) {
        merged.set(bucket.period, (merged.get(bucket.period) ?? 0) + bucket.total)
      }
      commissionByPeriod = [...merged.entries()]
        .map(([period, total]) => ({ period, total }))
        .sort((left, right) => left.period.localeCompare(right.period))
    }
    byStatus = statusBuckets
    byCarrier = carrierBuckets
    byProduct = productBuckets
  } catch (error) {
    console.error('AgentDashboard query error', error)
    loadError = true
  }

  try {
    const [calendarConnectionResult, todayCalendarResult, upcomingCalendarResult] = await Promise.all([
      getCalendarConnectionForUser(agent.userId),
      getTodayCalendarSummary({ ownerUserId: agent.userId, now, timeZone: user?.timeZone ?? 'America/New_York' }),
      getUpcomingCalendarEvents({ ownerUserId: agent.userId, now, timeZone: user?.timeZone ?? 'America/New_York' }),
    ])
    const mappedCalendar = mapDomainCalendarConnectionToUi(calendarConnectionResult)
    calendarConnection = mappedCalendar.connection
    calendarSources = mappedCalendar.calendars
    const calendarById = new Map(calendarSources.map((calendar) => [calendar.id, calendar]))
    const calendarEvents = [...todayCalendarResult.upcoming, ...upcomingCalendarResult]
    const meetingCaseIds = [...new Set(calendarEvents.map((event) => event.caseId).filter((caseId): caseId is string => Boolean(caseId)))]
    const meetingCases = meetingCaseIds.length ? await prisma.insuranceCase.findMany({
      where: { id: { in: meetingCaseIds }, assignedAgentId: agent.id },
      select: {
        id: true,
        prospect: { select: { firstName: true, lastName: true, email: true } },
        crmStage: { select: { name: true } },
      },
    }) : []
    const meetingCaseById = new Map(meetingCases.map((item) => [item.id, {
      id: item.id,
      name: `${item.prospect.firstName} ${item.prospect.lastName}`.trim(),
      email: item.prospect.email,
      stage: item.crmStage?.name ?? null,
    }]))
    todayMeetings = todayCalendarResult.upcoming.map((event) => mapDomainCalendarEventToUi(event, {
      timeZone: user?.timeZone ?? 'America/New_York',
      case: event.caseId ? meetingCaseById.get(event.caseId) ?? null : null,
      canWrite: calendarById.get(event.calendar.id)?.canWrite ?? false,
    }))
    upcomingMeetings = upcomingCalendarResult.map((event) => mapDomainCalendarEventToUi(event, {
      timeZone: user?.timeZone ?? 'America/New_York',
      case: event.caseId ? meetingCaseById.get(event.caseId) ?? null : null,
      canWrite: calendarById.get(event.calendar.id)?.canWrite ?? false,
    }))
  } catch (error) {
    console.error('AgentDashboard calendar query error', error)
  }

  const firstName = ((user?.name ?? '').trim() || 'Agente').split(/\s+/)[0]
  const commissionDelta = loadError ? null : percentChange(commissionThisMonth, commissionLastMonth)
  const currentMonthName = formatMonthName(currentP)
  const previousMonthName = formatMonthName(previousP)
  const currentPeriodLabel = `${formatMonthShort(currentP)} ${currentP.slice(0, 4)}`
  const commissionNumberValue = loadError ? '—' : formatCurrencyNumber(commissionThisMonth)
  const hasCommissionComparison = commissionDelta !== null && commissionLastMonth !== 0
  const hasNoPreviousCommissionValue = !loadError && commissionThisMonth > 0 && commissionLastMonth === 0
  const commissionTrendMap = new Map(commissionByPeriod.map((bucket) => [bucket.period, bucket.total]))
  const commissionTrend = Array.from({ length: 6 }, (_, index) => {
    const period = shiftPeriod(currentP, index - 5)
    return {
      label: formatMonthShort(period),
      tooltipLabel: new Intl.DateTimeFormat('pt-BR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${period}-01T00:00:00.000Z`)),
      value: commissionTrendMap.get(period) ?? 0,
    }
  })
  const moneyValue = (value: number) => loadError ? '—' : formatCurrency(value)
  const countValue = (value: number) => loadError ? '—' : String(value)
  const followUpsOverdue = dueFollowUpItems.filter((item) => item.overdue)
  const followUpsToday = dueFollowUpItems.filter((item) => !item.overdue)
  const pulseMetrics = [
    { label: 'Oportunidades ativas', value: countValue(openCases) },
    { label: 'Comissão esperada', value: moneyValue(txnExpected) },
    { label: 'Apólices', value: countValue(policyCount) },
    ...(access.canManageTeam
      ? [{ label: 'Equipe', value: countValue(teamAgentIds.length) }]
      : []),
    { label: 'Revisões', value: countValue(dueReviews) },
  ]
  const signals: OperationSignal[] = loadError ? [] : [
    {
      title: dueFollowUps > 0 ? `${dueFollowUps} retornos podem destravar seu pipeline hoje.` : 'Seu pipeline está pronto para a próxima oportunidade.',
      description: dueFollowUps > 0
        ? 'Comece pelos contatos que já chegaram ao prazo e transforme pendências em avanço real.'
        : 'A fila de contatos está em dia. Use o espaço para abrir uma nova oportunidade.',
      action: dueFollowUps > 0 ? 'Revisar retornos' : 'Novo atendimento',
      href: dueFollowUps > 0 ? '/agent/activities' : '/agent/cases/new',
      tone: 'mint',
    },
    {
      title: atRiskPolicies > 0 ? `${atRiskPolicies} apólices merecem atenção antes da próxima revisão.` : 'Sua carteira não apresenta alertas críticos.',
      description: atRiskPolicies > 0
        ? 'Revise os sinais de risco e planeje um contato proativo antes que a relação com o cliente esfrie.'
        : 'Mantenha o ritmo de acompanhamento para preservar retenção e confiança.',
      action: 'Abrir carteira',
      href: '/agent/policies',
      tone: 'amber',
    },
    {
      title: txnExpected > txnPaid ? 'Existe receita esperada pronta para acompanhamento.' : 'Sua produção está alinhada com os pagamentos registrados.',
      description: txnExpected > txnPaid
        ? `A diferença atual entre o esperado e o pago é de ${formatCurrency(Math.max(0, txnExpected - txnPaid))}.`
        : access.canManageTeam
          ? 'Use o extrato para acompanhar detalhes, repasses e movimentos da sua equipe.'
          : 'Use o extrato para acompanhar os detalhes e movimentos da sua produção.',
      action: 'Ver comissões',
      href: '/agent/commissions',
      tone: 'violet',
    },
  ]

  return (
    <Shell
      role="AGENT"
      userName={user?.name ?? ''}
      promotionIdentity={previewPromotionIdentity}
      journeyHref={journeyHref}
    >
      <KeeprDashboardMotion>
        {loadError && (
          <div className="mb-5">
            <ErrorBanner>
              Não foi possível carregar seus dados agora. Os números abaixo podem estar incompletos — tente atualizar a página.
            </ErrorBanner>
          </div>
        )}

        <section
          aria-labelledby="agent-financial-title"
          className="grid min-h-[520px] grid-flow-dense grid-cols-1 overflow-hidden rounded-[30px] bg-rail-strong text-paper shadow-[var(--shadow-overlay)] lg:grid-cols-12"
        >
          <article className="keepr-noise relative flex flex-col overflow-hidden p-7 sm:p-9 lg:col-span-8 lg:p-10">
            <div aria-hidden className="absolute -left-28 -top-32 h-96 w-96 rounded-full bg-mint/14 blur-3xl" />
            <div aria-hidden className="absolute -bottom-28 right-0 h-80 w-80 rounded-full bg-white/[0.035] blur-3xl" />

            <div className="relative flex h-full flex-col">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-4xl">
                  <p data-hero-reveal className="text-xs font-semibold uppercase tracking-[0.18em] text-mint">
                    Bom dia, {firstName}!
                  </p>
                  <h1
                    id="agent-financial-title"
                    data-hero-reveal
                    className="mt-4 max-w-4xl text-[clamp(2.35rem,4.1vw,4.35rem)] font-medium leading-[0.98] tracking-[-0.06em]"
                  >
                    Suas comissões de {currentMonthName}.
                  </h1>
                </div>
                <Link
                  data-hero-reveal
                  href="/agent/commissions"
                  className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-paper/78 transition-colors hover:bg-white hover:text-rail-strong"
                >
                  Ver extrato <span aria-hidden>↗</span>
                </Link>
              </div>

              <div data-hero-reveal className="mt-7">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/42">
                  Total registrado <span aria-hidden>·</span> USD
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
                  <p
                    aria-label={loadError ? 'Total de comissões indisponível' : `Total de ${formatCurrency(commissionThisMonth)} em comissões`}
                    className="flex items-start gap-2"
                  >
                    {!loadError && (
                      <span aria-hidden className="mt-[0.48em] text-[clamp(0.9rem,1.4vw,1.2rem)] font-semibold tracking-[0.14em] text-mint">
                        US$
                      </span>
                    )}
                    <span aria-hidden className="font-mono text-[clamp(3.5rem,6vw,6.25rem)] font-medium leading-[0.84] tracking-[-0.072em] tabular-nums">
                      {commissionNumberValue}
                    </span>
                  </p>

                  {hasCommissionComparison && (
                    <div className="pb-1 sm:pb-2">
                      <Delta value={commissionDelta} />
                      <p className="mt-2 text-xs text-paper/48">em relação a {previousMonthName}</p>
                    </div>
                  )}

                  {hasNoPreviousCommissionValue && (
                    <p className="pb-1 text-xs text-paper/48 sm:pb-2">
                      Sem valor registrado em {previousMonthName}
                    </p>
                  )}
                </div>
              </div>

              <div data-hero-reveal className="mt-7 rounded-[20px] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs font-medium text-paper/52">Comissões registradas · 6 meses</p>
                  <p className="font-mono text-xs text-paper/46">Período {currentPeriodLabel}</p>
                </div>
                <TrendChart
                  data={commissionTrend}
                  format="currency"
                  tone="onDark"
                  interactive
                  chartHeight={124}
                  ariaLabel="Comissões registradas nos últimos seis meses"
                />
              </div>

              <div data-hero-reveal className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">
                {[
                  {
                    label: 'Esperada',
                    value: txnExpected,
                    tone: 'text-paper',
                    detail: includesCarrierExpected ? 'Projetada pela National Life' : null,
                  },
                  {
                    label: 'Paga',
                    value: txnPaid,
                    tone: 'text-mint',
                    detail: includesCarrierPaid ? 'Líquida confirmada pela National Life' : null,
                  },
                  {
                    label: 'Chargebacks',
                    value: txnChargeback,
                    tone: 'text-[oklch(0.78_0.12_68)]',
                    detail: includesCarrierChargeback ? 'Saldo mais recente da National Life' : null,
                  },
                ].map((metric) => (
                  <div key={metric.label} className="bg-rail-strong/80 px-4 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/38">{metric.label}</p>
                    <p className={`mt-1.5 font-mono text-lg font-medium tabular-nums ${metric.tone}`}>{moneyValue(metric.value)}</p>
                    {metric.detail && <p className="mt-1 text-[10px] text-paper/38">{metric.detail}</p>}
                  </div>
                ))}
              </div>
            </div>
          </article>

          <aside data-hero-reveal className="relative flex flex-col border-t border-border-steel bg-[#f4f4f1] p-6 text-ink sm:p-7 lg:col-span-4 lg:border-l lg:border-t-0 lg:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">Sua fila</p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.035em] text-ink">Prioridades de hoje</h2>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rail-strong text-sm font-semibold text-paper">
                {loadError ? '—' : dueFollowUps + openRequirements + atRiskPolicies + dueReviews}
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-muted">
              Comece pelo que pode destravar resultado ou proteger sua carteira hoje.
            </p>
            <div className="mt-6 flex flex-col gap-1">
              <PriorityRow href="/agent/activities" label="Retornos pendentes" value={loadError ? null : dueFollowUps} tone="danger" />
              <PriorityRow href="/agent/activities" label="Pendências abertas" value={loadError ? null : openRequirements} tone="amber" />
              <PriorityRow href="/agent/policies" label="Apólices em risco" value={loadError ? null : atRiskPolicies} tone="danger" />
              <PriorityRow href="/agent/policies" label="Revisões anuais" value={loadError ? null : dueReviews} tone="mint" />
            </div>
            <Link href="/agent/activities" className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-rail-strong px-4 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5">
              Abrir fila completa
            </Link>
          </aside>
        </section>

        {!loadError && (
          <TodayMeetingsSection
            connection={calendarConnection}
            calendars={calendarSources}
            events={todayMeetings}
            timeZone={user?.timeZone ?? 'America/New_York'}
          />
        )}

        {!loadError && (
          <UpcomingMeetingsSection
            calendars={calendarSources}
            events={upcomingMeetings}
            timeZone={user?.timeZone ?? 'America/New_York'}
          />
        )}

        {!loadError && dueFollowUpItems.length > 0 && (
          <section
            aria-labelledby="today-follow-ups-title"
            className="mt-6 overflow-hidden rounded-[28px] border border-border-steel bg-paper/68 p-5 shadow-[var(--shadow-soft)] sm:p-7"
            data-stack-card
          >
            <div className="flex flex-col gap-3 border-b border-border-steel/75 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-deep">Agenda acionável</p>
                <h2 id="today-follow-ups-title" className="mt-2 max-w-4xl text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">
                  Seus contatos de hoje, prontos para avançar.
                </h2>
              </div>
              <Link href="/agent/activities#follow-ups" className="inline-flex min-h-10 w-fit items-center rounded-full border border-border-steel bg-paper px-4 text-xs font-semibold text-ink transition-colors hover:border-teal/35 hover:bg-teal-pale">
                Ver agenda completa <span aria-hidden className="ml-1.5">↗</span>
              </Link>
            </div>

            <div className="mt-5 grid grid-flow-dense gap-5 lg:grid-cols-2">
              {followUpsOverdue.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-ink">Follow-ups atrasados</h3>
                    <span className="rounded-full bg-danger-pale px-2.5 py-1 font-mono text-[10px] font-semibold text-danger">
                      {followUpsOverdue.length}
                    </span>
                  </div>
                  <div className="grid gap-2.5">
                    {followUpsOverdue.slice(0, 3).map((item) => (
                      <FollowUpActionCard key={item.id} item={item} compact />
                    ))}
                  </div>
                </div>
              )}

              {followUpsToday.length > 0 && (
                <div className={followUpsOverdue.length === 0 ? "lg:col-span-2" : undefined}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-ink">Follow-ups de hoje</h3>
                    <span className="rounded-full bg-teal-pale px-2.5 py-1 font-mono text-[10px] font-semibold text-teal-deep">
                      {followUpsToday.length}
                    </span>
                  </div>
                  <div className={`grid gap-2.5 ${followUpsOverdue.length === 0 ? "md:grid-cols-2" : ""}`}>
                    {followUpsToday.slice(0, followUpsOverdue.length === 0 ? 4 : 3).map((item) => (
                      <FollowUpActionCard key={item.id} item={item} compact />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <div className="keepr-marquee-mask mt-6 overflow-hidden border-y border-border-steel/70 bg-paper/56 py-3.5">
          <div className="keepr-marquee-track flex items-center">
            {[...pulseMetrics, ...pulseMetrics].map((metric, index) => (
              <div key={`${metric.label}-${index}`} className="flex shrink-0 items-center gap-3 px-7">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{metric.label}</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-ink">{metric.value}</span>
              </div>
            ))}
          </div>
        </div>

        <JourneyDashboardPreview
          personalPc={displayedPromotion.personalPc}
          agencyPc={displayedPromotion.agencyPc}
          estimatedPersonalPc={displayedPromotion.estimatedPersonalPc}
          estimatedAgencyPc={displayedPromotion.estimatedAgencyPc}
          pendingPersonalPc={displayedPromotion.pendingPersonalPc}
          pendingAgencyPc={displayedPromotion.pendingAgencyPc}
          hasPromotionData={displayedPromotion.hasPromotionData}
          windowStart={promotion.windowStart}
          windowEnd={promotion.windowEnd}
          highestAchievementRankId={displayedPromotion.highestAchievementRankId}
          mode={displayedPromotion.mode}
          loadError={displayedPromotion.loadError}
          journeyHref={journeyHref}
        />

        <section aria-label="Resumo da operação" className="mt-12 grid grid-flow-dense grid-cols-1 gap-4 lg:grid-cols-12">
          <Link href="/agent/cases" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -bottom-20 -right-12 h-52 w-52 rounded-full bg-teal-pale transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">Pipeline</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(openCases)}</p>
                <p className="mt-2 text-sm text-ink-muted">oportunidades ativas em andamento</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">{countValue(awaitingIllustration)} aguardando ilustração</span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
          </Link>

          <Link href="/agent/policies" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-pale transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">Carteira</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(policyCount)}</p>
                <p className="mt-2 text-sm text-ink-muted">apólices sob seu cuidado</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">{countValue(atRiskPolicies)} sinais de risco</span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
          </Link>

          {access.canManageTeam ? (
            <Link href="/agent/hierarchy" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
              <div aria-hidden className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-[oklch(0.91_0.045_286)] transition-transform duration-700 ease-out group-hover:scale-105" />
              <div className="relative flex h-full flex-col justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">Rede</p>
                  <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(teamAgentIds.length)}</p>
                  <p className="mt-2 text-sm text-ink-muted">agentes conectados à sua estrutura</p>
                </div>
                <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                  <span className="text-ink-muted">{moneyValue(commissionTotalAmount)} em comissões</span>
                  <span aria-hidden className="text-ink">↗</span>
                </div>
              </div>
            </Link>
          ) : null}
        </section>

        <section className="py-24 sm:py-32" aria-labelledby="portfolio-panorama-title">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-teal-deep">Leitura da carteira</p>
              <h2 id="portfolio-panorama-title" className="mt-3 max-w-4xl text-3xl font-medium tracking-[-0.045em] text-ink sm:text-5xl">
                Panorama sem ruído.
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-ink-muted">
              Passe o cursor para aprofundar cada recorte e identificar onde sua carteira está concentrada.
            </p>
          </div>
          <div className="keepr-card flex flex-col overflow-hidden rounded-[28px] md:flex-row" data-stack-card>
            <BreakdownList
              title="Por status"
              rows={byStatus.map((s) => ({ label: policyStatusLabel[s.status] ?? s.status, count: safeGroupCount(s._count) }))}
            />
            <BreakdownList
              title="Por carrier"
              rows={byCarrier.map((c) => ({ label: c.carrier, count: safeGroupCount(c._count) }))}
            />
            <BreakdownList
              title="Por produto"
              rows={byProduct.map((p) => ({ label: p.product, count: safeGroupCount(p._count) }))}
            />
          </div>
        </section>

        <OperationSignals signals={signals} />

        <section className="py-24 sm:py-32">
          <div className="relative overflow-hidden rounded-[32px] bg-mint p-8 text-rail-strong sm:p-12 lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div aria-hidden className="absolute -right-12 -top-20 h-64 w-64 rounded-full border-[42px] border-rail-strong/8" />
            <div className="relative max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-rail-strong/55">Mantenha o ritmo</p>
              <h2 className="mt-4 max-w-5xl text-3xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl">
                A próxima oportunidade pode começar agora.
              </h2>
            </div>
            <Link href="/agent/cases/new" className="relative mt-8 inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-rail-strong px-6 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-1 lg:mt-0">
              Novo atendimento
            </Link>
          </div>
        </section>
      </KeeprDashboardMotion>
    </Shell>
  )
}
