import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { decimalToNumber } from '@/lib/decimal'
import { Shell } from '@/components/Shell'
import { PageHeader } from '@/components/PageHeader'
import { ErrorBanner } from '@/components/ErrorBanner'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import {
  toCarrierCommissionRecords,
  toVisibleCarrierCommissionRecords,
} from '@/lib/national-life/commission-records'
import { getAgentScopeIds } from '@/lib/agent-access'
import { CommissionsList } from './CommissionsList'
import { COMMISSION_EARNING_GRID_KEYS } from '@/lib/national-life/commission-grid-keys'

export const dynamic = 'force-dynamic'

type Record_ = {
  id: string
  period: string
  type: string
  level: number
  amount: unknown
  policy: { id: string; policyNumber: string; agent: { user: { name: string } } } | null
}

/// Shared with the agent dashboard, which used to sum only CommissionRecord and
/// therefore showed zero while this page showed the real figure. See
/// `lib/national-life/commission-records` for why the carrier rows are read
/// rather than promoted.
function toCommissionRecords(
  records: ReturnType<typeof toCarrierCommissionRecords>,
  policyIdByNumber: ReadonlyMap<string, string>,
): Record_[] {
  return records.map((record) => ({
    id: record.id,
    period: record.period,
    type: record.type,
    level: record.level,
    amount: record.amount,
    policy: {
      // Empty when the policy is not in this book. That is the common case —
      // renewals keep paying on policies that have left inforce — and it must
      // not hide the policy number, which the carrier always gives us.
      id: policyIdByNumber.get(record.policyNumber) ?? '',
      policyNumber: record.policyNumber,
      agent: { user: { name: record.writingAgentName } },
    },
  }))
}

export default async function CommissionsPage() {
  const agent = await getCurrentAgent()
  const [user, scopeAgentIds] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    getAgentScopeIds(agent.id),
  ])
  let records: Record_[] = []
  let loadError = false

  try {
    const localConnectorEnabled = getNationalLifeLocalConnectorConfig().enabled
    const stored = await prisma.commissionRecord.findMany({
      where: {
        agentId: { in: scopeAgentIds },
        policy: { agentId: { in: scopeAgentIds } },
      },
      include: { policy: { include: { agent: { include: { user: true } } } } },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    })

    let carrierRecords: Record_[] = []
    if (localConnectorEnabled) {
      const carrierRows = await prisma.nationalLifeReportRow.findMany({
        where: {
          agentId: { in: scopeAgentIds },
          deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
          gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
        },
        select: { id: true, agentId: true, raw: true, amounts: true },
      })
      const visibleCarrierRecords = toVisibleCarrierCommissionRecords(
        carrierRows,
        agent.id,
      )

      // Resolve the ones that do exist locally so their number becomes a link.
      const numbers = Array.from(
        new Set(
          visibleCarrierRecords
            .map((record) => record.policyNumber)
            .filter((number) => number && number !== '—'),
        ),
      )
      const localPolicies = numbers.length
        ? await prisma.policy.findMany({
            where: {
              agentId: { in: scopeAgentIds },
              policyNumber: { in: numbers },
            },
            select: { id: true, policyNumber: true },
          })
        : []

      carrierRecords = toCommissionRecords(
        visibleCarrierRecords,
        new Map(localPolicies.map((policy) => [policy.policyNumber, policy.id])),
      )
    }

    records = [...stored, ...carrierRecords].sort((left, right) =>
      right.period.localeCompare(left.period),
    )
  } catch (error) {
    console.error('Commissions query error', error)
    loadError = true
  }

  const rowsByPeriod = new Map<string, Record_[]>()
  for (const record of records) {
    const periodRows = rowsByPeriod.get(record.period) ?? []
    periodRows.push(record)
    rowsByPeriod.set(record.period, periodRows)
  }
  const byPeriod = Array.from(rowsByPeriod, ([period, rows]) => ({ period, rows }))
  return (
    <Shell role="AGENT" userName={user?.name ?? ''}>
      <PageHeader
        title="Comissões"
        eyebrow="Extrato financeiro"
        description="Acompanhe o valor de cada lançamento, identifique a apólice de origem e diferencie sua produção dos repasses da equipe."
      >
        <Link
          href="/agent/policies"
          className="commission-header-link"
        >
          Ver apólices
          <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
            <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
          </svg>
        </Link>
      </PageHeader>
      {loadError && (
        <ErrorBanner>
          Não foi possível carregar seu extrato agora. Tente atualizar a página.
        </ErrorBanner>
      )}
      {!loadError && (
        <CommissionsList
          byPeriod={byPeriod.map(({ period, rows }) => ({
            period,
            rows: rows.map((record) => ({
              id: record.id,
              policyNumber: record.policy?.policyNumber ?? null,
              policyId: record.policy?.id ?? null,
              agentName: record.policy?.agent.user.name ?? 'Não informado',
              type: record.type === 'DIRECT' ? 'DIRECT' : 'OVERRIDE',
              level: record.level,
              amount: decimalToNumber(record.amount).toFixed(2),
            })),
          }))}
        />
      )}
    </Shell>
  )
}
