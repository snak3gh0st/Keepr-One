// Where Foresight keeps its endpoints — and which of them produces a document.
//
//   tsx scripts/national-life-describe-foresight-services.ts
//
// Opening the tool showed it is WebForms driving ASMX JSON services
// (`PageService.asmx/GetApplications`, `WidgetService.asmx/GetState`, ...). Those
// were only the calls the start page happens to make on load. The rest of the
// contract — including whatever renders an illustration to PDF — is named in the
// scripts the page itself loads, so this reads them and reports the endpoints.
//
// Read-only in the strongest sense: it fetches the tool's own static scripts
// with the session already in the browser and never calls a service, submits a
// form, or names a person.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const FORESIGHT_PATH = '/agent/sso/foresight'

/// Every service call the bundle names: `Something.asmx/Method`, a handler, or a
/// page. Deduped and sorted so two runs diff cleanly.
export function serviceEndpoints(source: string): string[] {
  const found = new Set<string>()

  // ASMX with the method attached — the method is the whole point, since the
  // service alone says nothing about what can be asked of it.
  for (const match of source.matchAll(/([A-Za-z0-9_.-]+\.asmx\/[A-Za-z0-9_]+)/g)) {
    found.add(match[1])
  }
  for (const match of source.matchAll(/([A-Za-z0-9_/.-]+\.(?:ashx|aspx))/g)) {
    found.add(match[1])
  }

  return Array.from(found).sort()
}

/// The subset worth looking at first when the question is "where does the PDF
/// come from". Named separately rather than filtered at the call site so the
/// full list still gets reported — a wrong guess here should cost nothing.
export function documentEndpoints(endpoints: readonly string[]): string[] {
  return endpoints.filter((endpoint) =>
    /pdf|print|report|output|export|document|illustration|proposal|present/i.test(endpoint),
  )
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
      await page.goto(new URL(FORESIGHT_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      await page.waitForTimeout(15_000)

      const landedOn = page.url().split('?')[0]
      if (/auth0\.com/i.test(landedOn)) {
        console.log(JSON.stringify({ landedOn, skipped: 'Auth0 wall — needs a fresh login' }))
        return 'ran'
      }

      // The scripts the page itself pulled in. Read from inside the session
      // because /NWI/ is behind the same authentication as the tool.
      const bundles = await page.evaluate(async () => {
        const sources = Array.from(document.querySelectorAll('script[src]'))
          .map((tag) => (tag as HTMLScriptElement).src)
          .filter((src) => /\/NWI\//i.test(src))

        const read: Array<{ src: string; chars: number; body: string }> = []
        for (const src of sources) {
          try {
            const response = await fetch(src, { credentials: 'include' })
            const body = await response.text()
            read.push({ src, chars: body.length, body })
          } catch {
            read.push({ src, chars: 0, body: '' })
          }
        }
        return read
      })

      const perBundle = bundles.map((bundle) => {
        const endpoints = serviceEndpoints(bundle.body)
        return {
          src: bundle.src.split('?')[0],
          chars: bundle.chars,
          documentEndpoints: documentEndpoints(endpoints),
          endpoints: endpoints.slice(0, 60),
        }
      })

      const all = serviceEndpoints(bundles.map((bundle) => bundle.body).join('\n'))

      console.log(
        JSON.stringify(
          {
            landedOn,
            bundles: perBundle.map(({ src, chars }) => ({ src, chars })),
            // The answer to "where does the PDF come from", if it is named at all.
            documentEndpoints: documentEndpoints(all),
            endpointCount: all.length,
            endpoints: all.slice(0, 120),
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
