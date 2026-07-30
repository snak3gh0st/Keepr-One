// Why the Rapid Solve POST comes back HTTP 500.
//
//   tsx scripts/national-life-describe-rapid-solve-headers.ts
//
// The request reaches the endpoint and the server errors, which is what an
// ASP.NET MVC action does when an antiforgery token is missing or the call does
// not look like the AJAX it expects. The grid client already solves this for
// the report grids by replaying the page's own headers; Rapid Solve issues no
// request on load, so there is nothing to capture and the answer has to come
// from the page and its bundle.
//
// Reads both. Nothing is submitted.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const ILLUSTRATIONS_PATH = '/agent/tools/business-tools/illustrations'

/// The hidden inputs ASP.NET renders for antiforgery. Names only — the value is
/// a credential for this session and is never printed.
export function antiforgeryInputs(html: string): string[] {
  const found: string[] = []
  for (const match of html.matchAll(/<input[^>]*name=["']([^"']*[Vv]erification[^"']*)["'][^>]*>/g)) {
    found.push(match[1])
  }
  for (const match of html.matchAll(/<input[^>]*name=["'](__[A-Za-z]+)["'][^>]*>/g)) {
    found.push(match[1])
  }
  return Array.from(new Set(found))
}

/// The `$.ajax({...})` block that posts the quote, so its headers, content type
/// and data serialisation can be read rather than guessed.
export function ajaxBlocks(code: string, marker = 'GetQuote'): string[] {
  const blocks: string[] = []
  let index = code.indexOf(marker)

  while (index !== -1 && blocks.length < 4) {
    const from = Math.max(0, code.lastIndexOf('$.ajax', index))
    const to = code.indexOf('});', index)
    blocks.push(
      code
        .slice(from, to === -1 ? index + 600 : to + 3)
        .replace(/\s+/g, ' ')
        .slice(0, 1200),
    )
    index = code.indexOf(marker, index + marker.length)
  }

  return blocks
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
      await session.page.waitForTimeout(10_000)
      const html = await session.page.content()

      const bundle = await session.page.request.get(
        new URL('/Assets/Agent/js/rapidsolve.js', env.portalLoginUrl).toString(),
      )
      const code = bundle.ok() ? await bundle.text() : ''

      console.log(
        JSON.stringify(
          {
            antiforgeryInputs: antiforgeryInputs(html),
            ajaxBlocks: ajaxBlocks(code),
            // Whether jQuery is configured to add a token to every request.
            globalAjaxSetup: code.includes('ajaxSetup')
              ? code
                  .slice(code.indexOf('ajaxSetup') - 200, code.indexOf('ajaxSetup') + 600)
                  .replace(/\s+/g, ' ')
              : null,
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
