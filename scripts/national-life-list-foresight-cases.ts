// What the Foresight *Recent* panel is showing right now.
//
//   tsx scripts/national-life-list-foresight-cases.ts
//
// Read-only, and deliberately narrower than
// `national-life-generate-foresight-report.ts`: that one *opens* a case, and
// opening a case changes which case is current in the Foresight server session
// — the tool is stateful, every service call carries only `sessionTokenId`.
// So it cannot be used to take a "before" snapshot without disturbing the very
// thing being measured. This script lands on `StartPage.aspx`, reads the case
// names out of the panel, and leaves.
//
// It exists to answer one question: does a Rapid Solve quote create a
// `RP-<surname>-QQ-<stamp>` case on its own? Snapshot, quote, snapshot.
//
// Crossing the SSO rotates the `auth0` cookie, so the recaptured context is
// persisted in `finally` — a discarded rotation reads as replay at the IdP and
// kills the next job.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import {
  decryptBrowserContext,
  encryptBrowserContext,
} from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import {
  createPrismaSessionRefreshStore,
  deriveCarrierExpiresAt,
  refreshStoredCarrierSession,
} from '../lib/national-life/session-refresh'
import { prisma } from '../lib/prisma'
import {
  captureSteelSessionContext,
  createSteelBrowserSession,
} from '../workers/national-life/steel-session'

const FORESIGHT_PATH = '/agent/sso/foresight'

/// A quick quote is named `RP-<surname>-QQ-<MMDDYY><hhmmss>`. Pulling the
/// surname and the stamp apart is what turns "a case appeared" into "the case
/// this quote created appeared", which is the whole point of the comparison.
export function parseQuickQuoteName(
  name: string,
): { surname: string; stamp: string } | null {
  const match = /^RP-(.+)-QQ-(\d+)$/i.exec(name.trim())
  return match ? { surname: match[1], stamp: match[2] } : null
}

/// Names present after but not before. Order is the panel's, most recent first.
export function newCases(
  before: readonly string[],
  after: readonly string[],
): string[] {
  const seen = new Set(before)
  return after.filter((name) => !seen.has(name))
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
    const page = session.page
    const report: Record<string, unknown> = { at: new Date().toISOString() }
    try {
      await page.goto(new URL('/agent/', env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await page.waitForTimeout(4_000)
      await page.goto(new URL(FORESIGHT_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(15_000)

      report.landedOn = page.url().split('?')[0]
      if (/auth0\.com/i.test(page.url())) {
        report.skipped = 'Auth0 wall — needs a fresh login'
        return 'ran'
      }

      const startPage = page.frames().find((frame) => /StartPage\.aspx/i.test(frame.url()))
      if (!startPage) {
        report.skipped = 'no StartPage frame'
        return 'ran'
      }

      const cases = await startPage.evaluate(() =>
        Array.from(document.querySelectorAll('a[id*="lnkCaseName"]')).map((node) =>
          (node.textContent ?? '').trim(),
        ),
      )
      report.cases = cases
      report.quickQuotes = cases
        .map((name) => ({ name, parsed: parseQuickQuoteName(name) }))
        .filter((entry) => entry.parsed)
        .map((entry) => entry.name)
    } finally {
      try {
        const refreshed = await captureSteelSessionContext(session.steelSessionId, env)
        await refreshStoredCarrierSession(
          {
            sessionId: stored.id,
            encryptedContext: encryptBrowserContext(
              refreshed,
              {
                agentId: stored.agentId,
                scopeId: env.sessionScopeId,
                provider: 'NATIONAL_LIFE',
                purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
                formatVersion: 1,
              },
              { version: env.sessionKeyVersion, base64Key: env.sessionKeys[env.sessionKeyVersion] },
            ),
            carrierExpiresAt: deriveCarrierExpiresAt(refreshed, env.portalOrigins),
            refreshedAt: new Date(),
          },
          createPrismaSessionRefreshStore(prisma, env.sessionScopeId),
        )
      } catch (error) {
        report.persistFailed = String(error).slice(0, 200)
      }
      console.log(JSON.stringify(report, null, 2))
      await session.close()
    }
    return 'ran'
  })

  await prisma.$disconnect()
  if (ran === null) {
    console.error(JSON.stringify({ failed: 'another carrier browser job held the lock' }))
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')) {
  main().catch((error) => {
    console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
    process.exit(1)
  })
}
