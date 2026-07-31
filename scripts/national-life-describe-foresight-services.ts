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

/// The code around a call, which is where the payload shape lives.
///
/// Knowing that `PageService.asmx/RenderReports` exists says nothing about what
/// it wants. The bundle builds the request right next to the URL, so a window of
/// source either side of each occurrence is the cheapest way to read the
/// contract — the same way the Rapid Solve request was recovered.
export function callSites(
  source: string,
  method: string,
  windowChars = 320,
): string[] {
  const sites: string[] = []
  let index = source.indexOf(method)

  while (index !== -1 && sites.length < 4) {
    sites.push(
      source
        .slice(Math.max(0, index - windowChars), index + windowChars)
        // Minified bundles are one long line; collapsing whitespace keeps the
        // output readable without changing what it says.
        .replace(/\s+/g, ' '),
    )
    index = source.indexOf(method, index + method.length)
  }

  return sites
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
      const hops: string[] = []
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) hops.push(frame.url().split('?')[0])
      })

      // Touch the portal before jumping. Measured 2026-07-31: jumping cold from
      // the stored context landed on the Auth0 wall twice in a row, in the same
      // minutes that keep-alive — which loads `/agent/` first — reported the
      // jump authenticated. The warm portal session in this browser is part of
      // what makes FormPostAuth0 hand over instead of bouncing to login.
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

      const landedOn = page.url().split('?')[0]
      if (/auth0\.com/i.test(landedOn)) {
        console.log(JSON.stringify({ landedOn, hops, skipped: 'Auth0 wall after a warm portal touch' }))
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
            hops,
            bundles: perBundle.map(({ src, chars }) => ({ src, chars })),
            // The answer to "where does the PDF come from", if it is named at all.
            documentEndpoints: documentEndpoints(all),
            callSites: Object.fromEntries(
              documentEndpoints(all).map((endpoint) => [
                endpoint,
                callSites(bundles.map((bundle) => bundle.body).join("\n"), endpoint),
              ]),
            ),
            endpointCount: all.length,
            endpoints: all.slice(0, 120),
          },
          null,
          2,
        ),
      )
    } finally {
      // Crossing `/authorize` rotates the Auth0 cookie. A run that crosses and
      // then throws the rotated cookie away leaves the *next* job presenting a
      // superseded one, which is what an IdP treats as replay — the suspected
      // reason this session kept dying minutes after a login. So the context is
      // recaptured and persisted before the browser goes away, exactly as the
      // keep-alive does. In `finally` because a run that fails halfway has
      // still rotated the cookie, and that is precisely when losing it hurts.
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
        console.error(JSON.stringify({ persistFailed: String(error).slice(0, 200) }))
      }
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
