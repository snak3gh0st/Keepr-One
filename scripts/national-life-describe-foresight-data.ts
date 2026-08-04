// Does Foresight hand over the illustration's numbers as data?
//
//   tsx scripts/national-life-describe-foresight-data.ts [trecho-do-nome]
//
// This is the question that decides how a presentation gets built. If a service
// returns the values, the presentation is assembled from carrier data. If none
// does, the only source is the rendered PDF and the numbers have to be parsed
// back out of it — a worse job, and a more fragile one.
//
// Reads only. It opens a case from the tool's own Recent panel, exactly as the
// report job already does, and calls the `Get*` services through the tool's own
// client. It never calls `IllustrateCase` (that runs a calculation), never
// touches the e-App launcher, and never saves.
//
// Reports SHAPE, not values: field names, types, array lengths. The case
// belongs to a real insured, and their figures do not belong in a terminal
// transcript or a commit. Numbers are reported as `number`, strings as their
// length — enough to design against, not enough to leak.
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
import {
  FORESIGHT_READ_SERVICES,
  describeForesightShape,
  parseForesightCaseListings,
} from '../lib/national-life/foresight-sync'

const FORESIGHT_PATH = '/agent/sso/foresight'

/// The services asked, and why each one is worth asking.
///
/// All are `Get*`. Nothing here computes, saves, or launches anything — the
/// question is only what the tool is already willing to say.
async function main() {
  const env = getNationalLifeEnv()
  const wanted = process.argv.slice(2).find((value) => !value.startsWith('-'))

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

      if (/auth0\.com/i.test(page.url())) {
        report.skipped = 'Auth0 wall — needs a fresh login'
        return 'ran'
      }
      const startPage = page.frames().find((frame) => /StartPage\.aspx/i.test(frame.url()))
      if (!startPage) {
        report.skipped = 'no StartPage frame'
        return 'ran'
      }

      const caseDocument = await startPage.evaluate(() => ({
        html: document.documentElement.outerHTML,
        ids: Array.from(document.querySelectorAll('a[id*="lnkCaseName"]')).map(
          (node) => (node as HTMLElement).id,
        ),
      }))
      const cases = parseForesightCaseListings(caseDocument.html).map((listing, index) => ({
        ...listing,
        id: caseDocument.ids[index],
      }))
      // A named case rather than a quick quote by default: a quick quote is five
      // numbers, and the question is whether a full illustration yields more.
      const target = wanted
        ? cases.find((entry) => entry.displayName.toLowerCase().includes(wanted.toLowerCase()))
        : cases.find((entry) => entry.caseKind !== 'QUICK_QUOTE') ?? cases[0]
      if (!target) {
        report.skipped = 'no case matched'
        report.available = cases.map((entry) => entry.displayName)
        return 'ran'
      }
      report.openedCase = target.displayName

      await startPage.click(`[id="${target.id}"]`).catch(async () => {
        await startPage.evaluate(
          (id) => (document.getElementById(id) as HTMLElement)?.click(),
          target.id,
        )
      })
      await page.waitForTimeout(20_000)

      const holder = page.mainFrame()
      const tokenId = await holder
        .evaluate(() => {
          const common = (window as never as { $ITCommon?: { sessionTokenId(): string } }).$ITCommon
          return common ? common.sessionTokenId() : null
        })
        .catch(() => null)
      report.sessionTokenId = tokenId ? 'present' : null
      if (!tokenId) {
        report.skipped = 'no $ITCommon.sessionTokenId'
        return 'ran'
      }

      // One service per evaluate, re-reading the frame each time. The first
      // attempt put all five in a single long-running evaluate and lost the lot
      // to "Resulting promise was garbage collected" — the case postback
      // navigates the frame out from under it. Now a navigation costs one
      // answer instead of all of them, and each failure is reported as itself.
      const services: Record<string, unknown> = {}
      for (const service of FORESIGHT_READ_SERVICES) {
        const frame = page.mainFrame()
        services[service] = await frame
          .evaluate(
            async ([token, name]) => {
              const w = window as never as {
                $ITAjax: {
                  sendRequest(url: string, args: unknown[]): Promise<unknown>
                  sendGetRequest?(url: string, args: unknown[]): Promise<unknown>
                }
                appPath: string
              }
              const url = `${w.appPath}/Main/${name}`
              try {
                return { verb: 'POST', body: await w.$ITAjax.sendRequest(url, [token]) }
              } catch (postError) {
                try {
                  return { verb: 'GET', body: await w.$ITAjax.sendGetRequest?.(url, [token]) }
                } catch {
                  return { failed: String(postError).slice(0, 140) }
                }
              }
            },
            [tokenId, service] as const,
          )
          .catch((error) => ({ failed: String(error).slice(0, 140) }))
        await page.waitForTimeout(1_500)
      }
      report.services = services

      // Shape only. See the file header.
      report.services = Object.fromEntries(
        Object.entries(services).map(([name, result]) => [name, describeForesightShape(result)]),
      )
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
