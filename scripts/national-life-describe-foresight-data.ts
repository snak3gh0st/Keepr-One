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

const FORESIGHT_PATH = '/agent/sso/foresight'

/// The services asked, and why each one is worth asking.
///
/// All are `Get*`. Nothing here computes, saves, or launches anything — the
/// question is only what the tool is already willing to say.
const SERVICES = [
  'WidgetService.asmx/GetQuickCalcData',
  'WidgetService.asmx/GetQuickCalcStatus',
  'WidgetService.asmx/GetInsuredInformation',
  'WidgetService.asmx/GetState',
  'PageService.asmx/GetPolicyInformation',
] as const

/// A value's shape with its content removed.
///
/// Depth-limited because an illustration ledger is deeply nested and the point
/// is to learn whether year-by-year rows exist, not to transcribe them. An
/// array reports its length and the shape of its first element — which is
/// exactly what says "there are 60 rows and each has these columns".
export function describeShape(value: unknown, depth = 0): unknown {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return depth >= 3
      ? `array(${value.length})`
      : { array: value.length, of: value.length ? describeShape(value[0], depth + 1) : 'empty' }
  }
  switch (typeof value) {
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    // Length rather than content: a name, a state code and a formatted dollar
    // figure are all strings, and only one of them is safe to print.
    case 'string':
      return `string(${value.length})`
    case 'object': {
      if (depth >= 3) return 'object'
      const shape: Record<string, unknown> = {}
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        shape[key] = describeShape(nested, depth + 1)
      }
      return shape
    }
    default:
      return typeof value
  }
}

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

      const cases = await startPage.evaluate(() =>
        Array.from(document.querySelectorAll('a[id*="lnkCaseName"]')).map((node) => ({
          id: (node as HTMLElement).id,
          name: (node.textContent ?? '').trim(),
        })),
      )
      // A named case rather than a quick quote by default: a quick quote is five
      // numbers, and the question is whether a full illustration yields more.
      const target = wanted
        ? cases.find((entry) => entry.name.toLowerCase().includes(wanted.toLowerCase()))
        : cases.find((entry) => !/-QQ-/i.test(entry.name)) ?? cases[0]
      if (!target) {
        report.skipped = 'no case matched'
        report.available = cases.map((entry) => entry.name)
        return 'ran'
      }
      report.openedCase = target.name

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

      // Through the tool's own client, both verbs: the earlier mapping saw the
      // widget services called as GET and the page services as POST, and
      // guessing wrong reads as "the service has nothing" rather than as "asked
      // the wrong way".
      report.services = await holder.evaluate(
        async ([token, services]) => {
          const w = window as never as {
            $ITAjax: {
              sendRequest(url: string, args: unknown[]): Promise<unknown>
              sendGetRequest?(url: string, args: unknown[]): Promise<unknown>
            }
            appPath: string
          }
          const out: Record<string, unknown> = {}
          for (const service of services as readonly string[]) {
            const url = `${w.appPath}/Main/${service}`
            try {
              out[service] = { verb: 'POST', body: await w.$ITAjax.sendRequest(url, [token]) }
            } catch (postError) {
              try {
                out[service] = {
                  verb: 'GET',
                  body: await w.$ITAjax.sendGetRequest?.(url, [token]),
                }
              } catch {
                out[service] = { failed: String(postError).slice(0, 120) }
              }
            }
          }
          return out
        },
        [tokenId, SERVICES] as const,
      )

      // Shape only. See the file header.
      report.services = Object.fromEntries(
        Object.entries(report.services as Record<string, unknown>).map(([name, result]) => [
          name,
          describeShape(result),
        ]),
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
