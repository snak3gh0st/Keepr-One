// Read-only discovery for portal pages that do NOT drive a DataTables grid.
// Reports what the page actually contains — server-rendered tables, forms that
// must be submitted first, and every same-origin XHR it issues — so the right
// extraction strategy can be chosen instead of guessed.
//
//   tsx scripts/national-life-describe-page.ts /agent/compensation/commissions/overview [...]
//
// Structure only: table headers, form field names, request URLs and shapes.
// Never cell values — these pages hold real client and commission data.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { portalRoutesIn } from '../lib/national-life/portal-routes'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const maskDigits = (value: string) => value.replace(/\d/g, '#')

function stripTags(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}


function describeHtml(html: string) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? []
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) ?? []

  return {
    title: stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 80),
    headings: uniq(
      (html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi) ?? []).map((h) => stripTags(h).slice(0, 60)),
    ).slice(0, 8),
    tableCount: tables.length,
    tables: tables.slice(0, 5).map((table) => ({
      id: table.match(/\bid="([^"]*)"/i)?.[1] ?? null,
      className: (table.match(/\bclass="([^"]*)"/i)?.[1] ?? '').slice(0, 70),
      headers: (table.match(/<th[\s\S]*?<\/th>/gi) ?? [])
        .map((th) => stripTags(th).slice(0, 40))
        .slice(0, 20),
      rowCount: (table.match(/<tr/gi) ?? []).length,
    })),
    // A period selector is the usual reason a report grid stays empty.
    forms: forms.slice(0, 5).map((form) => ({
      id: form.match(/\bid="([^"]*)"/i)?.[1] ?? null,
      action: maskDigits((form.match(/action="([^"]*)"/i)?.[1] ?? '').split('?')[0]).slice(0, 80),
      method: form.match(/method="([^"]*)"/i)?.[1] ?? null,
      fields: uniq(
        (form.match(/<(input|select|button)[^>]*>/gi) ?? []).map((tag) => {
          const name = tag.match(/\bname="([^"]*)"/i)?.[1] ?? ''
          const type = tag.match(/\btype="([^"]*)"/i)?.[1] ?? ''
          const id = tag.match(/\bid="([^"]*)"/i)?.[1] ?? ''
          return [type, name || id].filter(Boolean).join(' | ')
        }),
      ).slice(0, 20),
    })),
    selectIds: uniq(
      (html.match(/<select[^>]*\b(?:id|name)="([^"]*)"/gi) ?? []).map(
        (tag) => tag.match(/"([^"]*)"$/)?.[1] ?? '',
      ),
    ).slice(0, 15),
    dataAttributes: uniq((html.match(/\sdata-[a-z0-9-]+/gi) ?? []).map((a) => a.trim())).slice(0, 30),
    // Reported in full rather than sampled: a truncated route list reads as a
    // complete map of the portal and sends the next investigation guessing.
    routes: portalRoutesIn(html),
    htmlChars: html.length,
  }
}

async function main() {
  const env = getNationalLifeEnv()
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    throw new Error('pass at least one portal path')
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

  // Steel runs a single Chrome, so the keep-alive tick that fires every ten
  // minutes would otherwise close this probe's browser mid-navigation — the
  // failure that killed five probes and was misread as dead routes. Waiting
  // rather than skipping: a probe is cheap to delay and costs a carrier hit to
  // repeat.
  const ran = await withBrowserLockWaiting(prisma, async () => {
    const session = await createSteelBrowserSession(env, { sessionContext })

    const requests: string[] = []
    session.page.on('request', (request) => {
      const type = request.resourceType()
      if (type !== 'xhr' && type !== 'fetch') return
      const url = request.url()
      if (!url.includes('nationallife.com')) return
      requests.push(
        `${request.method()} ${maskDigits(url.split('?')[0])} body=${maskDigits(
          (request.postData() ?? '').slice(0, 200),
        )}`,
      )
    })

    try {
      for (const path of paths) {
        requests.length = 0
        const target = new URL(path, env.portalLoginUrl).toString()
        try {
          const response = await session.page.goto(target, {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          })
          await session.page.waitForTimeout(8_000)
          const html = await session.page.content()
          console.log(
            JSON.stringify(
              {
                path,
                status: response?.status() ?? null,
                landedOn: maskDigits(session.page.url()),
                ...describeHtml(html),
                xhr: uniq(requests).slice(0, 15),
              },
              null,
              2,
            ),
          )
        } catch (error) {
          console.error(
            JSON.stringify({
              path,
              failed: error instanceof Error ? error.message.split('\n')[0] : String(error),
              xhr: uniq(requests).slice(0, 15),
            }),
          )
        }
      }
    } finally {
      await session.close()
    }
    return 'ran'
  })

  // Disconnecting inside the lock would drop the connection that holds it.
  await prisma.$disconnect()

  if (ran === null) {
    // Non-zero: "another job held the browser" must not look like "probed and
    // found nothing" to whatever ran this.
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
