// What the Foresight illustration tool is made of.
//
//   tsx scripts/national-life-describe-foresight.ts
//
// Rapid Solve gives figures for a verbal quote and produces no document. The
// illustration an agent hands to a client comes from here — NLGroup
// Illustrations, Foresight Web — which the saved session already enters
// authenticated, on the portal's own origin.
//
// Read-only. Structure, control names and endpoint paths — never a person's
// values, and nothing is submitted.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const FORESIGHT_PATH = '/agent/sso/foresight'

/// Paths the tool calls or links to. `Layout.aspx` is a WebForms shell, so the
/// interesting surface is usually a frame or a postback target rather than the
/// page itself.
export function interestingPaths(html: string): string[] {
  const found: string[] = []

  for (const match of html.matchAll(/(?:src|href|action)=["']([^"']{3,200})["']/gi)) {
    found.push(match[1])
  }

  return Array.from(new Set(found))
    .map((value) => value.split('?')[0])
    .filter((value) => !/\.(png|jpe?g|gif|svg|css|woff2?|ttf|ico|map)$/i.test(value))
    .filter((value) => /aspx|illustration|report|pdf|print|proposal|output/i.test(value))
    .slice(0, 40)
    .sort()
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
      const calls: Array<{ method: string; url: string }> = []
      page.on('request', (request) => {
        const url = request.url()
        if (!url.includes('nationallife.com')) return
        if (/\.(png|jpe?g|gif|svg|css|woff2?|ttf|ico)$/i.test(url.split('?')[0])) return
        calls.push({ method: request.method(), url: url.split('?')[0] })
      })

      await page.goto(new URL(FORESIGHT_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(15_000)

      const html = await page.content()

      // Layout.aspx is a shell. Whatever the agent actually works in is likely
      // one of its frames, so each is reported on its own terms.
      const frames = []
      for (const frame of page.frames()) {
        try {
          const frameHtml = await frame.content()
          frames.push({
            name: frame.name() || null,
            url: frame.url().split('?')[0],
            title: (frameHtml.match(/<title[^>]*>([^<]{0,100})</i) ?? [])[1]?.trim() ?? null,
            chars: frameHtml.length,
            paths: interestingPaths(frameHtml),
            buttons: (frameHtml.match(/<(?:button|input)[^>]*(?:type=["']?(?:button|submit)["']?)[^>]*>/gi) ?? [])
              .map((tag) => {
                const id = (tag.match(/\bid=["']([^"']+)["']/i) ?? [])[1] ?? ''
                const value = (tag.match(/\bvalue=["']([^"']+)["']/i) ?? [])[1] ?? ''
                return `${id}${value ? ` (${value})` : ''}`
              })
              .filter(Boolean)
              .slice(0, 25),
          })
        } catch (error) {
          frames.push({ name: frame.name() || null, url: frame.url(), failed: String(error).slice(0, 100) })
        }
      }

      console.log(
        JSON.stringify(
          {
            landedOn: page.url().split('?')[0],
            topLevelPaths: interestingPaths(html),
            frames,
            calls: Array.from(new Set(calls.map((c) => `${c.method} ${c.url}`))).slice(0, 30),
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
