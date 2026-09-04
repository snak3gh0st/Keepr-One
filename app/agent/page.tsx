export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getCurrentAgentAccess } from '@/lib/agent-access'
import { decimalToNumber } from '@/lib/decimal'
import { loadCurrentNationalLifePortfolio } from '@/lib/national-life/current-portfolio-prisma'
import { buildPremiumEvolution } from '@/lib/national-life/premium-evolution'
import { NationalPremiumEvolution } from '@/components/NationalPremiumEvolution'
import { loadNationalPolicyQueues } from '@/lib/national-life/policy-queues-prisma'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { Shell } from '@/components/Shell'
import { ErrorBanner } from '@/components/ErrorBanner'
import {
  KeeprDashboardMotion,
} from '@/components/KeeprDashboardMotion'
import { OperationSignals, type OperationSignal } from '@/components/OperationSignals'
import { getAgentPromotionSnapshot } from '@/lib/agent-promotion'
import { getLocalPromotionPreview } from '@/lib/promotion-preview'
import { getPromotionIdentity, getPromotionJourney } from '@/lib/promotion-journey'
import { JourneyDashboardPreview } from './JourneyDashboardPreview'
import { FollowupWorkspace } from './kbot/FollowupWorkspace'
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
import { getServerI18n } from '@/lib/i18n/server'
import { formatCurrency as formatLocalizedCurrency, formatNumber } from '@/lib/i18n/format'
import type { UserLanguage } from '@/lib/i18n/config'
import {
  buildNationalLifePortfolioMetrics,
  type NationalLifePortfolioMetrics,
} from '@/lib/policy-metrics'
import type { PlatformModuleName } from '@/lib/platform-modules'

