import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { readNationalLifeReports } from '@/lib/national-life/published-report-reader'
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
  auditVisibleCarrierCommissionRows,
  preferCanonicalCarrierCommissionRows,
  toCarrierCommissionRecords,
} from '@/lib/national-life/commission-records'
import { getAgentScopeIds } from '@/lib/agent-access'
import { CommissionsList } from './CommissionsList'
import {
  COMMISSION_EARNING_GRID_KEYS,
  LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
  LEGACY_COMMISSION_EARNING_GRID_KEY,
} from '@/lib/national-life/commission-grid-keys'
import { getServerI18n } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

type Record_ = {
  id: string
  period: string
  type: string
  level: number
  amount: unknown
  agentNumber: string | null
  payeeName: string | null
  payeeNumber: string | null
  agencyName: string | null
  source: 'NATIONAL_LIFE' | 'KEEPRONE'
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
    agentNumber: record.writingAgentNumber || null,
    payeeName: record.payeeName,
    payeeNumber: record.payeeNumber,
    agencyName: record.writingAgentAgency,
    source: 'NATIONAL_LIFE',
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
  const { copy } = await getServerI18n()
  const agent = await getCurrentAgent()
  const [user, scopeAgentIds] = await Promise.all([
    prisma.user.findUnique({ where: { id: agent.userId } }),
    getAgentScopeIds(agent.id),
  ])
  let records: Record_[] = []
  let loadError = false
  let auditRejectedCount = 0
  let auditDuplicateCount = 0

  try {
    const localConnectorEnabled = getNationalLifeLocalConnectorConfig().enabled
    const storedRows = await prisma.commissionRecord.findMany({
      where: {
        agentId: { in: scopeAgentIds },
        policy: { agentId: { in: scopeAgentIds } },
      },
      include: {
        agent: { include: { user: true } },
        policy: { include: { agent: { include: { user: true } } } },
      },
      orderBy: [{ period: 'desc' }, { createdAt: 'desc' }],
    })
    const stored: Record_[] = storedRows.map((record) => ({
      id: record.id,
      period: record.period,
      type: record.type,
      level: record.level,
      amount: record.amount,
      agentNumber: record.policy.agent.npn,
      payeeName: record.agent.user.name,
      payeeNumber: record.agent.npn,
      agencyName: null,
      source: 'KEEPRONE',
      policy: record.policy,
    }))

    let carrierRecords: Record_[] = []
    if (localConnectorEnabled) {
      const carrierRows = await readNationalLifeReports(prisma, {
          agentId: { in: scopeAgentIds },
          OR: [
            {
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
            },
            {
              deploymentScope: LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
              gridKey: LEGACY_COMMISSION_EARNING_GRID_KEY,
            },
          ],
      })
      const carrierAudit = auditVisibleCarrierCommissionRows(
        preferCanonicalCarrierCommissionRows(carrierRows, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE),
        agent.id,
      )
      const visibleCarrierRecords = carrierAudit.records
      auditRejectedCount = carrierAudit.rejectedCount
      auditDuplicateCount = carrierAudit.duplicateCount

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

    // Once National Life is connected it is the financial source of truth.
    // Mixing an imported CommissionRecord with the carrier statement can count
    // the same earning twice, so the internal import is only the fallback.
    records = (localConnectorEnabled ? carrierRecords : stored).sort((left, right) =>
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
        title={copy("Comissões", "Commissions")}
        eyebrow={copy("Extrato financeiro", "Financial statement")}
        description={copy("Confira quem produziu, quem recebeu e o que a National classificou como Personal ou Override em cada lançamento.", "Review who produced, who received, and what National Life classified as Personal or Override for every entry.")}
      >
        <Link
          href="/agent/policies"
          className="commission-header-link"
        >
          {copy("Ver apólices", "View policies")}
          <svg aria-hidden="true" viewBox="0 0 18 18" fill="none">
            <path d="M4.5 9h9M10 5.5 13.5 9 10 12.5" />
          </svg>
        </Link>
      </PageHeader>
      {loadError && (
        <ErrorBanner>
          {copy("Não foi possível carregar seu extrato agora. Tente atualizar a página.", "We couldn't load your statement right now. Try refreshing the page.")}
        </ErrorBanner>
      )}
      {!loadError && (
        <CommissionsList
          audit={{
            partial: auditRejectedCount > 0,
            rejectedCount: auditRejectedCount,
            duplicateCount: auditDuplicateCount,
          }}
          byPeriod={byPeriod.map(({ period, rows }) => ({
            period,
            rows: rows.map((record) => ({
              id: record.id,
              policyNumber: record.policy?.policyNumber ?? null,
              policyId: record.policy?.id ?? null,
              agentName: record.policy?.agent.user.name ?? copy('Não informado', 'Not provided'),
              agentNumber: record.agentNumber,
              payeeName: record.payeeName,
              payeeNumber: record.payeeNumber,
              agencyName: record.agencyName,
              source: record.source,
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
