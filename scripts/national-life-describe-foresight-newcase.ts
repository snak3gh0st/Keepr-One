// How Foresight starts a case, and whether it will hand over numbers as data.
//
//   tsx scripts/national-life-describe-foresight-newcase.ts
//
// Everything known about Foresight so far is about *opening a case that already
// exists* and rendering it to PDF. That is enough to fetch a document and not
// enough to build anything: choosing the product — Term, FlexLife, IUL — and
// creating the case is the part nobody here has seen.
//
// Written before the carrier session exists, on purpose. A live session lasts
// roughly eighty minutes, and writing probes inside that window is how the
// window gets wasted. One pass, one browser, everything worth asking at once.
//
// Strictly read-only: it reads the start page's own controls and the static
// scripts the page already loaded. It does not create a case, does not submit a
// form, does not name a person, and never touches the e-App launcher.
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

/// Endpoints worth a second look, split by the question each one answers.
///
/// `data` is the one that decides the shape of everything downstream: if a
/// service hands back the illustration's values, the presentation is built from
/// carrier data. If nothing does, the only source is the rendered PDF, and the
/// numbers have to be parsed out of it — a different and much worse job.
export function classifyEndpoints(endpoints: readonly string[]): {
  product: string[]
  newCase: string[]
  data: string[]
} {
  const pick = (pattern: RegExp) =>
    endpoints.filter((endpoint) => pattern.test(endpoint)).sort()

  return {
    product: pick(/product|plan|solution|portfolio|term|flex|iul|universal/i),
    newCase: pick(/new|create|add|start|wizard|setup(?!Report)|initial/i),
    // Deliberately excludes the report family: those produce a document, and
    // the question here is whether anything produces *values*.
    data: pick(/get(?!Report)|calc|value|ledger|grid|summary|result|illustrat/i),
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

      // 1. Every control the start page offers. The one that begins a case is
      //    in here somewhere, and its id is what a job would have to click.
      const readControls = (frame: typeof startPage) =>
        frame.evaluate(() =>
        Array.from(document.querySelectorAll('a,button,input[type=button],input[type=submit]'))
          .map((node) => ({
            tag: node.tagName.toLowerCase(),
            id: (node as HTMLElement).id || null,
            text: (node.textContent ?? (node as HTMLInputElement).value ?? '').trim().slice(0, 60),
          }))
          .filter((entry) => entry.text || entry.id),
        )

      // The start page is only the inner document. The tool's own chrome — and
      // with it whatever begins a case — lives in the frame around it, which is
      // why looking only inside found nothing but help links.
      report.controls = {} as Record<string, unknown>
      for (const frame of page.frames()) {
        const url = frame.url().split('?')[0]
        if (!url || url === 'about:blank') continue
        ;(report.controls as Record<string, unknown>)[url] = await readControls(
          frame as typeof startPage,
        ).catch(() => null)
      }

      // 2. Any product wording already present on the page. The agent says the
      //    tool offers Term, FlexLife and IUL; this is where that shows up as
      //    something addressable rather than as a recollection.
      report.productMentions = await startPage.evaluate(() => {
        const text = document.body.innerText ?? ''
        return Array.from(
          new Set(
            (text.match(/\b(term|flex ?life|iul|indexed universal|universal life|whole life)\b/gi) ?? []).map(
              (match) => match.toLowerCase(),
            ),
          ),
        )
      })

      // 3. Selects and their options — a product chooser is most likely one.
      report.selects = await startPage.evaluate(() =>
        Array.from(document.querySelectorAll('select')).map((node) => ({
          id: node.id || null,
          options: Array.from(node.options).slice(0, 40).map((option) => ({
            value: option.value,
            label: (option.textContent ?? '').trim().slice(0, 60),
          })),
        })),
      )

      // 4. The bundles, read as static assets with the session already in the
      //    browser. This is the same technique that produced the report
      //    contract without a single service being called.
      const scriptUrls = [
        ...new Set(
          (
            await Promise.all(
              page.frames().map((frame) =>
                frame
                  .evaluate(() =>
                    Array.from(document.querySelectorAll('script[src]')).map(
                      (node) => (node as HTMLScriptElement).src,
                    ),
                  )
                  .catch(() => [] as string[]),
              ),
            )
          ).flat(),
        ),
      ]
      report.scriptCount = scriptUrls.length

      const endpoints = new Set<string>()
      for (const url of scriptUrls.slice(0, 40)) {
        const source = await page
          .evaluate(async (target) => {
            const response = await fetch(target, { credentials: 'include' })
            return response.ok ? response.text() : ''
          }, url)
          .catch(() => '')
        for (const match of source.matchAll(/([A-Za-z0-9_.-]+\.asmx\/[A-Za-z0-9_]+)/g)) {
          endpoints.add(match[1])
        }
        for (const match of source.matchAll(/([A-Za-z0-9_/.-]+\.(?:ashx|aspx|rspx))/g)) {
          endpoints.add(match[1])
        }
      }
      report.endpointCount = endpoints.size
      report.classified = classifyEndpoints([...endpoints])
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
