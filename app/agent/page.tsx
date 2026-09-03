export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Decimal from 'decimal.js'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getCurrentAgentAccess } from '@/lib/agent-access'
import { decimalToNumber } from '@/lib/decimal'
import { periodFromDate, shiftPeriod } from '@/lib/period'
import {
  auditVisibleCarrierCommissionRows,
  preferCanonicalCarrierCommissionRows,
  projectedPayableSnapshotForPeriod,
  sumByPeriod,
  totalForPeriod,
  totalOf,
} from '@/lib/national-life/commission-records'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { Shell } from '@/components/Shell'
import { ErrorBanner } from '@/components/ErrorBanner'
import { TrendChart } from '@/components/TrendChart'
import {
  KeeprDashboardMotion,
} from '@/components/KeeprDashboardMotion'
import { OperationSignals, type OperationSignal } from '@/components/OperationSignals'
import { getAgentPromotionSnapshot } from '@/lib/agent-promotion'
import { getLocalPromotionPreview } from '@/lib/promotion-preview'
import { getPromotionIdentity, getPromotionJourney } from '@/lib/promotion-journey'
import { JourneyDashboardPreview } from './JourneyDashboardPreview'
import {
  COMMISSION_EARNING_GRID_KEYS,
  LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
  LEGACY_COMMISSION_EARNING_GRID_KEY,
} from '@/lib/national-life/commission-grid-keys'
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
import { auditedNationalLifeAap } from '@/lib/policy-metrics'
import type { PlatformModuleName } from '@/lib/platform-modules'

const NATIONAL_LIFE_DASHBOARD_FINANCIAL_GRID_KEYS = [
  ...COMMISSION_EARNING_GRID_KEYS,
  'PAYABLE_GROSS_COMMISSIONS',
] as const

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
  return formatLocalizedCurrency(value, language, 'USD', { maximumFractionDigits: 0 })
}

