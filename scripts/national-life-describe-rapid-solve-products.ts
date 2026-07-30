// Answers one question: does Rapid Solve quote anything besides product 956?
//
//   tsx scripts/national-life-describe-rapid-solve-products.ts
//
// The contract says `ProductCode` is hardcoded in the carrier's own script, so
// the illustration screen quotes exactly one product. The agency sells Term and
// IUL, so whether Term is reachable through this endpoint decides whether the
// screen shows one product or two — and that is a product decision nobody
// should make by guessing.
//
// Reads the bundle and the page. Both are GETs; the bundle is a static asset.
// No quote is submitted, which matters because a submission would be the first
// write this integration makes against a real agent account.
//
// Structure only: field names, product codes and option labels — never a value
// belonging to a person.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const ILLUSTRATIONS_PATH = '/agent/tools/business-tools/illustrations'

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

/// Every product code the script mentions, however it spells the assignment.
/// If 956 is the only one, the screen quotes one product and that is the answer.
export function productCodes(code: string): string[] {
  const found: string[] = []

  for (const match of code.matchAll(/ProductCode["'\s:=]+["']?(\d{2,6})["']?/gi)) {
    found.push(match[1])
  }
  // Product lists are often an array of codes near the word "product".
  for (const match of code.matchAll(/product[A-Za-z]*\s*[:=]\s*\[([^\]]{0,400})\]/gi)) {
    for (const inner of match[1].matchAll(/["'](\d{2,6})["']/g)) {
      found.push(inner[1])
    }
  }

  return uniq(found).sort()
}

/// Names the script uses for products, which is how a human tells whether 956
/// is the IUL and whether any term product appears at all.
export function productNames(code: string): string[] {
  const found: string[] = []

  for (const match of code.matchAll(
    /["']([A-Za-z][\w '&.-]{2,60}(?:Term|IUL|UL|Whole Life|Life)[\w '&.-]{0,40})["']/g,
  )) {
    found.push(match[1].trim())
  }
  for (const match of code.matchAll(/["']((?:Term|IUL)[\w '&.-]{0,40})["']/g)) {
    found.push(match[1].trim())
  }

  return uniq(found).slice(0, 60).sort()
}

/// The values the carrier accepts for the fields the form has to collect. These
/// are product-dependent, so picking them before reading them would be
/// inventing a contract.
export function optionLists(code: string): Record<string, string[]> {
  const fields = ['RateClass', 'Gender', 'DeathBenefitOption', 'Strategy', 'IssueState']
  const result: Record<string, string[]> = {}

  for (const field of fields) {
    const values: string[] = []
    const pattern = new RegExp(`${field}[\\w]*\\s*[:=]\\s*\\[([^\\]]{0,600})\\]`, 'gi')
    for (const match of code.matchAll(pattern)) {
      for (const inner of match[1].matchAll(/["']([^"']{1,60})["']/g)) {
        values.push(inner[1])
      }
    }
    if (values.length) {
      result[field] = uniq(values).slice(0, 60)
    }
  }

  return result
}

/// The page's own selects, plus the custom button dropdowns this portal uses
/// instead of <select>, which a plain field dump misses.
export function renderedOptions(html: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}

  for (const match of html.matchAll(
    /<select[^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi,
  )) {
    const [, name, body] = match
    result[`select:${name}`] = uniq(
      (body.match(/<option[^>]*>([\s\S]*?)<\/option>/gi) ?? []).map((option) =>
        option.replace(/<[^>]*>/g, '').trim(),
      ),
    ).slice(0, 60)
  }

  // Not capped. An earlier run came back with exactly 60 values against a
  // 60-item cap, which is what truncation looks like — and the cut fell on the
  // strategy list, which decides whether the screen asks for a strategy at all.
  for (const match of html.matchAll(
    /data-(?:value|option|product)=["']([^"']{1,60})["']/gi,
  )) {
    result['data-attributes'] = uniq([...(result['data-attributes'] ?? []), match[1]])
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
      await session.page.goto(new URL(ILLUSTRATIONS_PATH, env.portalLoginUrl).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await session.page.waitForTimeout(8_000)
      const html = await session.page.content()

      const scripts = uniq(
        (html.match(/<script[^>]+src=["']([^"']+)["']/gi) ?? []).map(
          (tag) => tag.match(/src=["']([^"']+)["']/i)?.[1] ?? '',
        ),
      ).filter((src) => /illustrat|rapid|quote|solve|product/i.test(src))

      const bundles: Record<string, unknown> = {}
      for (const src of scripts) {
        try {
          const response = await session.page.request.get(
            new URL(src.split('?')[0], env.portalLoginUrl).toString(),
          )
          if (!response.ok()) {
            bundles[src] = { status: response.status() }
            continue
          }
          const code = await response.text()
          bundles[src] = {
            chars: code.length,
            productCodes: productCodes(code),
            productNames: productNames(code),
            optionLists: optionLists(code),
          }
        } catch (error) {
          bundles[src] = { failed: String(error).slice(0, 120) }
        }
      }

      console.log(
        JSON.stringify(
          {
            path: ILLUSTRATIONS_PATH,
            bundles,
            renderedOptions: renderedOptions(html),
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

// Only when run as a command. The extraction above is imported by its tests,
// and importing it must not open a carrier browser.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')) {
  main().catch((error) => {
    console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
    process.exit(1)
  })
}
