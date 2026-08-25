import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import {
  getNationalLifeLocalConnectorConfig,
} from '@/lib/national-life/local-connector/config'
import { CANONICAL_NATIONAL_LIFE_SYNC } from '@/lib/national-life/sync-engine'
import {
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
  NATIONAL_LIFE_READ_COVERAGE,
} from '@/lib/national-life/read-coverage'
import { prisma } from '@/lib/prisma'
import { ContextPanel } from '@/components/ContextPanel'
import { ErrorBanner } from '@/components/ErrorBanner'
import { ModuleSummary } from '@/components/ModuleSummary'
import { PageHeader } from '@/components/PageHeader'
import { Shell } from '@/components/Shell'
import {
  buildClientActionQueue,
  toClientServiceEvents,
} from '@/lib/national-life/client-intelligence'
import {
  NationalLifeDataTabs,
  NATIONAL_LIFE_OPERATIONAL_REPORT_KEYS,
  type CaseRow,
  type PortalReportRow,
  type InforceRow,
} from './NationalLifeDataTabs'
import {
  NationalLifeActionQueue,
  type NationalLifeActionRow,
} from './NationalLifeActionQueue'

export const dynamic = 'force-dynamic'

const CANONICAL_SCOPE = CANONICAL_NATIONAL_LIFE_SYNC.deploymentScope
const DISCOVERY_PAGE_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)

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
  fetchedAt: true,
} as const

function toPortalReportRow(row: {
  id: string
  gridKey: string
  label: string | null
  primaryDate: string | null
  amounts: unknown
  fetchedAt: Date
}): PortalReportRow {
  const amounts =
    row.amounts && typeof row.amounts === 'object' && !Array.isArray(row.amounts)
      ? Object.fromEntries(
          Object.entries(row.amounts as Record<string, unknown>)
            .filter(([, value]) => typeof value === 'string')
            .map(([field, value]) => [field, value as string]),
        )
      : {}

  return {
    id: row.id,
    gridKey: row.gridKey,
    label: row.label,
    primaryDate: row.primaryDate,
    amounts,
    fetchedAt: row.fetchedAt.toISOString(),
  }
}

export default async function NationalLifeDataPage() {
  const agent = await getCurrentAgent()
  const user = await prisma.user.findUnique({ where: { id: agent.userId } })
  const localEnabled = getNationalLifeLocalConnectorConfig().enabled

  if (!localEnabled) {
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

  let cases: CaseRow[] = []
  let inforce: InforceRow[] = []
  let reports: PortalReportRow[] = []
  let actions: NationalLifeActionRow[] = []
  let lastSyncedAt: Date | null = null
  let structuredSourceCount = 0
  let rawPageSourceCount = 0
  let actionSourceUpdatedAt: Date | null = null
  let loadError = false

  try {
    const [
      caseRows,
      inforceRows,
      reportRows,
      intelligenceRows,
      localRun,
    ] = await Promise.all([
      prisma.nationalLifeCaseSnapshot.findMany({
        where: { agentId: agent.id, deploymentScope: CANONICAL_SCOPE },
        select: caseSelect,
        orderBy: [{ submitDate: 'desc' }, { policyNo: 'asc' }],
      }),
      prisma.nationalLifeInforcePolicy.findMany({
        where: { agentId: agent.id, deploymentScope: CANONICAL_SCOPE },
        select: inforceSelect,
        orderBy: [{ policyStatus: 'asc' }, { policyNumber: 'asc' }],
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: agent.id,
          deploymentScope: CANONICAL_SCOPE,
          gridKey: { in: [...NATIONAL_LIFE_OPERATIONAL_REPORT_KEYS] },
        },
        select: reportSelect,
        orderBy: [{ gridKey: 'asc' }, { primaryDate: 'desc' }],
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: agent.id,
          deploymentScope: CANONICAL_SCOPE,
          gridKey: 'CLIENT_INTELLIGENCE',
        },
        select: { id: true, raw: true, fetchedAt: true },
      }),
      prisma.nationalLifeSyncRun.findFirst({
        select: {
          completedAt: true,
          updatedAt: true,
          stageCompletions: { select: { gridKey: true } },
        },
        where: {
          agentId: agent.id,
          deploymentScope: CANONICAL_NATIONAL_LIFE_SYNC.deploymentScope,
          executionSource: CANONICAL_NATIONAL_LIFE_SYNC.executionSource,
          provider: CANONICAL_NATIONAL_LIFE_SYNC.provider,
          state: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    cases = caseRows
    inforce = inforceRows
    reports = reportRows.map(toPortalReportRow)
    lastSyncedAt = localRun?.completedAt ?? localRun?.updatedAt ?? null
    const completedKeys = localRun?.stageCompletions.map((row) => row.gridKey) ?? []
    rawPageSourceCount = completedKeys.filter((key) => DISCOVERY_PAGE_KEYS.has(key)).length
    structuredSourceCount = completedKeys.length - rawPageSourceCount
    actionSourceUpdatedAt = intelligenceRows.reduce<Date | null>(
      (latest, row) => !latest || row.fetchedAt > latest ? row.fetchedAt : latest,
      null,
    )

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
        description="Sua área diária de clientes, apólices, casos e oportunidades, espelhada na National Life."
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
              label: 'Ativas em All Clients',
              value: activeInforce,
              detail: `${inforce.length} apólices no escopo completo da grade; o resumo pessoal da National usa outro denominador`,
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
              label: 'Fontes estruturadas',
              value: structuredSourceCount > 0
                ? `${structuredSourceCount}/${NATIONAL_LIFE_READ_COVERAGE.length}`
                : '—',
              detail: `${rawPageSourceCount} fontes adicionais preservadas somente como página bruta · ${syncDetail}`,
              tone:
                structuredSourceCount === NATIONAL_LIFE_READ_COVERAGE.length ? 'green' : 'gold',
            },
          ]}
        />
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          {!loadError && (
            <NationalLifeActionQueue
              rows={actions}
              sourceUpdatedAt={actionSourceUpdatedAt?.toISOString() ?? null}
            />
          )}
        </section>
        <ContextPanel eyebrow="Confiança dos dados" title="National como espelho">
          <p>
            A KeeprOne é a área operacional diária. A National Life permanece como fonte de origem,
            e cada informação precisa carregar escopo, atualização e trilha até o registro do carrier.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">
              Limite conhecido
            </p>
            <p className="mt-2">
              Páginas capturadas para descoberta não são mais contadas como relatórios. Até existir
              um parser específico e reconciliação, elas ficam somente no raw e aparecem como fonte
              ainda não estruturada — nunca como zero ou como linha operacional.
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
            <h2 className="text-xl font-semibold text-ink">Área operacional espelhada</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Trabalhe com casos, carteira e registros estruturados; o bruto fica reservado à auditoria.
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
    </Shell>
  )
}
