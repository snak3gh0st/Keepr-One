// Measures whether the per-policy detail page actually carries premium and face
// amount, on a sample, before anyone spends 9,614 carrier requests finding out.
//
//   tsx scripts/national-life-sample-policy-details.ts [sampleSize]
//
// This exists because the question was probed once and left unresolved: face
// amount "not found", death benefit found but "inconsistent", modal premium not
// found as a phrase. A hit rate is the difference between "expensive but known"
// and "expensive and unproven" — and the probe that could tell them apart was a
// scratch file that got deleted.
//
// Reports presence and hit rates only. Never prints a value: these are real
// policies belonging to real people.
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

// Each probe is a carrier request, so the default stays small enough to be
// cheap and large enough to tell 100% from 30%.
const DEFAULT_SAMPLE = 20

/// Labels the carrier might use for each figure. Matched case-insensitively
/// against visible text, because the prior probe failed by searching for one
/// exact phrase and concluding the field was absent.
const WANTED = {
  faceAmount: [/face\s*amount/i, /death\s*benefit/i, /specified\s*amount/i, /coverage\s*amount/i],
  premium: [/modal\s*premium/i, /premium\s*amount/i, /annual\s*premium/i, /planned\s*premium/i, /\bpremium\b/i],
} as const

function stripTags(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
}

/// True when the label appears AND a currency figure shows up close enough to
/// plausibly be its value. A label alone is a heading, not data.
///
/// Every occurrence is checked, not just the first. The nav on every page says
/// "Premium Increase Program", so testing only the first match reported "no
/// premium on this page" for all 20 pages of the first sample — a false
/// negative that would have sent the search for premium somewhere else
/// entirely. The same class of bug as the case-sensitive finder fixed earlier.
function hasLabelledMoney(text: string, patterns: readonly RegExp[]) {
  const MONEY = /\$\s?[\d,]+(?:\.\d{2})?/
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    for (const match of text.matchAll(global)) {
      const index = match.index ?? 0
      // Look both ways: label-above-value and value-left-of-label are both
      // common in these tables.
      if (MONEY.test(text.slice(Math.max(0, index - 60), index + 160))) return true
    }
  }
  return false
}

async function main() {
  const env = getNationalLifeEnv()
  const sampleSize = Number(process.argv[2] ?? DEFAULT_SAMPLE)

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

  // The drill-down token lives in the payload the grid already gave us, so the
  // sample costs one request per policy and nothing to discover the links.
  const rows = await prisma.$queryRawUnsafe<Array<{ href: string }>>(
    `SELECT DISTINCT substring(raw::text from 'policy-details\\?id=([0-9a-fA-F]{16,})') AS href
     FROM "NationalLifeInforcePolicy"
     WHERE raw::text LIKE '%policy-details?id=%'
     LIMIT $1`,
    sampleSize,
  )
  const ids = rows.map((row) => row.href).filter(Boolean)
  if (ids.length === 0) {
    throw new Error('no policy-details tokens found in NationalLifeInforcePolicy.raw')
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
    // `anyMoney` and the size spread are the control: this page answers 200 even
    // for a bogus id, so "reachable" alone proves nothing. A page carrying no
    // currency at all, or every page being byte-identical, means the sample hit
    // empty shells and the hit rate says nothing about where premium lives.
    const tally = {
      probed: 0,
      reachable: 0,
      anyMoney: 0,
      faceAmount: 0,
      premium: 0,
      both: 0,
      failed: 0,
    }
    const sizes = new Set<number>()
    const started = Date.now()

    try {
      for (const id of ids) {
        const target = new URL(
          `/agent/book-of-business/inforce-book/all-clients/policy-details?id=${id}`,
          env.portalLoginUrl,
        ).toString()
        tally.probed += 1
        try {
          const response = await session.page.goto(target, {
            waitUntil: 'domcontentloaded',
            timeout: 45_000,
          })
          await session.page.waitForTimeout(3_000)
          if ((response?.status() ?? 0) >= 400) continue
          tally.reachable += 1

          const html = await session.page.content()
          sizes.add(html.length)
          const text = stripTags(html)
          if (/\$\s?[\d,]+(?:\.\d{2})?/.test(text)) tally.anyMoney += 1
          const face = hasLabelledMoney(text, WANTED.faceAmount)
          const premium = hasLabelledMoney(text, WANTED.premium)
          if (face) tally.faceAmount += 1
          if (premium) tally.premium += 1
          if (face && premium) tally.both += 1
        } catch {
          tally.failed += 1
        }
      }
    } finally {
      await session.close()
    }

    const rate = (n: number) =>
      tally.reachable === 0 ? null : Number(((n / tally.reachable) * 100).toFixed(1))
    // Seconds per page is what turns a hit rate into a schedule: it is the only
    // number that says whether 9,614 pages is an hour or a night.
    const msPerPage = tally.probed === 0 ? null : Math.round((Date.now() - started) / tally.probed)

    console.log(
      JSON.stringify(
        {
          ...tally,
          distinctPageSizes: sizes.size,
          anyMoneyHitRate: rate(tally.anyMoney),
          faceAmountHitRate: rate(tally.faceAmount),
          premiumHitRate: rate(tally.premium),
          bothHitRate: rate(tally.both),
          msPerPage,
          projectedHoursForFullBook:
            msPerPage === null ? null : Number(((msPerPage * 9614) / 3_600_000).toFixed(1)),
        },
        null,
        2,
      ),
    )
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

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
