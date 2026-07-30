// Why the correspondence grid returns 64 documents for 9,614 policies.
//
//   tsx scripts/national-life-describe-correspondence-filter.ts
//
// 64 rows across 44 policies, fetched in a single page, is either the whole
// truth or a default filter nobody looked at. The grid client pages correctly
// — it stops because the carrier stopped, not because it gave up — so the
// answer is in the request the page builds for itself.
//
// Prints that request's own body. Everything here is a GET or the page's own
// first POST, replayed unchanged; nothing new is asked of the carrier.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const CORRESPONDENCE_PATH = '/agent/book-of-business/inforce-book/correspondence'

/// Anything in the grid's request body that looks like it narrows the result:
/// a date, a range, a status, a "last N days".
export function filterLikeKeys(body: unknown, path = ''): string[] {
  if (!body || typeof body !== 'object') return []

  const found: string[] = []
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key
    if (/date|from|to|range|period|day|month|year|filter|status|search/i.test(key)) {
      found.push(`${here} = ${JSON.stringify(value)?.slice(0, 120)}`)
    }
    if (value && typeof value === 'object') {
      found.push(...filterLikeKeys(value, here))
    }
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
      const captured: Array<{ url: string; body: unknown }> = []

      session.page.on('request', (request) => {
        if (request.method() !== 'POST') return
        const raw = request.postData()
        if (!raw) return
        try {
          captured.push({ url: request.url(), body: JSON.parse(raw) })
        } catch {
          captured.push({ url: request.url(), body: raw.slice(0, 500) })
        }
      })

      await session.page.goto(
        new URL(CORRESPONDENCE_PATH, env.portalLoginUrl).toString(),
        { waitUntil: 'domcontentloaded', timeout: 45_000 },
      )
      await session.page.waitForTimeout(12_000)

      const html = await session.page.content()

      console.log(
        JSON.stringify(
          {
            requests: captured.map((entry) => ({
              url: entry.url.split('?')[0],
              filterLike: filterLikeKeys(entry.body),
              body: entry.body,
            })),
            // The visible controls: a date range the page defaults to would
            // show up here as a filled input.
            dateInputs: (html.match(/<input[^>]*(?:date|Date)[^>]*>/g) ?? []).slice(0, 12),
            recordsTotal: html.match(/recordsTotal["':\s]+(\d+)/)?.[1] ?? null,
          },
          null,
          2,
        ),
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
