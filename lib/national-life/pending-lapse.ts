/** The exact source-status value used by the Prisma case-insensitive predicate. */
export const CANONICAL_PENDING_LAPSE_STATUS = 'Pending Lapse'

/** Matches the exact case-insensitive Prisma predicate used by policy history. */
export function isCanonicalPendingLapse(sourceStatus: string | null | undefined): boolean {
  return sourceStatus?.toLocaleLowerCase('en-US')
    === CANONICAL_PENDING_LAPSE_STATUS.toLocaleLowerCase('en-US')
}
