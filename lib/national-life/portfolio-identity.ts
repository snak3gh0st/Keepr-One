/// Identity is the one place in this ingestion where a mistake is irreversible and
/// visible: fusing two people puts one client's policy on another's record. The
/// rules below deliberately fail towards creating a duplicate, which an agent can
/// merge later, and never towards a merge, which nobody can undo.
///
/// This is not hypothetical. Sixteen names in the live book carry more than one
/// date of birth.
///
/// The caller must scope `existing` to a single agent. These functions never see
/// an agent id and so cannot enforce it.

export type ClientCandidate = {
  id: string | null
  name: string
  dateOfBirth: Date | null
}

export type IdentityMatch =
  | { kind: 'MATCHED'; clientId: string }
  | { kind: 'MATCHED_LOW_CONFIDENCE'; clientId: string }
  | { kind: 'CREATE' }

export function normalizeClientName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false
  return a.getTime() === b.getTime()
}

export function matchClient(
  candidate: ClientCandidate,
  existing: readonly ClientCandidate[],
): IdentityMatch {
  const name = normalizeClientName(candidate.name)
  const sameName = existing.filter((one) => normalizeClientName(one.name) === name)
  if (sameName.length === 0) return { kind: 'CREATE' }

  if (candidate.dateOfBirth) {
    const exact = sameName.find((one) => sameDay(one.dateOfBirth, candidate.dateOfBirth))
    if (exact?.id) return { kind: 'MATCHED', clientId: exact.id }
    // A name match whose date of birth disagrees is evidence of a different
    // person, not of a missing field.
    return { kind: 'CREATE' }
  }

  // Without a date of birth the only safe partner is one that has none either.
  // Attaching to a record that carries a date of birth would be asserting an
  // identity nothing supports. Two undated namesakes are a coin toss, and a coin
  // toss here shows one client's policy on another's record.
  const undated = sameName.filter((one) => one.dateOfBirth === null)
  if (undated.length === 1 && undated[0]?.id) {
    return { kind: 'MATCHED_LOW_CONFIDENCE', clientId: undated[0].id }
  }
  return { kind: 'CREATE' }
}
