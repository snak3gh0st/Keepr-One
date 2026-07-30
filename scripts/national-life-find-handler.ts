// Read-only discovery. Locates the endpoint a page's JS handler posts to, for
// drill-downs that are wired to a click rather than to a grid.
//
//   tsx scripts/national-life-find-handler.ts <path> <symbol>
//   tsx scripts/national-life-find-handler.ts \
//     /agent/compensation/commissions/paid-commissions getHierarchyReportDetails
//
// Prints the URLs and ajax option names found near the symbol, in inline scripts
// and in same-origin script files. Digits are masked and no page data is printed.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const maskDigits = (value: string) => value.replace(/\d/g, '#')

/// Windows around each mention, so the surrounding ajax config is visible without
/// dumping whole bundles.
function windowsAround(source: string, symbol: string, radius = 700): string[] {
  const found: string[] = []
  let index = source.indexOf(symbol)
  while (index !== -1 && found.length < 6) {
    found.push(
      maskDigits(
        source
          .slice(Math.max(0, index - radius), index + radius)
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    )
    index = source.indexOf(symbol, index + symbol.length)
  }
  return found
}

function urlsIn(text: string): string[] {
  const matches = text.match(/["'`](\/[A-Za-z0-9_\-/.]{4,}|https?:\/\/[^"'`\s]+)["'`]/g) ?? []
  return Array.from(
    new Set(
      matches
        .map((match) => maskDigits(match.replace(/["'`]/g, '')))
        .filter((url) => !/\.(png|jpg|gif|svg|woff2?|css)$/i.test(url)),
    ),
  ).slice(0, 25)
}

async function main() {
  const env = getNationalLifeEnv()
  const [path, symbol] = process.argv.slice(2)
  if (!path || !symbol) {
    throw new Error('usage: <portal path> <js symbol>')
  }

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

  const session = await createSteelBrowserSession(env, { sessionContext })
  try {
    await session.page.goto(new URL(path, env.portalLoginUrl).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await session.page.waitForTimeout(6_000)

    const html = await session.page.content()
    const inline = windowsAround(html, symbol)
    console.log(JSON.stringify({ where: 'inline', mentions: inline.length }, null, 2))
    for (const snippet of inline) {
      console.log(JSON.stringify({ urls: urlsIn(snippet), snippet: snippet.slice(0, 900) }))
    }

    // The handler often lives in a bundled script rather than inline.
    const scriptSrcs = Array.from(
      new Set(
        (html.match(/<script[^>]+src="([^"]+)"/gi) ?? [])
          .map((tag) => tag.match(/src="([^"]+)"/i)?.[1] ?? '')
          .filter((src) => src && !/google|gtm|mpulse|akam/i.test(src)),
      ),
    ).slice(0, 25)

    for (const src of scriptSrcs) {
      const url = new URL(src, env.portalLoginUrl).toString()
      if (!url.includes('nationallife.com')) continue
      try {
        const response = await session.page.request.get(url)
        if (!response.ok()) continue
        const body = await response.text()
        if (!body.includes(symbol)) continue
        const hits = windowsAround(body, symbol)
        console.log(
          JSON.stringify({
            where: maskDigits(src),
            mentions: hits.length,
            urls: urlsIn(hits.join(' ')),
            snippet: hits[0]?.slice(0, 900) ?? null,
          }),
        )
      } catch {
        // A script we cannot read tells us nothing; keep going.
      }
    }
  } finally {
    await session.close()
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
