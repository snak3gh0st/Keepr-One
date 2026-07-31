// Where the SSO jumps actually land, and whether the session travels with them.
//
//   tsx scripts/national-life-describe-sso-targets.ts
//
// The portal offers five `/agent/sso/*` links. Two of them are the systems that
// matter next: Foresight, which produces the illustration document Rapid Solve
// does not, and iGo, which creates the application. Both are third-party
// systems with their own authentication, and "it is just a link" is the wrong
// reading — the portal hands over the jump, not the data.
//
// Scouting only: follow the jump, report where it landed and what is there.
// Nothing is filled in and nothing is submitted.
//
// Note for whoever integrates these: the adapter's origin allowlist
// (`NATIONAL_LIFE_PORTAL_ORIGINS`) does not include these hosts. That is a
// deliberate boundary, and widening it is a security decision, not a config
// tweak.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const TARGETS = [
  { name: 'foresight', path: '/agent/sso/foresight' },
  { name: 'igo-eapp', path: '/agent/sso/igo-eapp' },
]

/// Whether the landing page looks like a working session or a login wall.
export function classifyLanding(html: string, url: string) {
  const lower = html.toLowerCase()
  return {
    origin: (() => {
      try {
        return new URL(url).origin
      } catch {
        return null
      }
    })(),
    looksLikeLogin:
      /type=["']password["']/.test(lower) ||
      /\bsign in\b|\blog in\b|\blogin\b/.test(lower.slice(0, 4000)),
    hasLogout: /logout|sign out/.test(lower),
    title: (html.match(/<title[^>]*>([^<]{0,120})</i) ?? [])[1]?.trim() ?? null,
    chars: html.length,
  }
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
    try {
      const results: unknown[] = []

      for (const target of TARGETS) {
        const hops: string[] = []
        const onFrame = (frame: { url(): string }) => {
          const url = frame.url()
          try {
            hops.push(new URL(url).origin)
          } catch {
            /* about:blank and friends */
          }
        }
        page.on('framenavigated', onFrame)

        try {
          await page.goto(new URL(target.path, env.portalLoginUrl).toString(), {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          })
          await page.waitForTimeout(12_000)

          const html = await page.content()
          results.push({
            target: target.name,
            landedOn: page.url().split('?')[0],
            hops: Array.from(new Set(hops)),
            ...classifyLanding(html, page.url()),
          })
        } catch (error) {
          results.push({ target: target.name, failed: String(error).split('\n')[0].slice(0, 160) })
        } finally {
          page.off('framenavigated', onFrame)
        }
      }

      console.log(JSON.stringify({ results }, null, 2))
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
