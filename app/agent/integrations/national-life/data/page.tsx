import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { chooseMostRecentNationalLifeScope } from '@/lib/national-life/data-source'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { prisma } from '@/lib/prisma'
import { ContextPanel } from '@/components/ContextPanel'
import { ErrorBanner } from '@/components/ErrorBanner'
import { ModuleSummary } from '@/components/ModuleSummary'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import { foresightRunStore } from '@/lib/national-life/foresight-run-service'
import {
  NationalLifeDataTabs,
  type CaseRow,
  type PortalReportRow,
  type InforceRow,
} from './NationalLifeDataTabs'
import { ForesightCaseTabs, type ForesightCaseRow } from './ForesightCaseTabs'

export const dynamic = 'force-dynamic'

/// Only what the tabs render. The staging rows also carry the untouched carrier
/// payload in `raw`, which is deliberately not shipped to the browser.
const caseSelect = {
  id: true,
  policyNo: true,
  insuredName: true,
  product: true,
  carrierStatus: true,
  requirements: true,
  submitDate: true,
  anticipatedAnnualPremium: true,
  gridKey: true,
} as const

const inforceSelect = {
  id: true,
  policyNumber: true,
  insuredClientName: true,
  ownerClientName: true,
  productName: true,
  policyStatus: true,
  policyIssueDate: true,
  servicingAgencyName: true,
} as const

const reportSelect = {
  id: true,
  gridKey: true,
  label: true,
  primaryDate: true,
  amounts: true,
} as const

function toPortalReportRow(row: {
  id: string
  gridKey: string
  label: string | null
  primaryDate: string | null
  amounts: unknown
}): PortalReportRow {
  const amounts =
    row.amounts && typeof row.amounts === 'object' && !Array.isArray(row.amounts)
      ? Object.fromEntries(
          Object.entries(row.amounts as Record<string, unknown>)
            .filter(([, value]) => typeof value === 'string')
            .map(([field, value]) => [field, value as string]),
        )
      : {}

  return { id: row.id, gridKey: row.gridKey, label: row.label, primaryDate: row.primaryDate, amounts }
}

