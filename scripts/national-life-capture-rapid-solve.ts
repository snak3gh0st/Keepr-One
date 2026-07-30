// The request the carrier's own page makes, captured from its own page.
//
//   tsx scripts/national-life-capture-rapid-solve.ts
//
// Four attempts were spent posting a payload built from reading the bundle and
// getting HTTP 500 back, with the exception hidden behind customErrors. Reading
// more of the script has stopped paying: every field matches. So this drives
// the tool the way an agent drives it — fill, click, and record what the page
// actually sends and what it gets back.
//
// This does submit a quote, through the carrier's own form. That is the same
// request the integration is trying to make, made the way the carrier intends,
// and it answers two questions at once: the exact payload the endpoint accepts,
// and whether the endpoint even works for this agent.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const PAGE_PATH = '/agent/tools/business-tools/illustrations'

/// Names of the fields the payload carries, and their types — never a person's
/// values beyond what this script itself filled in.
export function describePayload(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') return {}
  return Object.fromEntries(
    Object.entries(body as Record<string, unknown>).map(([key, value]) => [
      key,
      `${value === null ? 'null' : typeof value}: ${JSON.stringify(value)}`,
    ]),
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
      const seen: Array<Record<string, unknown>> = []

      page.on('response', async (response) => {
        if (!response.url().includes('RapidSolve')) return
        const request = response.request()
        let body: unknown = null
        try {
          body = JSON.parse(request.postData() ?? 'null')
        } catch {
          body = (request.postData() ?? '').slice(0, 400)
        }
        seen.push({
          url: response.url().split('?')[0],
          status: response.status(),
          requestHeaders: Object.fromEntries(
            Object.entries(await request.allHeaders()).filter(([name]) =>
              /content-type|requested-with|verification|accept$/i.test(name),
            ),
          ),
          payload: describePayload(body),
        })
      })

      await page.goto(new URL(PAGE_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await page.waitForTimeout(10_000)

      // Selectors read out of the page, not deduced from the bundle. The last
      // attempt clicked `#getQuote` and the button is `#get_quote`, so nothing
      // was ever submitted.
      await page.fill('#firstName', 'Paulo')
      await page.fill('#lastName', 'Loureiro Campos')
      await page.fill('#birthdate', '02/06/1988')

      // The toggles already default to Standard_NT, Specify_Amount and
      // A_Level — the last run proved it. Fighting a toggle that did not need
      // to move is what kept the form asking for a face amount while the
      // premium field stayed hidden. So take the defaults and give it the one
      // thing it wanted.
      await page.fill('#faceAmount', '250000')
      await page.waitForTimeout(600)

      // Hidden behind a styled label, which is why checking the input did
      // nothing. Failures are reported now instead of swallowed: three runs
      // were spent blind because every click was wrapped in a silent catch.
      // `#rapid_checkbox`, not `#check` — that one is the mobile menu, which is
      // why clicking it timed out on a control that was never part of the form.
      // Its label is the carrier's condition: agent use only, may be used for a
      // verbal quote, may not be shown to a consumer, values not guaranteed.
      const clicks: Record<string, string> = {}
      for (const [name, selector] of [
        ['agreement', 'label[for="rapid_checkbox"]'],
        ['agreement-input', '#rapid_checkbox'],
      ] as const) {
        try {
          await page.click(selector, { timeout: 4_000 })
          clicks[name] = 'clicked'
        } catch (error) {
          clicks[name] = String(error).split('\n')[0].slice(0, 120)
        }
      }
      await page.waitForTimeout(400)

      // Custom dropdowns: open, then pick.
      for (const [dropdown, value] of [
        ['#ddlIssueState', 'FL'],
        ['#ddlGender', 'Male'],
        ['#Strategy_dropdown', 'SP500PointToPointCapFocus'],
      ] as const) {
        await page.click(dropdown).catch(() => undefined)
        await page.waitForTimeout(800)
        await page.click(`[data-value="${value}"]:visible`).catch(() => undefined)
        await page.waitForTimeout(500)
      }

      // Only shown once a premium solve type is selected, which is why the
      // toggles are set first.
      await page.fill('#premiumAmount', '300').catch(() => undefined)
      await page.waitForTimeout(500)

      // What actually got set, before asking for the quote. Two attempts died
      // to a form that silently refused to submit; the page knows which field
      // is missing and says so, so read that instead of guessing again.
      const filled = (await page.evaluate(`(function () {
        function text(sel) {
          var el = document.querySelector(sel)
          return el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : null
        }
        function active(group) {
          var el = document.querySelector('[data-name="' + group + '"] .toggle-btn.active')
          return el ? el.getAttribute('data-value') : null
        }
        function val(sel) {
          var el = document.querySelector(sel)
          return el ? el.value : null
        }
        return {
          firstName: val('#firstName'),
          lastName: val('#lastName'),
          birthdate: val('#birthdate'),
          premiumAmount: val('#premiumAmount'),
          faceAmount: val('#faceAmount'),
          allocation: val('#allocation'),
          issueState: document.querySelector('#ddlIssueState')
            ? document.querySelector('#ddlIssueState').getAttribute('data-value')
            : null,
          issueStateText: text('#ddlIssueState'),
          gender: document.querySelector('#ddlGender')
            ? document.querySelector('#ddlGender').getAttribute('data-value')
            : null,
          genderText: text('#ddlGender'),
          strategy: document.querySelector('#Strategy_dropdown')
            ? document.querySelector('#Strategy_dropdown').getAttribute('data-value')
            : null,
          strategyText: text('#Strategy_dropdown'),
          rateClass: active('select-type'),
          solveType: active('Quote-type'),
          deathBenefit: active('Options-type'),
        }
      })()`)) as Record<string, string | null>

      const before = await page.content()
      await page.click('#get_quote').catch(() => undefined)
      await page.waitForTimeout(20_000)
      const after = await page.content()

      // The page's own validation messages, which name the field it is waiting
      // for.
      const validationErrors = (await page.evaluate(`(function () {
        return Array.prototype.map.call(
          document.querySelectorAll('.ap-error-text'),
          function (el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim() }
        ).filter(Boolean).slice(0, 12)
      })()`)) as string[]

      // Where the agreement actually lives. `#check` and its label both timed
      // out, so the control the form is waiting on is some other element, and
      // guessing at it again would be a fourth blind round.
      const agreement = (await page.evaluate(`(function () {
        var out = { checkboxes: [], nearError: null }

        out.checkboxes = Array.prototype.map.call(
          document.querySelectorAll('input[type=checkbox]'),
          function (el) {
            var rect = el.getBoundingClientRect()
            var label = el.id ? document.querySelector('label[for="' + el.id + '"]') : null
            return {
              id: el.id,
              name: el.getAttribute('name'),
              className: (el.className || '').toString().slice(0, 60),
              checked: el.checked,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              parentHtml: el.parentElement
                ? el.parentElement.outerHTML.replace(/\\s+/g, ' ').slice(0, 300)
                : null,
              labelText: label ? (label.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
            }
          },
        )

        var errors = document.querySelectorAll('.ap-error-text')
        for (var i = 0; i < errors.length; i++) {
          if ((errors[i].textContent || '').indexOf('agreement') !== -1) {
            var box = errors[i].closest('div')
            out.nearError = box ? box.outerHTML.replace(/\\s+/g, ' ').slice(0, 700) : null
          }
        }

        return out
      })()`)) as { checkboxes: unknown[]; nearError: string | null }

      console.log(
        JSON.stringify(
          {
            filled,
            clicks,
            validationErrors,
            agreement,
            requests: seen,
            // What the page told the agent, which is the answer when the
            // request never left.
            errorText: (after.match(/id="rapid-solve-error-text"[^>]*>([^<]{0,300})/) ?? [])[1] ?? null,
            pageChanged: before.length !== after.length,
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
