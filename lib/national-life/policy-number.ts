/// The carrier does not spell a policy number the same way twice.
///
/// The same policy is `766815100` in the client-intelligence log, `00766550300`
/// in correspondence, and `LS0648595` or `1512428X` in our own records. The
/// correspondence grid pads with a leading `00` and nothing else does, so a
/// direct join against it matched zero of sixty-four rows — the documents
/// section of the policy screen had been rendering empty for every policy
/// since it was written, which looks exactly like a policy with no documents.
const CARRIER_PAD = /^00(?=\d*[A-Za-z]|\d)/

/// Strips the padding correspondence adds, and nothing more.
///
/// Deliberately not a general-purpose cleaner: it does not strip the `X` some
/// of our own numbers carry, nor the `LS` prefix, because those distinguish
/// real policies rather than decorate them. Over-normalising would join rows
/// that belong to different contracts, which is worse than joining none.
export function normalizeCarrierPolicyNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (trimmed === '') return null

  const stripped = trimmed.replace(CARRIER_PAD, '')
  return stripped === '' ? null : stripped
}

/// Every spelling a grid might hold for one of our policy numbers.
///
/// Used to query rather than to rewrite: normalising at write time would mean
/// re-syncing every grid, and the carrier is free to invent a third spelling
/// tomorrow. Matching both on read costs nothing and does not lose the
/// carrier's original.
export function carrierPolicyNumberVariants(policyNumber: string): string[] {
  const trimmed = policyNumber.trim()
  if (trimmed === '') return []

  return Array.from(new Set([trimmed, `00${trimmed}`]))
}