export default async function NationalLifeDataPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const localEnabled = getNationalLifeLocalConnectorConfig().enabled
  const remoteConfigured = isNationalLifeConfigured()

  if (!localEnabled && !remoteConfigured) {
    return (
      <Shell role="AGENT" userName={user?.name ?? ''}>
        <PageHeader
          title="National Life data"
          eyebrow="Integration"
          description="This integration is not set up yet."
        />
        <ErrorBanner>National Life is not set up yet. Contact Keepr One support to turn it on.</ErrorBanner>
      </Shell>
    )
  }

  const remoteScope = remoteConfigured ? getNationalLifeEnv().sessionScopeId : null
  const allowedScopes = [
    ...(localEnabled ? [LOCAL_CONNECTOR_DEPLOYMENT_SCOPE] : []),
    ...(remoteScope ? [remoteScope] : []),
  ]

  let cases: CaseRow[] = []
  let inforce: InforceRow[] = []
  let reports: PortalReportRow[] = []
  let lastSyncedAt: Date | null = null
  let loadError = false
  let foresightCases: ForesightCaseRow[] = []
  let foresightRun: Awaited<ReturnType<typeof foresightRunStore.getStatus>> = null

  try {
    const [latestCase, latestInforce] = await Promise.all([
      prisma.nationalLifeCaseSnapshot.findFirst({
        where: { agentId: agent.id, deploymentScope: { in: allowedScopes } },
        select: { deploymentScope: true, fetchedAt: true },
        orderBy: { fetchedAt: 'desc' },
      }),
      prisma.nationalLifeInforcePolicy.findFirst({
        where: { agentId: agent.id, deploymentScope: { in: allowedScopes } },
        select: { deploymentScope: true, fetchedAt: true },
        orderBy: { fetchedAt: 'desc' },
      }),
    ])
    const deploymentScope = chooseMostRecentNationalLifeScope(allowedScopes, [
      latestCase && { deploymentScope: latestCase.deploymentScope, observedAt: latestCase.fetchedAt },
      latestInforce && {
        deploymentScope: latestInforce.deploymentScope,
        observedAt: latestInforce.fetchedAt,
      },
    ])

    const [
      caseRows,
      inforceRows,
      reportRows,
      session,
      localRun,
      foresightRows,
      currentForesightRun,
    ] = await Promise.all([
      prisma.nationalLifeCaseSnapshot.findMany({
        where: { agentId: agent.id, deploymentScope },
        select: caseSelect,
        orderBy: [{ submitDate: 'desc' }, { policyNo: 'asc' }],
      }),
      prisma.nationalLifeInforcePolicy.findMany({
        where: { agentId: agent.id, deploymentScope },
        select: inforceSelect,
        orderBy: [{ policyStatus: 'asc' }, { policyNumber: 'asc' }],
      }),
      prisma.nationalLifeReportRow.findMany({
        where: { agentId: agent.id, deploymentScope },
        select: reportSelect,
        orderBy: [{ gridKey: 'asc' }, { primaryDate: 'desc' }],
      }),
      remoteScope && deploymentScope === remoteScope
        ? prisma.agentIntegrationSession.findFirst({
            where: {
              agentId: agent.id,
              deploymentScope: remoteScope,
              provider: 'NATIONAL_LIFE',
              purpose: 'CARRIER_SESSION',
            },
            select: { lastConnectedAt: true, lastUsedAt: true },
          })
        : Promise.resolve(null),
      deploymentScope === LOCAL_CONNECTOR_DEPLOYMENT_SCOPE
        ? prisma.nationalLifeSyncRun.findFirst({
            where: {
              agentId: agent.id,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              executionSource: 'LOCAL',
              provider: 'NATIONAL_LIFE',
            },
            select: { completedAt: true, updatedAt: true },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve(null),
      remoteScope
        ? prisma.nationalLifeForesightCaseSnapshot.findMany({
            where: { agentId: agent.id, deploymentScope: remoteScope, provider: 'NATIONAL_LIFE' },
            select: {
              id: true,
              displayName: true,
              caseKind: true,
              product: true,
              status: true,
              state: true,
              observedAt: true,
              _count: { select: { services: true } },
            },
            orderBy: [{ observedAt: 'desc' }, { displayName: 'asc' }],
          })
        : Promise.resolve([]),
      remoteScope ? foresightRunStore.getStatus(agent.id, remoteScope) : Promise.resolve(null),
    ])

    cases = caseRows
    inforce = inforceRows
    reports = reportRows.map(toPortalReportRow)
    lastSyncedAt =
      deploymentScope === LOCAL_CONNECTOR_DEPLOYMENT_SCOPE
        ? localRun?.completedAt ?? localRun?.updatedAt ?? null
        : session?.lastUsedAt ?? session?.lastConnectedAt ?? null
    foresightCases = foresightRows.map(({ _count, ...row }) => ({ ...row, serviceCount: _count.services }))
    foresightRun = currentForesightRun
  } catch (error) {
    console.error('National Life data query error', error)
    loadError = true
  }

  const activeInforce = inforce.filter((row) =>
    (row.policyStatus ?? '').toLowerCase().startsWith('active'),
  ).length
  const attentionInforce = inforce.filter((row) => {
    const status = (row.policyStatus ?? '').toLowerCase()
    return status.includes('lapse') || status.includes('not active')
  }).length

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="National Life data"
        eyebrow="Integration"
        description="Cases, in-force policies, and every synced portal report, read straight from National Life."
      >
        <Link
          href="/agent/integrations/national-life"
          className="inline-flex items-center rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-teal hover:bg-panel"
        >
          Manage connection
        </Link>
      </PageHeader>

      {loadError && (
        <ErrorBanner>
          We could not load your National Life data right now. Refresh the page to try again.
        </ErrorBanner>
      )}

      {!loadError && (
        <ModuleSummary
          label="Saved in Keepr One"
          items={[
            {
              label: 'Cases',
              value: cases.length,
              detail: 'New business and recently closed',
            },
            {
              label: 'In force',
              value: activeInforce,
              detail: `${inforce.length} policies read · ${attentionInforce} need attention`,
              tone: attentionInforce > 0 ? 'gold' : 'green',
            },
            {
              label: 'Portal report rows',
              value: reports.length,
              detail: lastSyncedAt
                ? `Last synced ${lastSyncedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
                : 'Not synced yet',
            },
          ]}
        />
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          {!loadError && (
            <NationalLifeDataTabs cases={cases} inforce={inforce} reports={reports} />
          )}
        </section>
        <ContextPanel eyebrow="How to read this" title="Straight from the portal">
          <p>
            These records are a copy of what the National Life portal showed at the time of the last
            sync. They do not replace your policies in Keepr One.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Amounts</p>
            <p className="mt-2">
              Premiums and commission amounts arrive as text from the carrier and are shown exactly
              as received, with no recalculation.
            </p>
          </div>
        </ContextPanel>
      </div>
      <section className="mt-8 module-main-surface">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">Foresight</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">Cases seen in the portal</h2>
          </div>
          <p className="text-sm text-ink-muted">View-only · {foresightCases.length} cases</p>
        </div>
        <ForesightCaseTabs cases={foresightCases} run={foresightRun} />
      </section>
    </Shell>
  )
}