function formatTargetPremiumCurrency(value: number, language: UserLanguage): string {
  return formatLocalizedCurrency(value, language, 'USD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatMonthShort(period: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${period}-01T00:00:00.000Z`))
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
  searchParams: Promise<{ preview?: string }>
}) {
  const { preview } = await searchParams
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
  const canUseCommissions = hasModule('COMMISSIONS')
  const canUseJourney = hasModule('JOURNEY')
  const canUseTeam = hasModule('TEAM') && access.canManageTeam
  const hasPriorityQueue = canUseCrm || canUsePolicies
  const promotion = canUseJourney || canUseCommissions
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
        confirmedCreditCount: 1,
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
        confirmedCreditCount: promotion.confirmedCreditCount,
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
  const currentP = periodFromDate(now)
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
  let calendarConnection: CalendarConnectionView = {
    status: 'DISCONNECTED', email: null, displayName: null, lastSyncAt: null, errorMessage: null,
  }
  let calendarSources: CalendarSourceView[] = []
  let todayMeetings: CalendarEventView[] = []
  let upcomingMeetings: CalendarEventView[] = []

  let policyCount = 0
  let activeClientCount = 0
  let totalProtection = 0
  let totalRegisteredPremium = 0
  let activePolicyCount = 0
  let protectionKnownCount = 0
  let premiumKnownCount = 0
  let capturedTargetPremium = 0
  let targetPremiumKnownCount = 0
  let carrierPortfolioAuditReady = false
  let commissionTotalAmount = 0
  let commissionByPeriod: { period: string; total: number }[] = []
  let commissionAuditBlocked = false
  let commissionAcceptedRows = 0
  let commissionRejectedRows = 0
  let commissionFetchedAt: Date | null = null
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
      inforcePolicyRows,
      canonicalInforceSnapshotRows,
      targetPremiumSnapshot,
      commissionAgg,
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
      canUsePolicies
        ? prisma.policy.count({ where: { agentId: { in: scope } } })
        : 0,
      canUseCommissions
        ? (prisma.policy.findMany?.({
            where: { agentId: { in: scope }, status: 'INFORCE', sourceProvider: 'NATIONAL_LIFE' },
            select: {
              clientId: true,
              policyNumber: true,
              faceAmount: true,
              faceAmountSource: true,
              premium: true,
              sourceUpdatedAt: true,
            },
          }) ?? [])
        : [],
      canUseCommissions
        ? (prisma.nationalLifeInforcePolicy?.findMany?.({
            where: { agentId: { in: scope }, deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE },
            select: { policyNumber: true, policyStatus: true, fetchedAt: true },
          }) ?? [])
        : [],
      canUseCommissions
        ? prisma.nationalLifePolicyDetailSnapshot.aggregate({
            where: {
              agentId: { in: scope },
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              ctp: { gt: 0 },
              policy: {
                status: 'INFORCE',
                sourceProvider: 'NATIONAL_LIFE',
              },
            },
            _count: { ctp: true },
            _sum: { ctp: true },
          })
        : { _count: { ctp: 0 }, _sum: { ctp: null } },
      canUseCommissions
        ? prisma.commissionRecord.aggregate({ where: commissionScopeWhere, _sum: { amount: true } })
        : { _sum: { amount: null } },
      canUseCommissions
        ? prisma.commissionRecord.groupBy({
            by: ['period'],
            where: { ...commissionScopeWhere, period: { gte: trendStartP, lte: currentP } },
            _sum: { amount: true },
            orderBy: { period: 'asc' },
          })
        : [],
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
      canUsePolicies
        ? prisma.policy.count({ where: { agentId: { in: scope }, status: 'LAPSED' } })
        : 0,
      canUseCommissions
        ? prisma.commissionTransaction.groupBy({
            by: ['type'],
            where: {
              agentId: { in: scope },
              policy: { agentId: { in: scope } },
              occurredAt: { gte: currentMonthStart, lt: nextMonthStart },
            },
            _sum: { amount: true },
          })
        : [],
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
    atRiskPolicies = atRiskCount
    dueFollowUpItems = dueFollowUpsResult
    dueFollowUps = dueFollowUpsResult.length
    dueReviews = dueReviewCount
    for (const t of txnByType) {
      const sum = decimalToNumber(t._sum.amount)
      if (t.type === 'EXPECTED') txnExpected = sum
      else if (t.type === 'PAID') txnPaid = sum
    }

    policyCount = policyTotal
    activePolicyCount = inforcePolicyRows.length
    activeClientCount = new Set(inforcePolicyRows.map((policy) => policy.clientId)).size
    targetPremiumKnownCount = targetPremiumSnapshot._count.ctp
    capturedTargetPremium = decimalToNumber(targetPremiumSnapshot._sum.ctp)
    const canonicalActiveRows = canonicalInforceSnapshotRows.filter((row) => {
      const status = row.policyStatus?.trim().toLowerCase()
      return status === 'active' || status === 'pending lapse'
    })
    const canonicalActivePolicyNumbers = new Set(
      canonicalActiveRows.map((row) => row.policyNumber.trim().toUpperCase().replace(/\s+/g, '')),
    )
    const normalizedActivePolicyNumbers = new Set(
      inforcePolicyRows.map((row) => row.policyNumber.trim().toUpperCase().replace(/\s+/g, '')),
    )
    const latestCanonicalInforceFetchedAt = canonicalActiveRows.reduce<Date | null>(
      (latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest,
      null,
    )
    carrierPortfolioAuditReady = Boolean(
      latestCanonicalInforceFetchedAt &&
      canonicalActivePolicyNumbers.size === normalizedActivePolicyNumbers.size &&
      [...canonicalActivePolicyNumbers].every((number) => normalizedActivePolicyNumbers.has(number)) &&
      inforcePolicyRows.every((policy) =>
        policy.sourceUpdatedAt && policy.sourceUpdatedAt >= latestCanonicalInforceFetchedAt,
      ),
    )
    const protectionRows = inforcePolicyRows.filter((policy) =>
      policy.faceAmountSource === 'NATIONAL_LIFE_POLICY_DETAIL' &&
      decimalToNumber(policy.faceAmount) > 0,
    )
    protectionKnownCount = protectionRows.length
    totalProtection = protectionRows.reduce(
      (total, policy) => total + Math.max(0, decimalToNumber(policy.faceAmount)),
      0,
    )
    const premiumRows = inforcePolicyRows.flatMap((policy) => {
      if (policy.sourceUpdatedAt === null) return []
      const annualPremium = auditedNationalLifeAap(policy.premium)
      return annualPremium === null ? [] : [annualPremium]
    })
    premiumKnownCount = premiumRows.length
    totalRegisteredPremium = premiumRows.reduce(
      (total, annualPremium) => total.plus(annualPremium),
      new Decimal(0),
    ).toNumber()
    commissionTotalAmount = decimalToNumber(commissionAgg._sum.amount)
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
    if (canUseCommissions && localConnectorEnabled) {
      const carrierRows = await prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: { in: scope },
          OR: [
            {
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              gridKey: { in: [...NATIONAL_LIFE_DASHBOARD_FINANCIAL_GRID_KEYS] },
            },
            {
              deploymentScope: LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
              gridKey: LEGACY_COMMISSION_EARNING_GRID_KEY,
            },
          ],
        },
        select: {
          id: true,
          agentId: true,
          gridKey: true,
          raw: true,
          amounts: true,
          primaryDate: true,
          fetchedAt: true,
          deploymentScope: true,
        },
      })
      const carrierCommissionRows = preferCanonicalCarrierCommissionRows(
        carrierRows.filter((row) =>
          COMMISSION_EARNING_GRID_KEYS.some((gridKey) => gridKey === row.gridKey),
        ),
        LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      )
      const payableRows = carrierRows.filter((row) => row.gridKey === 'PAYABLE_GROSS_COMMISSIONS')
      // The homepage headline is the authenticated agent's total commission,
      // not only direct production. Keep member direct production available to
      // entitled agency owners, but include overrides only from this agent's
      // own National Life session—the same tenant-safe rule as the statement.
      const commissionAudit = auditVisibleCarrierCommissionRows(carrierCommissionRows, agent.id)
      const carrierRecords = commissionAudit.records
      const carrierPaidThisMonth = totalForPeriod(carrierRecords, currentP)
      const projectedPayable = projectedPayableSnapshotForPeriod(payableRows, currentP)

      // Once the National connector is authoritative, never add its ledger to
      // an internal/imported ledger. That would make an unexplained duplicate
      // look like production. Rows without complete statement evidence block
      // the National commission figure instead of being treated as zero.
      commissionAuditBlocked = commissionAudit.rejectedCount > 0
      commissionAcceptedRows = carrierRecords.length
      commissionRejectedRows = commissionAudit.rejectedCount
      commissionFetchedAt = carrierCommissionRows.reduce<Date | null>(
        (latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest,
        null,
      )
      commissionTotalAmount = totalOf(carrierRecords)
      txnExpected = projectedPayable.total
      txnPaid = carrierPaidThisMonth

      commissionByPeriod = sumByPeriod(carrierRecords, { from: trendStartP, to: currentP })
    }
    byStatus = statusBuckets
    byCarrier = carrierBuckets
    byProduct = productBuckets
  } catch (error) {
    console.error('AgentDashboard query error', error)
    loadError = true
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
  const currentPeriodLabel = `${formatMonthShort(currentP, locale)} ${currentP.slice(0, 4)}`
  // Agency PC already includes personal production, so adding personalPc here
  // would double count the signed-in agent.
  const recognizedProduction = displayedPromotion
    ? access.canViewAgencyNationalLife
      ? displayedPromotion.agencyPc
      : displayedPromotion.personalPc
    : 0
  const productionAuditReady = Boolean(
    canUseCommissions
      && !loadError
      && displayedPromotion
      && !displayedPromotion.loadError
      && displayedPromotion.ledgerReady
      && displayedPromotion.confirmedCreditCount > 0,
  )
  const hasCapturedTargetPremium = !loadError && targetPremiumKnownCount > 0
  const productionNumberValue = productionAuditReady
    ? formatNumber(recognizedProduction, language, { maximumFractionDigits: 0 })
    : hasCapturedTargetPremium
      ? formatTargetPremiumCurrency(capturedTargetPremium, language)
      : '—'
  const commissionTrendMap = new Map(commissionByPeriod.map((bucket) => [bucket.period, bucket.total]))
  const commissionTrend = Array.from({ length: 6 }, (_, index) => {
    const period = shiftPeriod(currentP, index - 5)
    return {
      label: formatMonthShort(period, locale),
      tooltipLabel: new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${period}-01T00:00:00.000Z`)),
      value: commissionTrendMap.get(period) ?? 0,
    }
  })
  // Render only the amount backed by carrier evidence. When coverage is not
  // complete, the accompanying copy explicitly calls it a confirmed subtotal
  // instead of presenting it as the final portfolio total.
  const carrierMoneyValue = (value: number, known: number) =>
    loadError || known === 0 ? '—' : formatCurrency(value, language)
  const auditedCommissionValue = (value: number) =>
    loadError || commissionAuditBlocked ? '—' : formatCurrency(value, language)
  const commissionAsOfLabel = commissionFetchedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(commissionFetchedAt)
    : null
  const countValue = (value: number) => loadError ? '—' : formatNumber(value, language, { maximumFractionDigits: 0 })
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
    ...(canUseCommissions
      ? [
          { label: copy('Produção reconhecida', 'Recognized production'), value: productionAuditReady ? `${productionNumberValue} PC` : '—' },
          { label: copy('Clientes ativos National', 'Active National Life clients'), value: carrierPortfolioAuditReady ? countValue(activeClientCount) : '—' },
          { label: copy('Proteção confirmada National', 'National Life confirmed protection'), value: carrierMoneyValue(totalProtection, protectionKnownCount) },
          { label: copy('AAP registrado National', 'Recorded National Life AAP'), value: carrierMoneyValue(totalRegisteredPremium, premiumKnownCount) },
          { label: copy('Comissão esperada', 'Expected commission'), value: auditedCommissionValue(txnExpected) },
        ]
      : []),
    ...(canUsePolicies
      ? [
          { label: copy('Apólices', 'Policies'), value: countValue(policyCount) },
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
      title: atRiskPolicies > 0
        ? copy(
            `${formatNumber(atRiskPolicies, language)} apólices merecem atenção antes da próxima revisão.`,
            `${formatNumber(atRiskPolicies, language)} policies need attention before the next review.`,
          )
        : copy('Sua carteira não apresenta alertas críticos.', 'Your book has no critical alerts.'),
      description: atRiskPolicies > 0
        ? copy(
            'Revise os sinais de risco e planeje um contato proativo antes que a relação com o cliente esfrie.',
            'Review the risk signals and plan proactive outreach before the client relationship cools.',
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
  if (!loadError && canUseCommissions) {
    signals.push({
      title: commissionAuditBlocked
        ? copy('O extrato National precisa de revisão antes da comparação.', 'The National Life statement needs review before comparison.')
        : txnExpected > txnPaid
        ? copy('Existe receita esperada pronta para acompanhamento.', 'Expected revenue is ready for follow-up.')
        : copy('Sua produção está alinhada com os pagamentos registrados.', 'Your production is aligned with recorded payments.'),
      description: commissionAuditBlocked
        ? copy(
            `${commissionRejectedRows} registro(s) não possuem evidência financeira completa; nenhum subtotal foi tratado como comissão paga.`,
            `${commissionRejectedRows} record(s) do not have complete financial evidence; no subtotal was treated as paid commission.`,
          )
        : txnExpected > txnPaid
        ? copy(
            `A diferença atual entre o esperado e o pago é de ${formatCurrency(Math.max(0, txnExpected - txnPaid), language)}.`,
            `The current difference between expected and paid is ${formatCurrency(Math.max(0, txnExpected - txnPaid), language)}.`,
          )
        : access.canManageTeam
          ? copy(
              'Use o extrato para acompanhar detalhes, repasses e movimentos da sua equipe.',
              'Use the statement to track your team details, splits, and movements.',
            )
          : copy(
              'Use o extrato para acompanhar os detalhes e movimentos da sua produção.',
              'Use the statement to track the details and movements of your production.',
            ),
      action: copy('Ver comissões', 'View commissions'),
      href: '/agent/commissions',
      tone: 'violet',
    })
  }

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
                    {canUseCommissions
                      ? productionAuditReady
                        ? copy('Sua produção reconhecida.', 'Your recognized production.')
                        : hasCapturedTargetPremium
                          ? copy('Seu Target Premium capturado.', 'Your captured Target Premium.')
                          : copy('Sua produção está em reconciliação.', 'Your production is being reconciled.')
                      : copy('Seu dia começa com clareza.', 'Start your day with clarity.')}
                  </h1>
                </div>
                {canUseJourney ? (
                  <Link
                    data-hero-reveal
                    href={journeyHref}
                    className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-paper/78 transition-colors hover:bg-white hover:text-rail-strong"
                  >
                    {copy('Ver jornada', 'View journey')} <span aria-hidden>↗</span>
                  </Link>
                ) : canUseCommissions ? (
                  <Link
                    data-hero-reveal
                    href="/agent/commissions"
                    className="inline-flex w-fit shrink-0 items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs font-semibold text-paper/78 transition-colors hover:bg-white hover:text-rail-strong"
                  >
                    {copy('Ver extrato', 'View statement')} <span aria-hidden>↗</span>
                  </Link>
                ) : null}
              </div>

              {canUseCommissions ? (
                <>
              <div data-hero-reveal className="mt-7">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-paper/42">
                  {productionAuditReady
                    ? <>{copy('Target Premium confirmado', 'Confirmed Target Premium')} <span aria-hidden>·</span> PC</>
                    : hasCapturedTargetPremium
                      ? copy('Target Premium capturado na National', 'Target Premium captured from National Life')
                      : copy('Target Premium em reconciliação', 'Target Premium under reconciliation')}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
                  <p
                    aria-label={productionAuditReady
                      ? copy(
                          `Produção reconhecida de ${productionNumberValue} PC`,
                          `Recognized production of ${productionNumberValue} PC`,
                        )
                      : hasCapturedTargetPremium
                        ? copy(
                            `Target Premium capturado de ${productionNumberValue}`,
                            `Captured Target Premium of ${productionNumberValue}`,
                          )
                        : copy('Target Premium indisponível', 'Target Premium unavailable')}
                    className="flex items-start gap-2"
                  >
                    <span aria-hidden className="font-mono text-[clamp(3.5rem,6vw,6.25rem)] font-medium leading-[0.84] tracking-[-0.072em] tabular-nums">
                      {productionNumberValue}
                    </span>
                    {productionAuditReady && (
                      <span aria-hidden className="mb-[0.35em] text-[clamp(0.9rem,1.4vw,1.2rem)] font-semibold tracking-[0.14em] text-mint">
                        PC
                      </span>
                    )}
                  </p>
                </div>
                <p className="mt-3 max-w-2xl text-xs leading-5 text-paper/48">
                  {productionAuditReady
                    ? copy(
                        'Valor confirmado no ledger de Target Premium da National Life; comissão permanece separada no extrato.',
                        'Value confirmed in the National Life Target Premium ledger; commission remains separate in the statement.',
                      )
                    : hasCapturedTargetPremium
                      ? copy(
                          `Subtotal exato de CTP capturado no detalhe de ${targetPremiumKnownCount} de ${activePolicyCount} apólice(s). NPN não é obrigatório; o valor só passa a PC confirmado com a evidência de pagamento da National.`,
                          `Exact CTP subtotal captured from ${targetPremiumKnownCount} of ${activePolicyCount} policy detail(s). NPN is optional; the value becomes confirmed PC only with National Life payment evidence.`,
                        )
                      : copy(
                          'A National ainda não forneceu Target Premium suficiente para uma leitura auditável. Nenhum zero será presumido.',
                          'National Life has not provided enough Target Premium data for an auditable reading. Zero will not be assumed.',
                        )}
                </p>
              </div>

              <div data-hero-reveal className="mt-7 rounded-[20px] border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between">
                  <p className="text-xs font-medium text-paper/52">
                    {localConnectorEnabled && commissionAuditBlocked
                      ? copy('Comissões com evidência completa · 6 meses', 'Commissions with complete evidence · 6 months')
                      : localConnectorEnabled
                      ? copy('Comissões pagas National Life · 6 meses', 'National Life paid commissions · 6 months')
                      : copy('Comissões registradas · 6 meses', 'Recorded commissions · 6 months')}
                  </p>
                  <p className="font-mono text-xs text-paper/46">
                    {commissionAsOfLabel
                      ? copy(`National atualizada em ${commissionAsOfLabel}`, `National Life updated ${commissionAsOfLabel}`)
                      : copy(`Período ${currentPeriodLabel}`, `Period ${currentPeriodLabel}`)}
                  </p>
                </div>
                {commissionAuditBlocked && commissionAcceptedRows === 0 ? (
                  <p className="rounded-xl border border-[oklch(0.78_0.12_68)]/40 bg-[oklch(0.78_0.12_68)]/10 px-4 py-5 text-xs leading-5 text-paper/72">
                    {copy(
                      `${commissionRejectedRows} registro(s) de comissão não têm evidência completa da National Life. O total foi bloqueado para evitar um número parcial ou duplicado.`,
                      `${commissionRejectedRows} commission record(s) do not have complete National Life evidence. The total was blocked to avoid a partial or duplicated number.`,
                    )}
                  </p>
                ) : (
                  <>
                    <TrendChart
                      data={commissionTrend}
                      format="currency"
                      tone="onDark"
                      interactive
                      chartHeight={124}
                      ariaLabel={copy('Comissões registradas nos últimos seis meses', 'Commissions recorded in the last six months')}
                    />
                    {commissionAuditBlocked ? (
                      <p className="mt-3 rounded-xl border border-[oklch(0.78_0.12_68)]/40 bg-[oklch(0.78_0.12_68)]/10 px-4 py-3 text-[11px] leading-5 text-paper/72">
                        {copy(
                          `O gráfico mostra somente ${commissionAcceptedRows} registro(s) com evidência completa. ${commissionRejectedRows} registro(s) incompletos foram excluídos do valor exibido.`,
                          `The chart shows only ${commissionAcceptedRows} record(s) with complete evidence. ${commissionRejectedRows} incomplete record(s) were excluded from the displayed amount.`,
                        )}
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <div data-hero-reveal className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">
                {[
                  {
                    label: copy('Clientes ativos National', 'Active National clients'),
                    display: activeClientCount > 0 ? countValue(activeClientCount) : '—',
                    tone: 'text-paper',
                    detail: carrierPortfolioAuditReady
                      ? copy(`${activePolicyCount} apólices em vigor`, `${activePolicyCount} in-force policies`)
                      : copy(
                          `${activePolicyCount} apólices em vigor no registro atual · snapshot em reconciliação`,
                          `${activePolicyCount} in-force policies in the current record · snapshot reconciling`,
                        ),
                  },
                  {
                    label: copy('Proteção confirmada', 'Confirmed protection'),
                    display: carrierMoneyValue(totalProtection, protectionKnownCount),
                    tone: 'text-mint',
                    detail: protectionKnownCount === activePolicyCount && carrierPortfolioAuditReady
                      ? copy(
                          `Total confirmado em ${protectionKnownCount} apólices`,
                          `Confirmed total across ${protectionKnownCount} policies`,
                        )
                      : copy(
                          `Subtotal confirmado · ${protectionKnownCount}/${activePolicyCount} apólices com capital lido na National`,
                          `Confirmed subtotal · ${protectionKnownCount}/${activePolicyCount} policies with face amount read from National Life`,
                        ),
                  },
                  {
                    label: copy('AAP registrado', 'Recorded AAP'),
                    display: carrierMoneyValue(totalRegisteredPremium, premiumKnownCount),
                    tone: 'text-[oklch(0.78_0.12_68)]',
                    detail: premiumKnownCount === activePolicyCount && carrierPortfolioAuditReady
                      ? copy(
                          `Total confirmado em ${premiumKnownCount} apólices`,
                          `Confirmed total across ${premiumKnownCount} policies`,
                        )
                      : copy(
                          `Subtotal confirmado · ${premiumKnownCount}/${activePolicyCount} apólices com prêmio anual da National`,
                          `Confirmed subtotal · ${premiumKnownCount}/${activePolicyCount} policies with National Life annual premium`,
                        ),
                  },
                ].map((metric) => (
                  <div key={metric.label} className="bg-rail-strong/80 px-4 py-3.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-paper/38">{metric.label}</p>
                    <p className={`mt-1.5 font-mono text-lg font-medium tabular-nums ${metric.tone}`}>{metric.display}</p>
                    {metric.detail && <p className="mt-1 text-[10px] text-paper/38">{metric.detail}</p>}
                  </div>
                ))}
              </div>
                </>
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
                  : (canUseCrm ? dueFollowUps + openRequirements : 0)
                    + (canUsePolicies ? atRiskPolicies + dueReviews : 0)}
              </span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-muted">
              {copy(
                'Comece pelo que pode destravar resultado ou proteger sua carteira hoje.',
                'Start with what can unlock results or protect your book today.',
              )}
            </p>
            <div className="mt-6 flex flex-col gap-1">
              {canUseCrm && (
                <>
                  <PriorityRow href="/agent/activities" label={copy('Retornos pendentes', 'Pending follow-ups')} value={loadError ? null : dueFollowUps} tone="danger" />
                  <PriorityRow href="/agent/activities" label={copy('Pendências abertas', 'Open requirements')} value={loadError ? null : openRequirements} tone="amber" />
                </>
              )}
              {canUsePolicies && (
                <>
                  <PriorityRow href="/agent/policies" label={copy('Apólices em risco', 'Policies at risk')} value={loadError ? null : atRiskPolicies} tone="danger" />
                  <PriorityRow href="/agent/policies" label={copy('Revisões anuais', 'Annual reviews')} value={loadError ? null : dueReviews} tone="mint" />
                </>
              )}
            </div>
            <Link href={canUseCrm ? '/agent/activities' : '/agent/policies'} className="mt-auto inline-flex min-h-11 w-full items-center justify-center rounded-full bg-rail-strong px-4 py-3 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5">
              {canUseCrm
                ? copy('Abrir fila completa', 'Open full queue')
                : copy('Abrir carteira', 'Open book')}
            </Link>
          </aside>
          )}
        </section>

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
                    {canUseCommissions
                      ? copy(
                          `${auditedCommissionValue(commissionTotalAmount)} em comissões`,
                          `${auditedCommissionValue(commissionTotalAmount)} in commissions`,
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