function BreakdownList({
  title,
  rows,
  emptyLabel,
}: {
  title: string
  rows: { label: string; count: number }[]
  emptyLabel: string
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
        {rows.length === 0 && <li className="text-sm text-ink-muted">{emptyLabel}</li>}
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

function formatCurrency(value: number, language: UserLanguage): string {
  return formatLocalizedCurrency(value, language, 'USD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function safeGroupCount(groupCount: unknown): number {
  if (groupCount && typeof groupCount === 'object' && '_all' in groupCount) {
    const countObj = groupCount as { _all?: number }
    return countObj._all ?? 0
  }
  return 0
}

function isPlatformModuleEnabled(
  enabledModules: readonly PlatformModuleName[] | null,
  module: PlatformModuleName,
): boolean {
  return enabledModules === null || enabledModules.includes(module)
}

export default async function AgentDashboard({
  searchParams,
}: {
  searchParams: Promise<{
    preview?: string
    onboarding?: string
    premiumRange?: string
    premiumProduct?: string
    premiumView?: string
  }>
}) {
  const params = await searchParams
  const { preview, onboarding } = params
  const { copy, language } = await getServerI18n()
  const locale = language === 'PT' ? 'pt-BR' : 'en-US'
  const agent = await getCurrentAgent()
  const [user, access] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    getCurrentAgentAccess(),
  ])
  const hasModule = (module: PlatformModuleName) =>
    isPlatformModuleEnabled(access.enabledModules, module)
  const canUseCalendar = hasModule('CALENDAR')
  const canUseCrm = hasModule('CRM')
  const canUsePolicies = hasModule('POLICIES')
  const canUseIllustrations = hasModule('ILLUSTRATIONS')
  const canUseJourney = hasModule('JOURNEY')
  const canUseTeam = hasModule('TEAM') && access.canManageTeam
  const hasPriorityQueue = canUseCrm || canUsePolicies
  const promotion = canUseJourney
    ? await getAgentPromotionSnapshot(agent.id)
    : null
  const localPromotionPreview = canUseJourney
    ? getLocalPromotionPreview(preview)
    : null
  const scope = access.scopeAgentIds
  const teamAgentIds = scope.filter((id) => id !== agent.id)

  const availablePromotion = promotion
    ? localPromotionPreview
      ? {
        personalPc: localPromotionPreview.personalPc,
        agencyPc: localPromotionPreview.agencyPc,
        estimatedPersonalPc: 0,
        estimatedAgencyPc: 0,
        pendingPersonalPc: 0,
        pendingAgencyPc: 0,
        hasPromotionData: true,
        ledgerReady: true,
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
        ledgerReady: promotion.ledgerReady,
        highestAchievementRankId: promotion.highestAchievement?.rankId ?? null,
        mode: promotion.mode,
        loadError: promotion.loadError,
      }
    : null
  // The legacy promotion entitlement is intentionally not an authorization
  // source for the platform plan. An individual subscriber can keep their
  // personal journey without receiving agency production or achievements.
  const displayedPromotion = availablePromotion
    ? access.canViewAgencyNationalLife
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
    : null
  const previewPromotionIdentity = localPromotionPreview && displayedPromotion
    ? getPromotionIdentity(
        getPromotionJourney({
          personalPc: displayedPromotion.personalPc,
          agencyPc: displayedPromotion.agencyPc,
          mode: displayedPromotion.mode,
        }),
      )
    : undefined
  const journeyHref = canUseJourney && localPromotionPreview && access.canViewAgencyNationalLife
    ? `/agent/journey?preview=${encodeURIComponent(preview ?? '')}`
    : '/agent/journey'

  const now = new Date()
  const localConnectorEnabled = getNationalLifeLocalConnectorConfig().enabled

  // Work-queue counters are restricted by the subscription access resolved on
  // the server. Individual subscribers receive only their own records.
  let openCases = 0
  let awaitingIllustration = 0
  let openRequirements = 0
  let dueFollowUps = 0
  let dueFollowUpItems: DueFollowUpView[] = []
  let dueReviews = 0
  let atRiskPolicies = 0
  let calendarConnection: CalendarConnectionView = {
    status: 'DISCONNECTED', email: null, displayName: null, lastSyncAt: null, errorMessage: null,
  }
  let calendarSources: CalendarSourceView[] = []
  let todayMeetings: CalendarEventView[] = []
  let upcomingMeetings: CalendarEventView[] = []

  let policyCount = 0
  let portfolioMetrics: NationalLifePortfolioMetrics = buildNationalLifePortfolioMetrics([])
  let historicalPolicies = 0
  let portfolioVerified = false
  let premiumEvolution = buildPremiumEvolution({ rows: [], observedAt: null, verified: false })
  let nationalQueueCounts: { ENTER_INFORCE: number; WAITING_AGENT: number; WAITING_CLIENT: number } | null = null
  let capturedTargetPremium = 0
  let targetPremiumKnownCount = 0
  let byStatus: { status: string; _count: { _all: number } }[] = []
  let byCarrier: { carrier: string; _count: { _all: number } }[] = []
  let byProduct: { product: string; _count: { _all: number } }[] = []
  let loadError = false

  try {
    const [
      policyTotal,
      nationalPolicyRows,
      targetPremiumSnapshot,
      statusBuckets,
      carrierBuckets,
      productBuckets,
      openCasesCount,
      awaitingIllustrationCount,
      openRequirementsCount,
      dueFollowUpsResult,
      dueReviewCount,
    ] = await Promise.all([
      canUsePolicies
        ? prisma.policy.count({ where: { agentId: { in: scope } } })
        : 0,
      canUsePolicies
        ? loadCurrentNationalLifePortfolio(prisma, scope)
        : { rows: [], storedPolicies: 0, historicalPolicies: 0, verified: false, statusCounts: [], productCounts: [], premiumEvolutionRows: [], observedAt: null },
      canUsePolicies
        ? prisma.nationalLifePolicyDetailSnapshot.aggregate({
            where: {
              agentId: { in: scope },
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              ctp: { gt: 0 },
              policy: { status: 'INFORCE', sourceProvider: 'NATIONAL_LIFE' },
            },
            _count: { ctp: true },
            _sum: { ctp: true },
          })
        : { _count: { ctp: 0 }, _sum: { ctp: null } },
      canUsePolicies
        ? prisma.policy.groupBy({
            by: ['status'],
            where: { agentId: { in: scope } },
            _count: { _all: true },
            orderBy: { status: 'asc' },
          })
        : [],
      canUsePolicies
        ? prisma.policy.groupBy({
            by: ['carrier'],
            where: { agentId: { in: scope } },
            _count: { _all: true },
            orderBy: { carrier: 'asc' },
          })
        : [],
      canUsePolicies
        ? prisma.policy.groupBy({
            by: ['product'],
            where: { agentId: { in: scope } },
            _count: { _all: true },
            orderBy: { product: 'asc' },
          })
        : [],
      canUseCrm
        ? prisma.insuranceCase.count({ where: { assignedAgentId: { in: scope }, status: 'OPEN' } })
        : 0,
      canUseCrm && canUseIllustrations
        ? prisma.insuranceCase.count({
            where: {
              assignedAgentId: { in: scope },
              crmStage: { systemKey: { in: ['QUALIFIED', 'CREATE_ILLUSTRATION', 'RESCHEDULE_ILLUSTRATION'] } },
            },
          })
        : 0,
      canUseCrm
        ? prisma.applicationRequirement.count({
            where: { status: 'OPEN', application: { insuranceCase: { assignedAgentId: { in: scope } } } },
          })
        : 0,
      canUseCrm ? getDueFollowUpsForScope(scope, now) : [],
      canUsePolicies
        ? prisma.policyReview.count({
            where: {
              completedAt: null,
              dueAt: { lt: nyDayBounds(now).end },
              policy: { agentId: { in: scope } },
            },
          })
        : 0,
    ])

    openCases = openCasesCount
    awaitingIllustration = awaitingIllustrationCount
    openRequirements = openRequirementsCount
    dueFollowUpItems = dueFollowUpsResult
    dueFollowUps = dueFollowUpsResult.length
    dueReviews = dueReviewCount

    policyCount = policyTotal
    targetPremiumKnownCount = targetPremiumSnapshot._count.ctp
    capturedTargetPremium = decimalToNumber(targetPremiumSnapshot._sum.ctp)
    portfolioMetrics = buildNationalLifePortfolioMetrics(nationalPolicyRows.rows)
    historicalPolicies = nationalPolicyRows.historicalPolicies
    portfolioVerified = nationalPolicyRows.verified
    premiumEvolution = buildPremiumEvolution({ rows: nationalPolicyRows.premiumEvolutionRows ?? [],
      observedAt: nationalPolicyRows.observedAt ?? null, verified: portfolioVerified,
      range: params.premiumRange, product: params.premiumProduct, view: params.premiumView })
    atRiskPolicies = portfolioMetrics.attentionPolicies
    byStatus = statusBuckets
    byCarrier = carrierBuckets
    byProduct = productBuckets
    if (portfolioVerified && policyCount === nationalPolicyRows.storedPolicies) {
      policyCount = nationalPolicyRows.rows.length
      byStatus = nationalPolicyRows.statusCounts.map((row) => ({ status: row.status, _count: { _all: row.count } }))
      byCarrier = [{ carrier: 'National Life Group', _count: { _all: nationalPolicyRows.rows.length } }]
      byProduct = nationalPolicyRows.productCounts.map((row) => ({ product: row.product, _count: { _all: row.count } }))
    }
  } catch (error) {
    console.error('AgentDashboard query error', error)
    loadError = true
  }

  if (canUsePolicies) {
    try {
      const queueResult = await loadNationalPolicyQueues(prisma, scope)
      if (queueResult.verified) nationalQueueCounts = queueResult.counts
    } catch (error) {
      console.error('National policy queue query error', error)
    }
  }

  if (canUseCalendar) {
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
      const meetingCases = canUseCrm && meetingCaseIds.length ? await prisma.insuranceCase.findMany({
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
  }

  const firstName = ((user?.name ?? '').trim() || copy('Agente', 'Agent')).split(/\s+/)[0]
  const countValue = (value: number) => loadError ? '—' : formatNumber(value, language, { maximumFractionDigits: 0 })
  const hasPortfolioData = canUsePolicies && portfolioMetrics.hasData && !loadError
  const capturedTargetPremiumValue = hasPortfolioData && targetPremiumKnownCount > 0
    ? formatLocalizedCurrency(capturedTargetPremium, language, 'USD', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—'
  const activeAapValue = hasPortfolioData && portfolioMetrics.premiumCoverageComplete
    ? formatCurrency(portfolioMetrics.activeAap, language)
    : '—'
  const averageAapValue = hasPortfolioData && portfolioMetrics.averageAapPerClient !== null
    ? formatCurrency(portfolioMetrics.averageAapPerClient, language)
    : '—'
  const atRiskAapValue = hasPortfolioData && portfolioMetrics.atRiskPremiumCoverageComplete
    ? formatCurrency(portfolioMetrics.atRiskAap, language)
    : '—'
  const portfolioUpdatedLabel = portfolioMetrics.lastUpdatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(portfolioMetrics.lastUpdatedAt)
    : null
  const followUpsOverdue = dueFollowUpItems.filter((item) => item.overdue)
  const followUpsToday = dueFollowUpItems.filter((item) => !item.overdue)
  const localizedPolicyStatusLabel: Record<string, string> = {
    INFORCE: copy('Em vigor', 'In force'),
    APPROVED: copy('Aprovada', 'Approved'),
    PENDING: copy('Pendente', 'Pending'),
    LAPSED: copy('Lapsada', 'Lapsed'),
    CANCELLED: copy('Cancelada', 'Cancelled'),
  }
  const pulseMetrics = [
    ...(canUseCrm
      ? [{ label: copy('Oportunidades ativas', 'Active opportunities'), value: countValue(openCases) }]
      : []),
    ...(canUsePolicies
      ? [
          { label: copy('Clientes ativos conciliados', 'Reconciled active clients'), value: hasPortfolioData ? countValue(portfolioMetrics.activeClients) : '—' },
          { label: copy('Apólices ativas', 'Active policies'), value: hasPortfolioData ? countValue(portfolioMetrics.activePolicies) : '—' },
          { label: copy('Prêmio anual previsto · ativos', 'Expected annual premium · active'), value: activeAapValue },
          { label: copy('Prêmio anual em risco', 'Annual premium at risk'), value: atRiskAapValue },
          { label: copy('Revisões', 'Reviews'), value: countValue(dueReviews) },
        ]
      : []),
    ...(canUseTeam
      ? [{ label: copy('Equipe', 'Team'), value: countValue(teamAgentIds.length) }]
      : []),
  ]
  const signals: OperationSignal[] = []
  if (!loadError && canUseCrm) {
    signals.push({
      title: dueFollowUps > 0
        ? copy(
            `${formatNumber(dueFollowUps, language)} retornos podem destravar seu funil hoje.`,
            `${formatNumber(dueFollowUps, language)} follow-ups can unlock your pipeline today.`,
          )
        : copy('Seu funil está pronto para a próxima oportunidade.', 'Your pipeline is ready for the next opportunity.'),
      description: dueFollowUps > 0
        ? copy(
            'Comece pelos contatos que já chegaram ao prazo e transforme pendências em avanço real.',
            'Start with the contacts that are already due and turn pending work into real progress.',
          )
        : copy(
            'A fila de contatos está em dia. Use o espaço para abrir uma nova oportunidade.',
            'Your contact queue is up to date. Use the extra room to open a new opportunity.',
          ),
      action: dueFollowUps > 0 ? copy('Revisar retornos', 'Review follow-ups') : copy('Novo atendimento', 'New case'),
      href: dueFollowUps > 0 ? '/agent/activities' : '/agent/cases/new',
      tone: 'mint',
    })
  }
  if (!loadError && canUsePolicies) {
    signals.push({
      title: portfolioMetrics.attentionPolicies > 0
        ? copy(
            `${formatNumber(portfolioMetrics.attentionPolicies, language)} apólices pedem uma ação de retenção.`,
            `${formatNumber(portfolioMetrics.attentionPolicies, language)} policies need a retention action.`,
          )
        : copy('Sua carteira não apresenta alertas críticos.', 'Your book has no critical alerts.'),
      description: portfolioMetrics.attentionPolicies > 0
        ? copy(
            `${portfolioMetrics.pendingLapsePolicies} Pending Lapse, ${portfolioMetrics.lapsedPolicies} Lapsed e ${portfolioMetrics.cancelledPolicies} Canceled foram organizadas pelo K-Bot.`,
            `${portfolioMetrics.pendingLapsePolicies} Pending Lapse, ${portfolioMetrics.lapsedPolicies} Lapsed, and ${portfolioMetrics.cancelledPolicies} Canceled were organized by K-Bot.`,
          )
        : copy(
            'Mantenha o ritmo de acompanhamento para preservar retenção e confiança.',
            'Keep up your follow-up rhythm to preserve retention and trust.',
          ),
      action: copy('Abrir carteira', 'Open book'),
      href: '/agent/policies',
      tone: 'amber',
    })
  }

  return (
    <Shell
      role="AGENT"
      userName={user?.name ?? ''}
      promotionIdentity={previewPromotionIdentity}
      journeyHref={journeyHref}
      kbotWelcome={onboarding === 'completed'}
    >
      <KeeprDashboardMotion>
        {process.env.KBOT_FOLLOWUP_ENABLED === 'true' && <FollowupWorkspace compact />}
        {loadError && (
          <div className="mb-5">
            <ErrorBanner>
              {copy(
                'Não foi possível carregar seus dados agora. Os números abaixo podem estar incompletos — tente atualizar a página.',
                'We could not load your data right now. The numbers below may be incomplete — try refreshing the page.',
              )}
            </ErrorBanner>
          </div>
        )}

        <section
          aria-labelledby="agent-today-title"
          className="grid min-h-[520px] grid-flow-dense grid-cols-1 overflow-hidden rounded-[30px] bg-rail-strong text-paper shadow-[var(--shadow-overlay)] lg:grid-cols-12"
        >
          <article className={`keepr-noise relative flex flex-col overflow-hidden p-7 sm:p-9 lg:p-10 ${hasPriorityQueue ? 'lg:col-span-8' : 'lg:col-span-12'}`}>
            <div aria-hidden className="absolute -left-28 -top-32 h-96 w-96 rounded-full bg-mint/14 blur-3xl" />
            <div aria-hidden className="absolute -bottom-28 right-0 h-80 w-80 rounded-full bg-white/[0.035] blur-3xl" />

            <div className="relative flex h-full flex-col">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-4xl">
                  <p data-hero-reveal className="text-xs font-semibold uppercase tracking-[0.18em] text-mint">
                    {copy(`Bom dia, ${firstName}!`, `Good morning, ${firstName}!`)}
                  </p>
                  <h1
                    id="agent-today-title"
                    data-hero-reveal
                    className="mt-4 max-w-4xl text-[clamp(2.35rem,4.1vw,4.35rem)] font-medium leading-[0.98] tracking-[-0.06em]"
                  >
                    {canUsePolicies
                      ? copy('Sua carteira, sob controle.', 'Your book, under control.')
                      : copy('Seu dia começa com clareza.', 'Start your day with clarity.')}
                  </h1>
                </div>
                {canUsePolicies ? (
                  <Link
                    data-hero-reveal
                    href="/agent/integrations/national-life"
                    className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-paper/78 transition-colors hover:bg-white hover:text-rail-strong"
                  >
                    {copy('Gerenciar K-Bot', 'Manage K-Bot')} <span aria-hidden>↗</span>
                  </Link>
                ) : canUseJourney ? (
                  <Link
                    data-hero-reveal
                    href={journeyHref}
                    className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-paper/78 transition-colors hover:bg-white hover:text-rail-strong"
                  >
                    {copy('Ver jornada', 'View journey')} <span aria-hidden>↗</span>
                  </Link>
                ) : null}
              </div>

              {canUsePolicies ? (
                <div className="mt-7 flex flex-1 flex-col">
                  <div data-hero-reveal className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <p className="max-w-2xl text-sm leading-6 text-paper/62">
                      {copy(
                        'O K-Bot lê a National Life, organiza sua carteira e mostra o que precisa da sua atenção.',
                        'K-Bot reads National Life, organizes your book, and shows what needs your attention.',
                      )}
                    </p>
                    <p className="shrink-0 font-mono text-[11px] text-paper/42">
                      {portfolioUpdatedLabel
                        ? copy(`National atualizada em ${portfolioUpdatedLabel}`, `National Life updated ${portfolioUpdatedLabel}`)
                        : copy('Aguardando a primeira leitura da National', 'Waiting for the first National Life read')}
                    </p>
                  </div>

                  {hasPortfolioData ? (
                    <>
                      <div data-hero-reveal className="mt-6 rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/42">
                          {copy('Target Premium capturado', 'Captured Target Premium')}
                        </p>
                        <p className="mt-2 text-lg font-medium text-mint">
                          {copy('Total da carteira em apuração', 'Book total pending reconciliation')}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-paper/48">
                          {targetPremiumKnownCount > 0
                            ? copy(
                                `${capturedTargetPremiumValue} é apenas o subtotal de ${targetPremiumKnownCount} detalhes capturados, não o total das ${portfolioMetrics.activePolicies} apólices ativas.`,
                                `${capturedTargetPremiumValue} is only the subtotal of ${targetPremiumKnownCount} captured details, not the total of ${portfolioMetrics.activePolicies} active policies.`,
                              )
                            : copy(
                                'CTP ainda não capturado nos detalhes da National. Ausência de dados não significa Target Premium zero.',
                                'CTP has not yet been captured from National Life policy details. Missing data does not mean zero Target Premium.',
                              )}
                        </p>
                        <p className="mt-1 text-[10px] leading-4 text-paper/38">
                          {copy(
                            'NPN é opcional. PC confirmado permanece separado e depende da evidência de pagamento da National.',
                            'NPN is optional. Confirmed PC remains separate and requires National Life payment evidence.',
                          )}
                        </p>
                      </div>
                      {portfolioVerified && (
                        <p className="mt-4 text-xs leading-5 text-paper/48">
                          {copy('Prêmio anual previsto e status: última exportação completa da National, sem repetir apólices.', 'Expected annual premium and status: latest complete National Life export, counting each policy once.')}
                          {historicalPolicies > 0 && copy(
                            ` ${historicalPolicies} registros históricos fora desta exportação foram preservados e não entram nos totais atuais.`,
                            ` ${historicalPolicies} historical records absent from this export were retained and are excluded from current totals.`,
                          )}
                        </p>
                      )}
                      <div data-hero-reveal className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          {
                            label: copy('Clientes ativos conciliados', 'Reconciled active clients'),
                            display: countValue(portfolioMetrics.activeClients),
                            tone: 'text-paper',
                            detail: portfolioMetrics.clientCoverageComplete
                              ? copy(`${portfolioMetrics.activePolicies} apólices em vigor`, `${portfolioMetrics.activePolicies} in-force policies`)
                              : copy(
                                  `${portfolioMetrics.clientMissingPolicies} apólices aguardam vínculo de cliente`,
                                  `${portfolioMetrics.clientMissingPolicies} policies await client reconciliation`,
                                ),
                          },
                          {
                            label: copy('Apólices ativas', 'Active policies'),
                            display: countValue(portfolioMetrics.activePolicies),
                            tone: 'text-mint',
                            detail: portfolioMetrics.pendingLapsePolicies > 0
                              ? copy(
                                  `${portfolioMetrics.pendingLapsePolicies} aguardando retenção`,
                                  `${portfolioMetrics.pendingLapsePolicies} awaiting retention`,
                                )
                              : copy('Nenhum Pending Lapse', 'No Pending Lapse'),
                          },
                          {
                            label: copy('Prêmio anual previsto · ativos', 'Expected annual premium · active'),
                            display: activeAapValue,
                            tone: 'text-mint',
                            detail: copy(
                              `${portfolioMetrics.premiumKnownPolicies}/${portfolioMetrics.activePolicies} apólices com prêmio anual informado`,
                              `${portfolioMetrics.premiumKnownPolicies}/${portfolioMetrics.activePolicies} policies with annual premium data`,
                            ),
                          },
                          {
                            label: copy('Prêmio anual médio por cliente', 'Average annual premium per client'),
                            display: averageAapValue,
                            tone: 'text-[oklch(0.82_0.12_85)]',
                            detail: !portfolioMetrics.clientCoverageComplete
                              ? copy('Conciliação de clientes em andamento', 'Client reconciliation in progress')
                              : portfolioMetrics.premiumCoverageComplete
                              ? copy('prêmio anual previsto por cliente ativo', 'expected annual premium per active client')
                              : copy(
                                  `Falta o prêmio anual em ${portfolioMetrics.premiumMissingPolicies} apólices`,
                                  `Annual premium data is missing for ${portfolioMetrics.premiumMissingPolicies} policies`,
                                ),
                          },
                        ].map((metric) => (
                          <div key={metric.label} className="bg-rail-strong/80 px-4 py-4">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/38">{metric.label}</p>
                            <p className={`mt-2 font-mono text-xl font-medium tabular-nums ${metric.tone}`}>{metric.display}</p>
                            <p className="mt-1 text-[10px] leading-4 text-paper/38">{metric.detail}</p>
                          </div>
                        ))}
                      </div>
                      <div data-hero-reveal className="mt-4 grid gap-2 sm:grid-cols-3">
                        {[
                          { key: 'ENTER_INFORCE', label: copy('A entrar em vigor', 'Entering in force'), tone: 'text-mint' },
                          { key: 'WAITING_AGENT', label: copy('Aguardando agente', 'Waiting on agent'), tone: 'text-amber-300' },
                          { key: 'WAITING_CLIENT', label: copy('Aguardando cliente', 'Waiting on client'), tone: 'text-paper' },
                        ].map((queue) => (
                          <Link
                            key={queue.key}
                            href={`/agent/policies?queue=${queue.key}`}
                            className="group rounded-xl border border-white/10 bg-white/[0.035] p-4 transition-colors hover:border-mint/45 hover:bg-white/[0.065]"
                          >
                            <p className={`font-mono text-2xl font-medium tabular-nums ${queue.tone}`}>
                              {nationalQueueCounts ? countValue(nationalQueueCounts[queue.key as keyof typeof nationalQueueCounts]) : '—'}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-paper/72">{queue.label}</p>
                            <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-paper/38">
                              {copy('Ver apólices filtradas →', 'View filtered policies →')}
                            </p>
                          </Link>
                        ))}
                      </div>

                      <div data-hero-reveal className="mt-5 grid gap-4 rounded-[20px] border border-white/10 bg-white/[0.035] p-4 sm:p-5 xl:grid-cols-[1fr_auto]">
                        <div>
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-xs font-medium text-paper/62">{copy('Situação da carteira', 'Book status')}</p>
                              <p className="mt-1 text-[11px] text-paper/36">
                                {copy('Da estabilidade à recuperação, sem procurar relatório por relatório.', 'From stability to recovery, without searching report by report.')}
                              </p>
                            </div>
                            <Link href="/agent/policies" className="shrink-0 text-xs font-semibold text-mint hover:text-paper">
                              {copy('Ver clientes', 'View clients')} <span aria-hidden>↗</span>
                            </Link>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {[
                              {
                                label: copy('Em dia', 'Healthy'),
                                value: Math.max(0, portfolioMetrics.activePolicies - portfolioMetrics.pendingLapsePolicies),
                                className: 'border-mint/20 bg-mint/10 text-mint',
                              },
                              {
                                label: 'Pending Lapse',
                                value: portfolioMetrics.pendingLapsePolicies,
                                className: 'border-[oklch(0.82_0.12_85)]/25 bg-[oklch(0.82_0.12_85)]/10 text-[oklch(0.82_0.12_85)]',
                              },
                              {
                                label: 'Lapsed',
                                value: portfolioMetrics.lapsedPolicies,
                                className: 'border-danger/25 bg-danger/10 text-[oklch(0.76_0.12_25)]',
                              },
                              {
                                label: 'Canceled',
                                value: portfolioMetrics.cancelledPolicies,
                                className: 'border-white/10 bg-white/[0.04] text-paper/60',
                              },
                            ].map((status) => (
                              <div key={status.label} className={`rounded-xl border px-3 py-3 ${status.className}`}>
                                <p className="font-mono text-lg font-semibold tabular-nums">{status.value}</p>
                                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em]">{status.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="min-w-[180px] rounded-2xl border border-[oklch(0.82_0.12_85)]/20 bg-[oklch(0.82_0.12_85)]/[0.08] p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/42">{copy('Prêmio anual em risco', 'Annual premium at risk')}</p>
                          <p className="mt-2 font-mono text-2xl font-medium tabular-nums text-[oklch(0.82_0.12_85)]">{atRiskAapValue}</p>
                          <p className="mt-1 text-[10px] leading-4 text-paper/40">
                            {portfolioMetrics.atRiskPremiumCoverageComplete
                              ? copy('em apólices Pending Lapse', 'in Pending Lapse policies')
                              : portfolioMetrics.pendingLapsePolicies > 0
                                ? copy(
                                    `${portfolioMetrics.atRiskPremiumKnownPolicies}/${portfolioMetrics.pendingLapsePolicies} apólices com prêmio anual; total aguardando dados`,
                                    `${portfolioMetrics.atRiskPremiumKnownPolicies}/${portfolioMetrics.pendingLapsePolicies} policies with annual premium; total awaiting data`,
                                  )
                                : copy('nenhuma apólice Pending Lapse', 'no Pending Lapse policies')}
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div data-hero-reveal className="mt-8 rounded-[20px] border border-dashed border-white/15 bg-white/[0.035] px-5 py-7">
                      <p className="text-lg font-medium text-paper">
                        {copy('O K-Bot ainda não trouxe dados da National.', 'K-Bot has not brought National Life data yet.')}
                      </p>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-paper/50">
                        {localConnectorEnabled
                          ? copy(
                              'Faça a primeira sincronização para transformar a carteira em clientes, prêmio anual previsto e ações de retenção.',
                              'Run the first sync to turn the book into clients, expected annual premium, and retention actions.',
                            )
                          : copy(
                              'A integração precisa ser configurada antes da primeira sincronização.',
                              'The integration must be configured before the first sync.',
                            )}
                      </p>
                      <Link href="/agent/integrations/national-life" className="mt-5 inline-flex min-h-10 items-center rounded-full bg-mint px-4 text-xs font-semibold text-rail-strong transition-transform hover:-translate-y-0.5">
                        {copy('Conectar National Life', 'Connect National Life')}
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <div data-hero-reveal className="mt-auto max-w-2xl pt-14">
                  <p className="text-base leading-7 text-paper/62 sm:text-lg">
                    {copy(
                      'Use este espaço como ponto de partida. Os atalhos e indicadores abaixo acompanham apenas os módulos liberados para sua conta.',
                      'Use this space as your starting point. The shortcuts and indicators below reflect only the modules enabled for your account.',
                    )}
                  </p>
                </div>
              )}
            </div>
          </article>

          {hasPriorityQueue && (
            <aside data-hero-reveal className="relative flex flex-col border-t border-border-steel bg-[#f4f4f1] p-6 text-ink sm:p-7 lg:col-span-4 lg:border-l lg:border-t-0 lg:p-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
                  {copy('Sua fila', 'Your queue')}
                </p>
                <h2 className="mt-2 text-2xl font-medium tracking-[-0.035em] text-ink">
                  {copy('Prioridades de hoje', "Today's priorities")}
                </h2>
              </div>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rail-strong text-sm font-semibold text-paper">
                {loadError
                  ? '—'
                  : canUsePolicies
                    ? portfolioMetrics.attentionPolicies
                    : dueFollowUps + openRequirements}
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-muted">
              {canUsePolicies
                ? copy(
                    'O K-Bot separou os clientes que precisam de contato para proteger sua carteira.',
                    'K-Bot separated the clients who need contact to protect your book.',
                  )
                : copy(
                    'Comece pelo que pode destravar resultado hoje.',
                    'Start with what can unlock results today.',
                  )}
            </p>
            <div className="mt-6 flex flex-col gap-1">
              {!canUsePolicies && canUseCrm && (
                <>
                  <PriorityRow href="/agent/activities" label={copy('Retornos pendentes', 'Pending follow-ups')} value={loadError ? null : dueFollowUps} tone="danger" />
                  <PriorityRow href="/agent/activities" label={copy('Pendências abertas', 'Open requirements')} value={loadError ? null : openRequirements} tone="amber" />
                </>
              )}
              {canUsePolicies && (
                <>
                  <PriorityRow href="/agent/policies?status=PENDING_LAPSE" label="Pending Lapse" value={loadError ? null : portfolioMetrics.pendingLapsePolicies} tone="amber" />
                  <PriorityRow href="/agent/policies?status=LAPSED" label="Lapsed" value={loadError ? null : portfolioMetrics.lapsedPolicies} tone="danger" />
                  <PriorityRow href="/agent/policies?status=CANCELLED" label="Canceled" value={loadError ? null : portfolioMetrics.cancelledPolicies} tone="danger" />
                </>
              )}
            </div>
            <Link href={canUsePolicies ? '/agent/policies' : '/agent/activities'} className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-rail-strong px-4 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5">
              {canUsePolicies
                ? copy('Abrir carteira completa', 'Open full book')
                : copy('Abrir fila completa', 'Open full queue')}
            </Link>
          </aside>
          )}
        </section>

        {canUsePolicies && !loadError && (
          <NationalPremiumEvolution model={premiumEvolution} language={language}
            preservedParams={Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => !entry[0].startsWith('premium') && typeof entry[1] === 'string'))} />
        )}

        {canUseCalendar && !loadError && (
          <TodayMeetingsSection
            connection={calendarConnection}
            calendars={calendarSources}
            events={todayMeetings}
            timeZone={user?.timeZone ?? 'America/New_York'}
          />
        )}

        {canUseCalendar && !loadError && (
          <UpcomingMeetingsSection
            calendars={calendarSources}
            events={upcomingMeetings}
            timeZone={user?.timeZone ?? 'America/New_York'}
          />
        )}

        {canUseCrm && !loadError && dueFollowUpItems.length > 0 && (
          <section
            aria-labelledby="today-follow-ups-title"
            className="mt-6 overflow-hidden rounded-[28px] border border-border-steel bg-paper/68 p-5 shadow-[var(--shadow-soft)] sm:p-7"
            data-stack-card
          >
            <div className="flex flex-col gap-3 border-b border-border-steel/75 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-deep">
                  {copy('Agenda acionável', 'Actionable schedule')}
                </p>
                <h2 id="today-follow-ups-title" className="mt-2 max-w-4xl text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">
                  {copy('Seus contatos de hoje, prontos para avançar.', "Today's contacts, ready to move forward.")}
                </h2>
              </div>
              <Link href="/agent/activities#follow-ups" className="inline-flex min-h-10 w-fit items-center rounded-full border border-border-steel bg-paper px-4 text-xs font-semibold text-ink transition-colors hover:border-teal/35 hover:bg-teal-pale">
                {copy('Ver agenda completa', 'View full schedule')} <span aria-hidden className="ml-1.5">↗</span>
              </Link>
            </div>

            <div className="mt-5 grid grid-flow-dense gap-5 lg:grid-cols-2">
              {followUpsOverdue.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-ink">{copy('Retornos atrasados', 'Overdue follow-ups')}</h3>
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
                    <h3 className="text-sm font-semibold text-ink">{copy('Retornos de hoje', "Today's follow-ups")}</h3>
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

        {pulseMetrics.length > 0 && (
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
        )}

        {canUseJourney && promotion && displayedPromotion && (
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
        )}

        {(canUseCrm || canUsePolicies || canUseTeam) && (
          <section aria-label={copy('Resumo da operação', 'Operation summary')} className="mt-12 grid grid-flow-dense grid-cols-1 gap-4 lg:grid-cols-12">
          {canUseCrm && (
            <Link href="/agent/cases" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -bottom-20 -right-12 h-52 w-52 rounded-full bg-teal-pale transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">{copy('Funil', 'Pipeline')}</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(openCases)}</p>
                <p className="mt-2 text-sm text-ink-muted">{copy('oportunidades ativas em andamento', 'active opportunities in progress')}</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">
                  {canUseIllustrations
                    ? copy(
                        `${countValue(awaitingIllustration)} aguardando ilustração`,
                        `${countValue(awaitingIllustration)} awaiting illustration`,
                      )
                    : copy(
                        `${countValue(dueFollowUps)} retornos pendentes`,
                        `${countValue(dueFollowUps)} pending follow-ups`,
                      )}
                </span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
            </Link>
          )}

          {canUsePolicies && (
            <Link href="/agent/policies" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
            <div aria-hidden className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gold-pale transition-transform duration-700 ease-out group-hover:scale-105" />
            <div className="relative flex h-full flex-col justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">{copy('Carteira', 'Book')}</p>
                <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(policyCount)}</p>
                <p className="mt-2 text-sm text-ink-muted">{copy('apólices sob seu cuidado', 'policies under your care')}</p>
              </div>
              <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                <span className="text-ink-muted">
                  {copy(
                    `${countValue(atRiskPolicies)} sinais de risco`,
                    `${countValue(atRiskPolicies)} risk signals`,
                  )}
                </span>
                <span aria-hidden className="text-ink">↗</span>
              </div>
            </div>
            </Link>
          )}

          {canUseTeam ? (
            <Link href="/agent/hierarchy" className="keepr-card keepr-card-interactive group relative min-h-[250px] overflow-hidden rounded-[28px] p-7 lg:col-span-4" data-stack-card>
              <div aria-hidden className="absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-[oklch(0.91_0.045_286)] transition-transform duration-700 ease-out group-hover:scale-105" />
              <div className="relative flex h-full flex-col justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">{copy('Rede', 'Network')}</p>
                  <p className="mt-4 font-mono text-5xl font-medium tracking-[-0.06em] tabular-nums text-ink">{countValue(teamAgentIds.length)}</p>
                  <p className="mt-2 text-sm text-ink-muted">{copy('agentes conectados à sua estrutura', 'agents connected to your structure')}</p>
                </div>
                <div className="mt-8 flex items-center justify-between border-t border-border-steel/70 pt-4 text-xs">
                  <span className="text-ink-muted">
                    {canUsePolicies
                      ? copy(
                          `${countValue(portfolioMetrics.activeClients)} clientes ativos National`,
                          `${countValue(portfolioMetrics.activeClients)} active National clients`,
                        )
                      : copy('Abrir estrutura da equipe', 'Open team structure')}
                  </span>
                  <span aria-hidden className="text-ink">↗</span>
                </div>
              </div>
            </Link>
          ) : null}
          </section>
        )}

        {canUsePolicies && (
          <section className="py-24 sm:py-32" aria-labelledby="portfolio-panorama-title">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-teal-deep">
                {copy('Leitura da carteira', 'Book overview')}
              </p>
              <h2 id="portfolio-panorama-title" className="mt-3 max-w-4xl text-3xl font-medium tracking-[-0.045em] text-ink sm:text-5xl">
                {copy('Panorama sem ruído.', 'A clear panorama.')}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-6 text-ink-muted">
              {copy(
                'Passe o cursor para aprofundar cada recorte e identificar onde sua carteira está concentrada.',
                'Hover over each segment to explore it and identify where your book is concentrated.',
              )}
            </p>
          </div>
          <div className="keepr-card flex flex-col overflow-hidden rounded-[28px] md:flex-row" data-stack-card>
            <BreakdownList
              title={copy('Por status', 'By status')}
              rows={byStatus.map((s) => ({ label: localizedPolicyStatusLabel[s.status] ?? s.status, count: safeGroupCount(s._count) }))}
              emptyLabel={copy('Nenhuma apólice para exibir.', 'No policies to display.')}
            />
            <BreakdownList
              title={copy('Por seguradora', 'By carrier')}
              rows={byCarrier.map((c) => ({ label: c.carrier, count: safeGroupCount(c._count) }))}
              emptyLabel={copy('Nenhuma seguradora para exibir.', 'No carriers to display.')}
            />
            <BreakdownList
              title={copy('Por produto', 'By product')}
              rows={byProduct.map((p) => ({ label: p.product, count: safeGroupCount(p._count) }))}
              emptyLabel={copy('Nenhum produto para exibir.', 'No products to display.')}
            />
          </div>
          </section>
        )}

        {signals.length > 0 && <OperationSignals signals={signals} />}

        {canUseCrm && (
          <section className="py-24 sm:py-32">
          <div className="relative overflow-hidden rounded-[32px] bg-mint p-8 text-rail-strong sm:p-12 lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div aria-hidden className="absolute -right-12 -top-20 h-64 w-64 rounded-full border-[42px] border-rail-strong/8" />
            <div className="relative max-w-4xl">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-rail-strong/55">
                {copy('Mantenha o ritmo', 'Keep the momentum')}
              </p>
              <h2 className="mt-4 max-w-5xl text-3xl font-medium leading-[1.02] tracking-[-0.05em] sm:text-5xl">
                {copy('A próxima oportunidade pode começar agora.', 'Your next opportunity can start now.')}
              </h2>
            </div>
            <Link href="/agent/cases/new" className="relative mt-8 inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-rail-strong px-6 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-1 lg:mt-0">
              {copy('Novo atendimento', 'New case')}
            </Link>
          </div>
          </section>
        )}
      </KeeprDashboardMotion>
    </Shell>
  )
}
