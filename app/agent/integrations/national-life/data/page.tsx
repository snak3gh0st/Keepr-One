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
  buildClientActionQueue,
  toClientServiceEvents,
} from '@/lib/national-life/client-intelligence'
import {
  NationalLifeDataTabs,
  type CaseRow,
  type PortalReportRow,
  type InforceRow,
} from './NationalLifeDataTabs'
import { ForesightCaseTabs, type ForesightCaseRow } from './ForesightCaseTabs'
import {
  NationalLifeActionQueue,
  type NationalLifeActionRow,
} from './NationalLifeActionQueue'

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
  let actions: NationalLifeActionRow[] = []
  let lastSyncedAt: Date | null = null
  let verifiedStageCount = 0
  let totalStageCount = 0
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
      intelligenceRows,
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
        where: {
          agentId: agent.id,
          deploymentScope,
          gridKey: { not: 'CLIENT_INTELLIGENCE' },
        },
        select: reportSelect,
        orderBy: [{ gridKey: 'asc' }, { primaryDate: 'desc' }],
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: agent.id,
          deploymentScope,
          gridKey: 'CLIENT_INTELLIGENCE',
        },
        select: { id: true, raw: true },
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
            select: {
              completedAt: true,
              updatedAt: true,
              completedStages: true,
              totalStages: true,
            },
            where: {
              agentId: agent.id,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              executionSource: 'LOCAL',
              provider: 'NATIONAL_LIFE',
              state: 'COMPLETED',
            },
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
    verifiedStageCount = localRun?.completedStages ?? 0
    totalStageCount = localRun?.totalStages ?? 0

    const actionQueue = buildClientActionQueue(toClientServiceEvents(intelligenceRows), {
      asOf: lastSyncedAt ?? new Date(),
      windowDays: 30,
    })
    const linkedPolicies = actionQueue.length
      ? await prisma.policy.findMany({
          where: {
            agentId: agent.id,
            policyNumber: { in: actionQueue.map((item) => item.policyNumber) },
          },
          select: { id: true, policyNumber: true },
        })
      : []
    const policyIds = new Map(linkedPolicies.map((policy) => [policy.policyNumber, policy.id]))
    actions = actionQueue.map((item) => ({
      ...item,
      occurredAt: item.occurredAt.toISOString(),
      policyId: policyIds.get(item.policyNumber) ?? null,
    }))
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
  const riskActions = actions.filter((row) => row.signal === 'AT_RISK').length
  const opportunityActions = actions.filter((row) => row.signal === 'OPPORTUNITY').length
  const syncDetail = lastSyncedAt
    ? lastSyncedAt.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Ainda não sincronizado'

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="National Life"
        eyebrow="Carteira conectada"
        description="Dados atuais da carteira e sinais concretos para orientar o próximo contato com cada cliente."
      >
        <Link
          href="/agent/integrations/national-life"
          className="inline-flex items-center rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-teal hover:bg-panel"
        >
          Gerenciar conexão
        </Link>
      </PageHeader>

      {loadError && (
        <ErrorBanner>
          We could not load your National Life data right now. Refresh the page to try again.
        </ErrorBanner>
      )}

      {!loadError && (
        <ModuleSummary
          label="Resumo da National Life"
          items={[
            {
              label: 'Carteira em vigor',
              value: activeInforce,
              detail: `${inforce.length} apólices observadas no portal`,
              tone: 'green',
            },
            {
              label: 'Precisa de ação',
              value: riskActions,
              detail: 'Apólices com sinal de risco nos últimos 30 dias',
              tone: riskActions > 0 ? 'danger' : 'green',
            },
            {
              label: 'Oportunidades',
              value: opportunityActions,
              detail: 'Aniversários e datas para relacionamento',
              tone: opportunityActions > 0 ? 'gold' : 'neutral',
            },
            {
              label: 'Fontes verificadas',
              value: totalStageCount > 0 ? `${verifiedStageCount}/${totalStageCount}` : '—',
              detail: syncDetail,
              tone:
                totalStageCount > 0 && verifiedStageCount === totalStageCount ? 'green' : 'gold',
            },
          ]}
        />
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          {!loadError && <NationalLifeActionQueue rows={actions} />}
        </section>
        <ContextPanel eyebrow="Confiança dos dados" title="Atual e rastreável">
          <p>
            A carteira, os casos e os sinais abaixo vêm da última leitura concluída da National Life.
            A data da atualização e o número de fontes verificadas ficam sempre visíveis.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">
              Limite conhecido
            </p>
            <p className="mt-2">
              A grade atual não fornece e-mail, telefone, prêmio anual ou valor em dinheiro. O
              relatório oficial de carteira com contatos fornece endereços, parte dos contatos e
              prêmio anual; essa fonte será importada pelo novo canal de downloads. Até ela entrar,
              o Keepr One mostra os campos como ausentes, nunca como zero.
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">
              Estado da carteira
            </p>
            <p className="mt-2">
              {attentionInforce} apólices estão em lapse, pending lapse ou not active. A fila de ação
              usa somente sinais registrados nos últimos 30 dias, para não misturar histórico antigo
              com prioridade atual.
            </p>
          </div>
        </ContextPanel>
      </div>
      <section className="mt-8 module-main-surface">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">Dados recebidos do portal</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Consulte casos, carteira e relatórios exatamente como foram recebidos.
            </p>
          </div>
          <p className="text-sm text-ink-muted">
            {cases.length} casos · {inforce.length} apólices · {reports.length} linhas de relatório
          </p>
        </div>
        {!loadError && (
          <NationalLifeDataTabs cases={cases} inforce={inforce} reports={reports} />
        )}
      </section>
      <section className="mt-8 module-main-surface">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Leitura detalhada
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">Casos identificados no portal</h2>
          </div>
          <p className="text-sm text-ink-muted">Somente leitura · {foresightCases.length} casos</p>
        </div>
        <ForesightCaseTabs cases={foresightCases} run={foresightRun} />
      </section>
    </Shell>
  )
}
