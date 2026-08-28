function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/**
 * Stable identity for one earning transaction.
 *
 * National Life rotates `CommissionStatementId` when the same statement is
 * read again. Every other field remains unchanged, so keeping that transport
 * id in the database key turns every sync into another copy of the same money.
 * The raw row still retains the statement id as carrier evidence; it is only
 * excluded from transaction identity.
 */
export function commissionEarningIdentity(rawValue: unknown, amountsValue?: unknown): string | null {
  const raw = asRecord(rawValue)
  const amounts = asRecord(amountsValue)
  const policyNumber = raw.PolicyNumber
  const grossCommEarned = raw.GrossCommEarned ?? amounts.GrossCommEarned
  if (policyNumber === undefined || policyNumber === null || grossCommEarned === undefined || grossCommEarned === null) {
    return null
  }

  const stable: Record<string, unknown> = {
    ...raw,
    GrossCommEarned: grossCommEarned,
  }
  delete stable.CommissionStatementId

  return JSON.stringify(
    Object.fromEntries(Object.entries(stable).sort(([left], [right]) => left.localeCompare(right))),
  )
}
