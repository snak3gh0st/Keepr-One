// Resolves one conflict: the solve type values the page offers are not the ones
// `lib/national-life/rapid-solve.ts` sends.
//
//   tsx scripts/national-life-describe-rapid-solve-mapping.ts
//
// The page renders `Specify_Amount`, `Based_on_Target_Premium` and
// `Min_DB_Max_Cash_Value`. The module sends `Specify_Amount`,
// `Premium-DeathBenefitFocus` and `Premium-AccumulationFocus`. Either the
// bundle maps one set to the other, or one of them is wrong — and if the module
// is wrong, two of the three solve types come back as carrier refusals that
// look like the carrier declining to quote rather than us asking incorrectly.
//
// Prints the bundle around each interesting token, so a human reads the mapping
// rather than a regex guessing at it. GET of a static asset; nothing submitted.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const ILLUSTRATIONS_PATH = '/agent/tools/business-tools/illustrations'

const TOKENS = [
  // How the amount and the age reach the payload. The endpoint answers HTTP 500
  // with the exception hidden by customErrors, so the remaining way to tell a
  // string from a number is to read what the carrier's own script puts there.
  'faceAmountVal',
  'premiumAmountVal',
  'issueAge',
  'IssueState',
  'SolveType',
  'Based_on_Target_Premium',
  'Min_DB_Max_Cash_Value',
  'Premium-DeathBenefitFocus',
  'Premium-AccumulationFocus',
  'Specify_Amount',
  'RateClass',
  'Strategy',
  'Allocation',
  'DeathBenefitOption',
  'PremiumMode',
]

/// Every place the bundle mentions a token, with enough around it to read what
/// it does with it.
export function excerptsAround(code: string, token: string, radius = 220): string[] {
  const found: string[] = []
  let index = code.indexOf(token)

  while (index !== -1 && found.length < 6) {
    found.push(
      code
        .slice(Math.max(0, index - radius), index + token.length + radius)
        .replace(/\s+/g, ' ')
        .trim(),
    )
    index = code.indexOf(token, index + token.length)
  }

  return found
}

async function main() {
  const env = getNationalLifeEnv()

  const stored = await prisma.agentIntegrationSession.findFirst({
    where: {
      provider: 'NATIONAL_LIFE',
      purpose: 'CARRIER_SESSION',
      status: 'CONNECTED',
      deploymentScope: env.sessionScopeId,
    },
    orderBy: { lastConnectedAt: 'desc' },
  })
  if (!stored?.keyVersion || !stored.iv || !stored.ciphertext || !stored.authTag) {
    throw new Error('no usable CONNECTED National Life session stored')
  }

  const sessionContext = decryptBrowserContext(
    {
      algorithm: 'aes-256-gcm',
      keyVersion: stored.keyVersion,
      iv: stored.iv,
      ciphertext: stored.ciphertext,
      authTag: stored.authTag,
    },
    {
      agentId: stored.agentId,
      scopeId: env.sessionScopeId,
      provider: 'NATIONAL_LIFE',
      purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
      formatVersion: 1,
    },
    env.sessionKeys,
  )

  const ran = await withBrowserLockWaiting(prisma, async () => {
    const session = await createSteelBrowserSession(env, { sessionContext })
    try {
      await session.page.goto(new URL(ILLUSTRATIONS_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await session.page.waitForTimeout(8_000)

      const response = await session.page.request.get(
        new URL('/Assets/Agent/js/rapidsolve.js', env.portalLoginUrl).toString(),
      )
      if (!response.ok()) {
        console.log(JSON.stringify({ bundleStatus: response.status() }, null, 2))
        return 'ran'
      }

      const code = await response.text()
      const excerpts: Record<string, string[]> = {}
      for (const token of TOKENS) {
        const found = excerptsAround(code, token)
        if (found.length) {
          excerpts[token] = found
        }
      }

      console.log(
        JSON.stringify({ chars: code.length, absent: TOKENS.filter((t) => !excerpts[t]), excerpts }, null, 2),
      )
    } finally {
      await session.close()
    }
    return 'ran'
  })

  await prisma.$disconnect()

  if (ran === null) {
    console.error(
      JSON.stringify({ failed: 'another carrier browser job held the lock past the wait deadline' }),
    )
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')) {
  main().catch((error) => {
    console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
    process.exit(1)
  })
}
