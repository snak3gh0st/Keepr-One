import type { PrismaClient } from '@prisma/client'
import Decimal from 'decimal.js'
import { buildProductionRanking, getMonthBounds } from '@/lib/agent-production'
import { auditCarrierCommissionRows, preferCanonicalCarrierCommissionRows, type ScopedCarrierCommissionSourceRow } from './commission-records'
import { commissionEarningIdentity } from './commission-identity'
import { COMMISSION_EARNING_GRID_KEYS, LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE, LEGACY_COMMISSION_EARNING_GRID_KEY } from './commission-grid-keys'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './local-connector/config'

type ProductionInput = {
  agents: { id: string; npn: string | null; name: string }[]
  policies: { agentId: string; premium: unknown; effectiveDate: Date | null }[]
  carrierRows: (ScopedCarrierCommissionSourceRow & { gridKey: string })[]
  legacy: { agentId: string; amount: unknown; period: string; type: string }[]
  period?: string
}
const add = (left: number, right: number) => new Decimal(left).plus(right).toNumber()
const validSource = (row: ProductionInput['carrierRows'][number]) =>
  (row.deploymentScope === LOCAL_CONNECTOR_DEPLOYMENT_SCOPE && (COMMISSION_EARNING_GRID_KEYS as readonly string[]).includes(row.gridKey))
  || (row.deploymentScope === LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE && row.gridKey === LEGACY_COMMISSION_EARNING_GRID_KEY)

/** Global administrative read. Connector owners establish provenance only;
 * direct production belongs to the carrier's writing NPN. Never add sources. */
export function buildAdminProduction(input: ProductionInput) {
  const supported = input.carrierRows.filter(validSource)
  const canonical = preferCanonicalCarrierCommissionRows(supported, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE)
  const audit = auditCarrierCommissionRows(canonical)
  const rawById = new Map(canonical.map((row) => [row.id, row]))
  const seen = new Set<string>()
  let globalDuplicates = audit.duplicateCount
  const records = audit.records.filter((record) => {
    const row = rawById.get(record.id)!
    const identity = commissionEarningIdentity(row.raw, row.amounts)!
    if (seen.has(identity)) { globalDuplicates++; return false }
    seen.add(identity)
    return true
  })
  // Even rejected carrier evidence prevents a silent switch to manual totals.
  const source = supported.length > 0 ? 'NATIONAL_LIFE' as const : 'LEGACY' as const
  const periods = [...new Set([
    new Date().toISOString().slice(0, 7),
    ...(source === 'NATIONAL_LIFE' ? records.map((row) => row.period) : input.legacy.map((row) => row.period)),
    ...input.policies.flatMap((row) => row.effectiveDate ? [row.effectiveDate.toISOString().slice(0, 7)] : []),
  ])].filter((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period)).sort((a, b) => b.localeCompare(a))
  const period = input.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.period) ? input.period : periods[0]
  if (!periods.includes(period)) periods.push(period)
  periods.sort((a, b) => b.localeCompare(a))
  const bounds = getMonthBounds(period)
  const coverage = {
    receivedRows: supported.length,
    canonicalRows: canonical.length,
    rejectedRows: audit.rejectedCount,
    rejectedByReason: audit.rejectedByReason,
    missingWritingAgentRows: audit.rejectedByReason.MISSING_WRITING_AGENT_NUMBER ?? 0,
    missingPaymentDateRows: audit.rejectedByReason.MISSING_PAYMENT_DATE ?? 0,
    globalDuplicates,
    ignoredOverrides: 0,
    unmappedDirectRows: 0,
    unmappedDirectAmount: 0,
    policiesWithoutEffectiveDate: input.policies.filter((row) => !row.effectiveDate).length,
  }
  const agentByNpn = new Map(input.agents.filter((agent) => agent.npn?.trim()).map((agent) => [agent.npn!.trim(), agent.id]))
  const commissions = new Map<string, number>()
  if (source === 'NATIONAL_LIFE') {
    for (const record of records) {
      if (record.period !== period) continue
      if (record.type !== 'DIRECT') { coverage.ignoredOverrides++; continue }
      const agentId = agentByNpn.get(record.writingAgentNumber.trim())
      if (!agentId) {
        coverage.unmappedDirectRows++
        coverage.unmappedDirectAmount = add(coverage.unmappedDirectAmount, record.amount)
        continue
      }
      commissions.set(agentId, add(commissions.get(agentId) ?? 0, record.amount))
    }
  } else {
    for (const record of input.legacy) {
      if (record.period !== period || record.type !== 'DIRECT') continue
      commissions.set(record.agentId, add(commissions.get(record.agentId) ?? 0, Number(record.amount)))
    }
  }
  const policies = new Map<string, { agentId: string; count: number; premiumSum: number }>()
  for (const row of input.policies) {
    if (!row.effectiveDate || row.effectiveDate < bounds.start || row.effectiveDate >= bounds.end) continue
    const stat = policies.get(row.agentId) ?? { agentId: row.agentId, count: 0, premiumSum: 0 }
    stat.count++
    stat.premiumSum = add(stat.premiumSum, Number(row.premium ?? 0))
    policies.set(row.agentId, stat)
  }
  return {
    source, period, periods, coverage,
    rows: buildProductionRanking(input.agents, [...policies.values()], [...commissions].map(([agentId, sum]) => ({ agentId, sum }))),
  }
}

export async function loadAdminProduction(prisma: PrismaClient, period?: string) {
  const [agents, policies, publishedLocalRows, legacyCarrierRows] = await Promise.all([
    prisma.agent.findMany({ select: { id: true, npn: true, user: { select: { name: true } } } }),
    prisma.policy.findMany({ select: { agentId: true, effectiveDate: true, premium: true } }),
    prisma.nationalLifePublishedReportRow.findMany({
      where: {
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        gridKey: { in: [...COMMISSION_EARNING_GRID_KEYS] },
      },
      select: { id: true, agentId: true, deploymentScope: true, gridKey: true, raw: true, amounts: true },
    }),
    prisma.nationalLifeReportRow.findMany({
      where: {
        deploymentScope: LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE,
        gridKey: LEGACY_COMMISSION_EARNING_GRID_KEY,
      },
      select: { id: true, agentId: true, deploymentScope: true, gridKey: true, raw: true, amounts: true },
    }),
  ])
  const carrierRows = [...publishedLocalRows, ...legacyCarrierRows]
  const legacy = carrierRows.length === 0
    ? await prisma.commissionRecord.findMany({ where: { type: 'DIRECT' }, select: { agentId: true, period: true, amount: true, type: true } })
    : []
  return buildAdminProduction({ agents: agents.map((agent) => ({ ...agent, name: agent.user.name })), policies, carrierRows, legacy, period })
}
