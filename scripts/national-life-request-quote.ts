// Queues one Rapid Solve quote and waits for the carrier's answer.
//
//   tsx scripts/national-life-request-quote.ts <sobrenome>
//
// The surname is required rather than defaulted, because the carrier names the
// case it creates `RP-<surname>-QQ-<stamp>`: a surname already in the Recent
// panel makes the run unreadable afterwards.
//
// This is the only call in the integration that is not a read. It files
// nothing and creates no application — Rapid Solve is the carrier's own
// quoting tool — but it is a POST against a real agent account, so it runs
// only when a human asks for it, with the insured and the amount named here
// rather than defaulted.
import {
  enqueueRapidSolveQuote,
  getOwnedQuoteStatus,
} from '../lib/national-life/job-service'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import {
  DEATH_BENEFIT_OPTIONS,
  GENDERS,
  RATE_CLASSES,
  SOLVE_TYPES,
  STRATEGIES,
} from '../lib/national-life/rapid-solve'

const buildQuote = (lastName: string) => ({
  issueState: 'FL',
  firstName: 'Paulo',
  lastName,
  dateOfBirth: '02/06/1988',
  gender: GENDERS.MALE,
  rateClass: RATE_CLASSES.STANDARD_NON_TOBACCO,
  solveType: SOLVE_TYPES.PREMIUM_DEATH_BENEFIT_FOCUS,
  amount: 300,
  deathBenefitOption: DEATH_BENEFIT_OPTIONS.LEVEL,
  strategy: STRATEGIES.CAP_FOCUS,
  allocation: 100,
  productCode: '956',
})

const POLL_MS = 2_000
const TIMEOUT_MS = 8 * 60_000

async function main() {
  const env = getNationalLifeEnv()

  const surname = process.argv.slice(2).find((value) => !value.startsWith('-'))
  if (!surname) {
    throw new Error('name the insured surname: tsx scripts/national-life-request-quote.ts <sobrenome>')
  }
  const QUOTE = buildQuote(surname)

  const stored = await prisma.agentIntegrationSession.findFirst({
    where: {
      provider: 'NATIONAL_LIFE',
      purpose: 'CARRIER_SESSION',
      status: 'CONNECTED',
      deploymentScope: env.sessionScopeId,
    },
    orderBy: { lastConnectedAt: 'desc' },
    select: { agentId: true },
  })
  if (!stored) {
    throw new Error('no CONNECTED National Life session stored')
  }

  const { jobId, duplicate } = await enqueueRapidSolveQuote({
    agentId: stored.agentId,
    quote: QUOTE,
  })
  console.log(JSON.stringify({ jobId, duplicate, asked: QUOTE }, null, 2))

  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const status = await getOwnedQuoteStatus(stored.agentId, jobId)

    if (status && status.state !== 'PENDING') {
      console.log(JSON.stringify({ jobId, status }, null, 2))
      break
    }

    if (Date.now() > deadline) {
      // Saying it is still queued beats reporting a failure that did not happen.
      console.log(JSON.stringify({ jobId, stillPending: true }, null, 2))
      break
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  await prisma.$disconnect()
  process.exit(1)
})
