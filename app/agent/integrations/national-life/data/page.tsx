import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { getCurrentAgentAccess } from '@/lib/agent-access'
import {
  getNationalLifeLocalConnectorConfig,
} from '@/lib/national-life/local-connector/config'
import { CANONICAL_NATIONAL_LIFE_SYNC } from '@/lib/national-life/sync-engine'
import {
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
  NATIONAL_LIFE_READ_COVERAGE,
} from '@/lib/national-life/read-coverage'
import { NATIONAL_LIFE_PERSONAL_GRID_KEYS } from '@/lib/national-life/plan-access-catalog'
import { classifyCarrierCommissionLevel } from '@/lib/national-life/commission-records'
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
  type CaseRow,
  type PortalReportRow,
  type InforceRow,
} from './NationalLifeDataTabs'
import {
  NationalLifeActionQueue,
  type NationalLifeActionRow,
} from './NationalLifeActionQueue'
import { getServerI18n } from '@/lib/i18n/server'
import { localeFor } from '@/lib/i18n/config'

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
  raw: true,
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
  const { copy, language } = await getServerI18n()
  const locale = localeFor(language)
  const agent = await getCurrentAgent()
  const [user, access] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    getCurrentAgentAccess(),
  ])
  const localEnabled = getNationalLifeLocalConnectorConfig().enabled
  const structuredSourceTarget = NATIONAL_LIFE_READ_COVERAGE.filter(
    (source) =>
      !DISCOVERY_PAGE_KEYS.has(source.key)
      && (
        access.canViewAgencyNationalLife
        || (NATIONAL_LIFE_PERSONAL_GRID_KEYS as readonly string[]).includes(source.key)
      ),
  ).length

  if (!localEnabled) {
    return (
      <Shell role="AGENT" userName={user?.name ?? ''}>
        <PageHeader
          title={copy('Dados da National Life', 'National Life data')}
          eyebrow={copy('Integração', 'Integration')}
          description={copy('Esta integração ainda não está configurada.', 'This integration is not set up yet.')}
        />
        <ErrorBanner>{copy('A National Life ainda não está configurada. Fale com o suporte da Keepr One para ativá-la.', 'National Life is not set up yet. Contact Keepr One support to turn it on.')}</ErrorBanner>
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
        where: {
          agentId: { in: access.scopeAgentIds },
          deploymentScope: CANONICAL_SCOPE,
        },
        select: caseSelect,
        orderBy: [{ submitDate: 'desc' }, { policyNo: 'asc' }],
      }),
      prisma.nationalLifeInforcePolicy.findMany({
        where: {
          agentId: { in: access.scopeAgentIds },
          deploymentScope: CANONICAL_SCOPE,
        },
        select: inforceSelect,
        orderBy: [{ policyStatus: 'asc' }, { policyNumber: 'asc' }],
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: { in: access.scopeAgentIds },
          deploymentScope: CANONICAL_SCOPE,
          gridKey: 'COMMISSIONS_EARNING_REPORT',
        },
        select: reportSelect,
        orderBy: [{ gridKey: 'asc' }, { primaryDate: 'desc' }],
      }),
      prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: { in: access.scopeAgentIds },
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
          agentId: { in: access.scopeAgentIds },
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
    reports = reportRows
      .filter((row) => {
        const raw = row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
          ? row.raw as Record<string, unknown>
          : {}
        return classifyCarrierCommissionLevel(raw.WritingAgtLevel) === 'DIRECT'
      })
      .map(toPortalReportRow)
    lastSyncedAt = localRun?.completedAt ?? localRun?.updatedAt ?? null
    const completedKeys = localRun?.stageCompletions.map((row) => row.gridKey) ?? []
    const visibleCompletedKeys = access.canViewAgencyNationalLife
      ? completedKeys
      : completedKeys.filter((key) =>
          (NATIONAL_LIFE_PERSONAL_GRID_KEYS as readonly string[]).includes(key),
        )
    rawPageSourceCount = visibleCompletedKeys.filter((key) => DISCOVERY_PAGE_KEYS.has(key)).length
    structuredSourceCount = visibleCompletedKeys.length - rawPageSourceCount
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
            agentId: { in: access.scopeAgentIds },
            policyNumber: { in: actionQueue.map((item) => item.policyNumber) },
          },
          select: { id: true, policyNumber: true },
        })
      : []
    const policyIds = new Map(linkedPolicies.map((policy) => [policy.policyNumber, policy.id]))
    actions = actionQueue.flatMap((item) => {
      const policyId = policyIds.get(item.policyNumber)
      return policyId
        ? [{ ...item, occurredAt: item.occurredAt.toISOString(), policyId }]
        : []
    })
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
    ? lastSyncedAt.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
    : copy('Ainda não sincronizado', 'Not synced yet')

  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="National Life"
        eyebrow={copy('Carteira conectada', 'Connected book')}
        description={access.canViewAgencyNationalLife
          ? copy('Dados diretos dos agentes com assinatura ativa na agência, espelhados na National Life.', 'Direct data from agents with an active agency subscription, mirrored from National Life.')
          : copy('Seus clientes, apólices, casos e oportunidades pessoais, espelhados na National Life.', 'Your personal clients, policies, cases, and opportunities, mirrored from National Life.')}
      >
        <Link
          href="/agent/integrations/national-life"
          className="inline-flex items-center rounded-full border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-teal hover:bg-panel"
        >
          {copy('Gerenciar conexão', 'Manage connection')}
        </Link>
      </PageHeader>

      {loadError && (
        <ErrorBanner>
          {copy('Não foi possível carregar seus dados da National Life agora. Atualize a página para tentar novamente.', 'We could not load your National Life data right now. Refresh the page to try again.')}
        </ErrorBanner>
      )}

      {!loadError && (
        <ModuleSummary
          label={copy('Resumo da National Life', 'National Life summary')}
          items={[
            {
              label: copy('Ativas em All Clients', 'Active in All Clients'),
              value: activeInforce,
              detail: copy('{count} apólices no escopo completo da grade; o resumo pessoal da National usa outro denominador', '{count} policies in the full grid scope; National’s personal summary uses a different denominator', { count: inforce.length }),
              tone: 'green',
            },
            {
              label: copy('Precisa de ação', 'Needs action'),
              value: riskActions,
              detail: copy('Apólices com sinal de risco nos últimos 30 dias', 'Policies with a risk signal in the last 30 days'),
              tone: riskActions > 0 ? 'danger' : 'green',
            },
            {
              label: copy('Oportunidades', 'Opportunities'),
              value: opportunityActions,
              detail: copy('Aniversários e datas para relacionamento', 'Birthdays and dates for client outreach'),
              tone: opportunityActions > 0 ? 'gold' : 'neutral',
            },
            {
              label: copy('Fontes estruturadas', 'Structured sources'),
              value: structuredSourceCount > 0
                ? `${structuredSourceCount}/${structuredSourceTarget}`
                : '—',
              detail: copy('{count} fontes adicionais preservadas somente como página bruta · {sync}', '{count} additional sources preserved only as raw pages · {sync}', { count: rawPageSourceCount, sync: syncDetail }),
              tone:
                structuredSourceCount === structuredSourceTarget ? 'green' : 'gold',
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
        <ContextPanel eyebrow={copy('Confiança dos dados', 'Data confidence')} title={copy('National como espelho', 'National as the source mirror')}>
          <p>
            {copy('A Keepr One é a área operacional diária. A National Life permanece como fonte de origem, e cada informação precisa carregar escopo, atualização e trilha até o registro da operadora.', 'Keepr One is the daily operational workspace. National Life remains the source of record, and every item must carry scope, freshness, and a trail back to the carrier record.')}
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">
              {copy('Limite conhecido', 'Known limitation')}
            </p>
            <p className="mt-2">
              {copy('Páginas capturadas para descoberta não são mais contadas como relatórios. Até existir um parser específico e reconciliação, elas ficam somente nos dados brutos e aparecem como fonte ainda não estruturada — nunca como zero ou como linha operacional.', 'Pages captured for discovery are no longer counted as reports. Until a dedicated parser and reconciliation exist, they remain only in raw data and appear as an unstructured source — never as zero or as an operational row.')}
            </p>
          </div>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">
              {copy('Estado da carteira', 'Book status')}
            </p>
            <p className="mt-2">
              {copy('{count} apólices estão em lapse, pending lapse ou not active. A fila de ação usa somente sinais registrados nos últimos 30 dias, para não misturar histórico antigo com prioridade atual.', '{count} policies are in lapse, pending lapse, or not active status. The action queue uses only signals recorded in the last 30 days so older history is not mixed with current priorities.', { count: attentionInforce })}
            </p>
          </div>
        </ContextPanel>
      </div>
      <section className="mt-8 module-main-surface">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-ink">{copy('Área operacional espelhada', 'Mirrored operational area')}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {copy('Trabalhe com casos, carteira e registros estruturados; os dados brutos ficam reservados à auditoria.', 'Work with cases, policies, and structured records; raw data remains reserved for audit.')}
            </p>
          </div>
          <p className="text-sm text-ink-muted">
            {copy('{cases} casos · {policies} apólices · {reports} linhas de relatório', '{cases} cases · {policies} policies · {reports} report rows', { cases: cases.length, policies: inforce.length, reports: reports.length })}
          </p>
        </div>
        {!loadError && (
          <NationalLifeDataTabs cases={cases} inforce={inforce} reports={reports} />
        )}
      </section>
    </Shell>
  )
}
