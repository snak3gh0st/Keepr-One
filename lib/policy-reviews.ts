import { prisma } from './prisma'
import { nextReviewFrom } from './annual-review'

// Only in-force policies warrant an active annual-review cadence.
export const REVIEWABLE_POLICY_STATUS = 'INFORCE'

// Idempotently ensure a policy has an open (unfinished) annual review. Returns
// true if one was created. Safe to call repeatedly (imports, backfill) — an
// existing open review short-circuits, so re-imports never pile up reviews.
export async function ensureAnnualReview(
  policyId: string,
  effectiveDate: Date | null,
  now: Date,
): Promise<boolean> {
  const open = await prisma.policyReview.findFirst({
    where: { policyId, completedAt: null },
    select: { id: true },
  })
  if (open) return false

  await prisma.policyReview.create({
    data: { policyId, dueAt: nextReviewFrom(effectiveDate, now) },
  })
  return true
}
