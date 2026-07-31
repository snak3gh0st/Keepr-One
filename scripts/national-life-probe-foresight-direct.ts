// Can the illustration tool be entered without crossing the SSO?
//
//   tsx scripts/national-life-probe-foresight-direct.ts
//
// The chain `/agent/sso/foresight → FormPostAuth0 → /authorize → LoginCallback
// → FormPost → Layout.aspx` is what *establishes* the Foresight session. Once
// established, the tool is a classic WebForms app driven by its own cookies —
// so entering may not require the identity provider at all.
//
// That matters because crossing is expensive: the Auth0 token lives in the
// page's memory (`auth0-spa-js` defaults to `cacheLocation: memory`), so a
// fresh browser has to re-authorize every time, and re-authorizing is what has
// been burning the session. If `Layout.aspx` opens authenticated straight from
// the stored cookies, the crossing stops being needed at all.
//
// Best run precisely when the SSO is known dead: then an authenticated
// `Layout.aspx` proves the tool outlives the identity session, which is the
// whole question. Read-only — it opens a page and reads its title.
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

const DIRECT_PATH = '/NWI/Main/Layout.aspx'

/// The tool answers with its own name when the session is good, and bounces to
/// the identity provider when it is not. Anything else is worth seeing raw
/// rather than being collapsed into a boolean.
export function readEntryVerdict(input: {
  url: string
  title: string
  hasPasswordField: boolean
}): 'AUTHENTICATED' | 'AUTH0_WALL' | 'UNKNOWN' {
  if (/auth0\.com/i.test(input.url)) return 'AUTH0_WALL'
  if (input.hasPasswordField) return 'AUTH0_WALL'
  if (/foresight|illustration/i.test(input.title)) return 'AUTHENTICATED'
  return 'UNKNOWN'
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
      // Straight in. No `/agent/sso/foresight`, no `/authorize`.
      await page.goto(new URL(DIRECT_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(12_000)

      const title = await page.title().catch(() => '')
      const hasPasswordField = await page
        .evaluate(() => Boolean(document.querySelector('input[type="password"]')))
        .catch(() => false)

      report.landedOn = page.url().split('?')[0]
      report.title = title
      report.verdict = readEntryVerdict({ url: page.url(), title, hasPasswordField })
      report.frames = page
        .frames()
        .map((frame) => frame.url().split('?')[0])
        .filter((url) => url && url !== 'about:blank')

      // The Recent panel is the proof the tool is really usable, not just
      // serving a shell: those links are what a render job clicks.
      const startPage = page.frames().find((frame) => /StartPage\.aspx/i.test(frame.url()))
      report.caseCount = startPage
        ? await startPage
            .evaluate(() => document.querySelectorAll('a[id*="lnkCaseName"]').length)
            .catch(() => null)
        : null
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
