// The illustration form's real controls, so it can be driven instead of guessed at.
//
//   tsx scripts/national-life-describe-rapid-solve-form.ts
//
// An attempt to drive the form submitted nothing: the selectors came from
// reading the bundle rather than from the page, so the clicks landed on
// nothing and the page's own validation held the request back. This reads the
// controls out of the DOM.
//
// Read-only. Structure and labels — never a person's values.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const PAGE_PATH = '/agent/tools/business-tools/illustrations'

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
      await page.goto(new URL(PAGE_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await page.waitForTimeout(12_000)

      // Passed as source text rather than a function. tsx compiles this file
      // with esbuild, which injects a `__name` helper into any named function
      // it hands over — and that helper does not exist in the page, so the
      // evaluate died with `__name is not defined`.
      const form = (await page.evaluate(`(function () {
        function visible(el) {
          var rect = el.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }

        return {
          inputs: Array.prototype.map.call(document.querySelectorAll('input'), function (el) {
            return {
              id: el.id,
              name: el.getAttribute('name'),
              type: el.type,
              placeholder: el.placeholder,
              visible: visible(el),
            }
          }),
          dataValues: Array.prototype.map.call(
            document.querySelectorAll('[data-value]'),
            function (el) {
              var group = el.closest('[data-name]')
              return {
                tag: el.tagName.toLowerCase(),
                id: el.id,
                className: (el.className || '').toString().slice(0, 80),
                dataValue: el.getAttribute('data-value'),
                parentDataName: group ? group.getAttribute('data-name') : null,
                visible: visible(el),
              }
            },
          ),
          buttons: Array.prototype.map.call(
            document.querySelectorAll('button, a.btn, input[type=submit]'),
            function (el) {
              return {
                tag: el.tagName.toLowerCase(),
                id: el.id,
                className: (el.className || '').toString().slice(0, 80),
                text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
                visible: visible(el),
              }
            },
          ),
        }
      })()`)) as {
        inputs: Array<{ id: string; name: string | null; type: string; visible: boolean }>
        dataValues: Array<{
          tag: string
          id: string
          className: string
          dataValue: string | null
          parentDataName: string | null
          visible: boolean
        }>
        buttons: Array<{ id: string; className: string; text: string; visible: boolean }>
      }

      console.log(
        JSON.stringify(
          {
            inputs: form.inputs.filter((i) => i.id || i.name),
            // Grouped by the dropdown or toggle group they belong to, which is
            // what a click has to target.
            optionGroups: Object.entries(
              form.dataValues.reduce<Record<string, string[]>>((groups, entry) => {
                const key = entry.parentDataName ?? entry.id ?? 'ungrouped'
                groups[key] = groups[key] ?? []
                if (entry.dataValue) groups[key].push(entry.dataValue)
                return groups
              }, {}),
            ).map(([group, values]) => ({ group, values: values.slice(0, 60) })),
            optionElements: form.dataValues.slice(0, 25),
            buttons: form.buttons.filter((b) => b.visible && b.text),
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
