// Reads the Rapid Solve illustration tool's own client code to learn how it
// submits, WITHOUT submitting anything.
//
//   tsx scripts/national-life-describe-rapid-solve.ts
//
// Every other part of this integration is a read, where repeating a request is
// harmless. Submitting a quote would be the first write against the agent's real
// carrier account, so the endpoint is looked for in the page's own JavaScript
// first: if the form posts to a named URL, the contract can be learned at zero
// risk and the submission skipped entirely.
//
// Structure only. Field names, endpoints and option labels — never a value.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const RAPID_SOLVE_PATH = '/agent/tools/business-tools/illustrations'

const maskDigits = (value: string) => value.replace(/\d/g, '#')

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

/// URLs the page's own scripts would call. A quote form that posts to a named
/// action names it here, which is the whole point of looking.
export function candidateEndpoints(html: string): string[] {
  const found: string[] = []

  // jQuery-style ajax config and bare url properties.
  for (const match of html.matchAll(/\burl\s*:\s*["'`]([^"'`]{4,200})["'`]/gi)) {
    found.push(match[1])
  }
  // fetch()/open() call sites.
  for (const match of html.matchAll(/(?:fetch|\.open)\s*\(\s*["'`]([^"'`]{4,200})["'`]/gi)) {
    found.push(match[1])
  }
  // Razor-rendered action paths, which is how this portal wires its forms.
  for (const match of html.matchAll(/["'`](\/[A-Za-z][\w\-/]{3,120})["'`]/g)) {
    found.push(match[1])
  }

  return uniq(
    found
      .map((value) => value.trim())
      .filter((value) => value.startsWith('/') || value.startsWith('http'))
      // Assets are not endpoints.
      .filter((value) => !/\.(png|jpe?g|gif|svg|css|woff2?|ttf|ico|map)(\?|$)/i.test(value))
      .map((value) => value.split('?')[0]),
  )
    .filter((value) =>
      /quote|solve|illustrat|calc|rapid|product|strategy|allocation|premium|face/i.test(value),
    )
    .sort()
}

/// The submit control's own wiring: a form action, or the handler name a click
/// binds to.
export function submitWiring(html: string) {
  const forms = html.match(/<form[\s\S]*?>/gi) ?? []
  return {
    formActions: uniq(
      forms.map((tag) => (tag.match(/\baction=["']([^"']*)["']/i)?.[1] ?? '').split('?')[0]),
    ),
    formMethods: uniq(forms.map((tag) => tag.match(/\bmethod=["']([^"']*)["']/i)?.[1] ?? '')),
    // Handlers bound to the quote button name the function that builds the call.
    quoteHandlers: uniq(
      (html.match(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)/g) ?? [])
        .map((fn) => fn.replace(/function\s+/, '').split('(')[0])
        .filter((name) => /quote|solve|calc|rapid|illustrat/i.test(name)),
    ).slice(0, 20),
  }
}

/// Options behind the custom dropdowns, which are buttons rather than <select>
/// and so are not visible in a plain field dump.
export function dropdownOptions(html: string) {
  const result: Record<string, string[]> = {}
  for (const match of html.matchAll(
    /<(select)[^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi,
  )) {
    const [, , name, body] = match
    result[name] = uniq(
      (body.match(/<option[^>]*>([\s\S]*?)<\/option>/gi) ?? []).map((option) =>
        option.replace(/<[^>]*>/g, '').trim(),
      ),
    ).slice(0, 60)
  }
  return result
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
      await session.page.goto(new URL(RAPID_SOLVE_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await session.page.waitForTimeout(8_000)
      const html = await session.page.content()

      // Scripts the page pulls in: the handler often lives in a bundle rather
      // than inline, and its filename says which one to read next.
      const scripts = uniq(
        (html.match(/<script[^>]+src=["']([^"']+)["']/gi) ?? []).map(
          (tag) => tag.match(/src=["']([^"']+)["']/i)?.[1] ?? '',
        ),
      )
        .filter((src) => /illustrat|rapid|quote|solve|product/i.test(src))
        .map((src) => maskDigits(src.split('?')[0]))

      // The page has no form action and no inline handler: the wiring lives in
      // a bundle. Fetching that bundle is a GET for a static asset — it touches
      // no account state and creates nothing, which is why the contract can be
      // learned without ever submitting a quote.
      const bundles: Record<string, unknown> = {}
      for (const src of scripts) {
        try {
          const response = await session.page.request.get(
            new URL(src, env.portalLoginUrl).toString(),
          )
          if (!response.ok()) {
            bundles[src] = { status: response.status() }
            continue
          }
          const code = await response.text()
          bundles[src] = {
            chars: code.length,
            endpoints: candidateEndpoints(code).slice(0, 20),
            // Every URL the bundle names, not only the ones matching keywords:
            // the solve endpoint may be named something unguessable.
            allUrls: uniq(
              [...code.matchAll(/["'`](\/[A-Za-z][\w\-/]{3,120})["'`]/g)].map((m) => m[1]),
            )
              .filter((url) => !/\.(png|jpe?g|gif|svg|css|woff2?|ttf|ico|map)$/i.test(url))
              .slice(0, 30),
            // The keys it puts on the request body are the payload contract.
            payloadKeys: uniq(
              [...code.matchAll(/["']?([A-Za-z_$][\w$]{2,40})["']?\s*:\s*(?:\$\(|[A-Za-z_$])/g)].map(
                (m) => m[1],
              ),
            ).slice(0, 60),
            ajaxTypes: uniq([...code.matchAll(/\btype\s*:\s*["'](\w+)["']/gi)].map((m) => m[1])),
            dataTypes: uniq([...code.matchAll(/\bdataType\s*:\s*["'](\w+)["']/gi)].map((m) => m[1])),
          }
        } catch (error) {
          bundles[src] = { failed: String(error).slice(0, 120) }
        }
      }

      console.log(
        JSON.stringify(
          {
            path: RAPID_SOLVE_PATH,
            ...submitWiring(html),
            relatedScripts: scripts.slice(0, 15),
            bundles,
            dropdownOptions: dropdownOptions(html),
            htmlChars: html.length,
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

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
