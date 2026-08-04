import Link from 'next/link'
import { getCurrentAgent } from '@/lib/agent-context'
import { getNationalLifeEnv, isNationalLifeConfigured } from '@/lib/national-life/env'
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
  type CommissionRow,
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

function toCommissionRow(row: {
  id: string
  gridKey: string
  label: string | null
  primaryDate: string | null
  amounts: unknown
}): CommissionRow {
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

  if (!isNationalLifeConfigured()) {
    return (
      <Shell role="AGENT" userName={user?.name ?? ''}>
        <PageHeader
          title="Dados National Life"
          eyebrow="Integração"
          description="A integração não está configurada neste ambiente."
        />
        <ErrorBanner>National Life não está configurada. Fale com o suporte.</ErrorBanner>
      </Shell>
    )
  }

  const deploymentScope = getNationalLifeEnv().sessionScopeId

  let cases: CaseRow[] = []
  let inforce: InforceRow[] = []
  let commissions: CommissionRow[] = []
  let lastSyncedAt: Date | null = null
  let loadError = false
  let foresightCases: ForesightCaseRow[] = []
  let foresightRun: Awaited<ReturnType<typeof foresightRunStore.getStatus>> = null

  try {
    const [caseRows, inforceRows, reportRows, session, foresightRows, currentForesightRun] = await Promise.all([
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
      prisma.agentIntegrationSession.findFirst({
        where: {
          agentId: agent.id,
          deploymentScope,
          provider: 'NATIONAL_LIFE',
          purpose: 'CARRIER_SESSION',
        },
        select: { lastConnectedAt: true, lastUsedAt: true },
      }),
      prisma.nationalLifeForesightCaseSnapshot.findMany({
        where: { agentId: agent.id, deploymentScope, provider: 'NATIONAL_LIFE' },
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
      }),
      foresightRunStore.getStatus(agent.id, deploymentScope),
    ])

    cases = caseRows
    inforce = inforceRows
    commissions = reportRows.map(toCommissionRow)
    // lastUsedAt advances on every sync; lastConnectedAt only on a fresh login.
    lastSyncedAt = session?.lastUsedAt ?? session?.lastConnectedAt ?? null
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
        title="Dados National Life"
        eyebrow="Integração"
        description="Casos, apólices em vigor e comissões lidos direto do portal da National Life."
      >
        <Link
          href="/agent/integrations/national-life"
          className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.06]"
        >
          Gerenciar conexão
        </Link>
      </PageHeader>

      {loadError && (
        <ErrorBanner>
          Não foi possível carregar os dados da National Life agora. Tente atualizar a página.
        </ErrorBanner>
      )}

      {!loadError && (
        <ModuleSummary
          label="Resumo do que veio do portal"
          items={[
            {
              label: 'Casos',
              value: cases.length,
              detail: 'Novos negócios e encerrados recentemente',
            },
            {
              label: 'Em vigor',
              value: activeInforce,
              detail: `${inforce.length} apólices lidas · ${attentionInforce} pedem atenção`,
              tone: attentionInforce > 0 ? 'gold' : 'green',
            },
            {
              label: 'Linhas de comissão',
              value: commissions.length,
              detail: lastSyncedAt
                ? `Última sincronização em ${lastSyncedAt.toLocaleString('pt-BR')}`
                : 'Ainda não sincronizado',
            },
          ]}
        />
      )}

      <div className="module-content-grid">
        <section className="module-main-surface">
          {!loadError && (
            <NationalLifeDataTabs cases={cases} inforce={inforce} commissions={commissions} />
          )}
        </section>
        <ContextPanel eyebrow="Como ler" title="Direto do portal">
          <p>
            Estes registros são uma cópia do que o portal da National Life mostra, guardada no
            momento da sincronização. Eles não substituem suas apólices no Keepr One.
          </p>
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Valores</p>
            <p className="mt-2">
              Prêmios e comissões chegam como texto do carrier e são exibidos como recebidos, sem
              recálculo.
            </p>
          </div>
        </ContextPanel>
      </div>
      <section className="mt-8 module-main-surface">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-paper/45">Foresight</p>
            <h2 className="mt-1 text-xl font-semibold text-paper">Casos observados no portal</h2>
          </div>
          <p className="text-sm text-paper/55">Leitura somente leitura · {foresightCases.length} casos</p>
        </div>
        <ForesightCaseTabs cases={foresightCases} run={foresightRun} />
      </section>
    </Shell>
  )
}
