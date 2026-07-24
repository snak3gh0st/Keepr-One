// One-time backfill: ensure every in-force policy has an open annual review.
// Idempotent — re-running skips policies that already have one. Run once after
// deploying the annual-review feature:  pnpm backfill:reviews
import { prisma } from '../lib/prisma'
import { ensureAnnualReview, REVIEWABLE_POLICY_STATUS } from '../lib/policy-reviews'

async function main() {
  const now = new Date()
  const policies = await prisma.policy.findMany({
    where: { status: REVIEWABLE_POLICY_STATUS },
    select: { id: true, effectiveDate: true },
  })

  let created = 0
  for (const p of policies) {
    if (await ensureAnnualReview(p.id, p.effectiveDate, now)) created += 1
  }

  console.log(`In-force policies scanned: ${policies.length}`)
  console.log(`Annual reviews created:    ${created}`)
  console.log(`Already had one:           ${policies.length - created}`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
