export type CommissionAttributionInput = {
  agentName: string
  agentNumber: string | null
  type: 'DIRECT' | 'OVERRIDE'
  amount: number
}

export type CommissionAgentBreakdown = {
  key: string
  agentName: string
  agentNumber: string | null
  directAmount: number
  directCount: number
  overrideAmount: number
  overrideCount: number
  totalAmount: number
}

function normalizedAgentNumber(value: string | null): string | null {
  if (!value) return null
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized || null
}

function normalizedAgentName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Builds the statement at the National Life writing-agent grain. A producer
 * number is the identity when supplied; names are labels only and never used
 * to claim that a carrier producer is a KeeprOne user.
 */
export function buildCommissionAgentBreakdown(
  entries: readonly CommissionAttributionInput[],
): CommissionAgentBreakdown[] {
  const rows = new Map<string, CommissionAgentBreakdown>()

  for (const entry of entries) {
    const agentNumber = normalizedAgentNumber(entry.agentNumber)
    const agentName = normalizedAgentName(entry.agentName)
    const key = agentNumber
      ? `number:${agentNumber}`
      : `unattributed:${agentName.toLocaleLowerCase('en-US') || 'unknown'}`
    const current = rows.get(key) ?? {
      key,
      agentName: agentName || 'Not provided',
      agentNumber,
      directAmount: 0,
      directCount: 0,
      overrideAmount: 0,
      overrideCount: 0,
      totalAmount: 0,
    }

    // Prefer the latest non-empty display label without letting punctuation in
    // a name split one producer number into multiple rows.
    if (agentName) current.agentName = agentName
    current.totalAmount += entry.amount
    if (entry.type === 'DIRECT') {
      current.directAmount += entry.amount
      current.directCount += 1
    } else {
      current.overrideAmount += entry.amount
      current.overrideCount += 1
    }
    rows.set(key, current)
  }

  return [...rows.values()].sort((left, right) =>
    Math.abs(right.totalAmount) - Math.abs(left.totalAmount)
      || left.agentName.localeCompare(right.agentName),
  )
}
