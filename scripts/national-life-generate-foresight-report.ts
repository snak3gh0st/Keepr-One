// Generate an illustration report for a case that already exists in Foresight.
//
//   tsx scripts/national-life-generate-foresight-report.ts [trecho-do-nome]
//
// First step that is not read-only. It opens a case from the tool's own Recent
// panel and asks the tool to render its report — the same thing the agent does
// by clicking, no more. It does not submit an application and never touches the
// e-App launcher.
//
// The report contract was read out of the bundles:
//
//   SetupReportDisplay [sessionTokenId, "h:mm:ss AM/PM"]
//   RenderReports      [sessionTokenId]
//   GetReportProgress  [sessionTokenId]   → { HasException, ... }
//   /Main/ReportDisplay.rspx?SessionTokenId=…
//
// Rather than reverse the ASMX wire format, the calls go through the tool's own
// `$ITAjax.sendRequest` inside the page: same transport, same session, no chance
// of getting the serialisation subtly wrong.
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

/// The local time string the tool builds itself before asking for a report.
/// Sending an ISO timestamp here would be the kind of mismatch that fails
/// quietly, so it is reproduced exactly: `h:mm:ss AM/PM`, no leading zero on
/// the hour, and 12 rather than 0 at noon and midnight.
export function reportTimeStamp(at: Date): string {
  const hours24 = at.getHours()
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${hours}:${pad(at.getMinutes())}:${pad(at.getSeconds())} ${suffix}`
}

/// Which case to open. A quick quote is named `RP-<surname>-QQ-<stamp>`, so a
/// substring is the natural handle; with nothing supplied the most recent quick
/// quote is used, since that is the one an agent just made.
export function pickCase(
  names: readonly string[],
  wanted: string | undefined,
): string | null {
  if (wanted) {
    return names.find((name) => name.toLowerCase().includes(wanted.toLowerCase())) ?? null
  }
  return names.find((name) => /-QQ-/i.test(name)) ?? names[0] ?? null
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
    const report: Record<string, unknown> = {}
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

      const cases = await startPage.evaluate(() =>
        Array.from(document.querySelectorAll('a[id*="lnkCaseName"]')).map((node) => ({
          id: (node as HTMLElement).id,
          name: (node.textContent ?? '').trim(),
        })),
      )
      const chosen = pickCase(
        cases.map((entry) => entry.name),
        wanted,
      )
      const target = cases.find((entry) => entry.name === chosen)
      report.cases = cases.map((entry) => entry.name)
      report.chosen = chosen
      if (!target) {
        report.skipped = 'no case matched'
        return 'ran'
      }

      await startPage.click(`[id="${target.id}"]`).catch(async () => {
        // WebForms postback links are often driven by their handler rather than
        // by navigation, so a direct click can be swallowed.
        await startPage.evaluate((id) => (document.getElementById(id) as HTMLElement)?.click(), target.id)
      })
      await page.waitForTimeout(20_000)

      // Everything from here uses the tool's own client, in whichever frame
      // carries it after the case opened.
      const holder =
        page.frames().find(async (frame) => {
          try {
            return await frame.evaluate(() => typeof (window as never as { $ITCommon?: unknown }).$ITCommon !== 'undefined')
          } catch {
            return false
          }
        }) ?? page.mainFrame()

      const tokenId = await holder
        .evaluate(() => {
          const common = (window as never as { $ITCommon?: { sessionTokenId(): string } }).$ITCommon
          return common ? common.sessionTokenId() : null
        })
        .catch(() => null)
      report.sessionTokenId = tokenId ? 'present' : null
      report.frameUrl = holder.url().split('?')[0]
      if (!tokenId) {
        report.skipped = 'no $ITCommon.sessionTokenId in any frame'
        return 'ran'
      }

      const outcome = await holder.evaluate(
        async ([token, stamp]) => {
          const w = window as never as {
            $ITAjax: { sendRequest(url: string, args: unknown[], ctx?: unknown): Promise<unknown> }
            appPath: string
          }
          const base = `${w.appPath}/Main/PageService.asmx`
          const steps: Record<string, unknown> = {}
          steps.setup = await w.$ITAjax.sendRequest(`${base}/SetupReportDisplay`, [token, stamp])
          steps.render = await w.$ITAjax.sendRequest(`${base}/RenderReports`, [token])
          for (let attempt = 0; attempt < 20; attempt += 1) {
            const progress = (await w.$ITAjax.sendRequest(`${base}/GetReportProgress`, [token])) as {
              HasException?: boolean
              IsComplete?: boolean
            } | null
            steps.progress = progress
            if (progress?.HasException || progress?.IsComplete) break
            await new Promise((resolve) => setTimeout(resolve, 3_000))
          }
          return steps
        },
        [tokenId, reportTimeStamp(new Date())] as const,
      )
      report.steps = outcome

      // What actually comes back from the report URL — the point of the whole
      // exercise. Content type and size only; the document itself is a client's
      // illustration and does not belong in a log.
      const documentUrl = new URL(
        `/NWI/Main/ReportDisplay.rspx?SessionTokenId=${encodeURIComponent(tokenId)}`,
        env.portalLoginUrl,
      ).toString()
      const fetched = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'include' })
        const buffer = await response.arrayBuffer()
        const head = new TextDecoder().decode(buffer.slice(0, 8))
        return {
          status: response.status,
          contentType: response.headers.get('content-type'),
          bytes: buffer.byteLength,
          looksLikePdf: head.startsWith('%PDF'),
        }
      }, documentUrl)
      report.document = fetched
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
