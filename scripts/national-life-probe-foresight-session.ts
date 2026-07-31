// Does the Foresight jump die before the portal does, and can it be kept alive?
//
//   tsx scripts/national-life-probe-foresight-session.ts
//
// Two probes minutes apart said opposite things about `/agent/sso/foresight`,
// and the failing one ran three minutes before `carrierExpiresAt` — when the
// portal session was itself nearly gone. So "Auth0 decays before the portal" was
// never actually measured: no run has ever reported both verdicts from the same
// browser in the same minute. This does exactly that, and reads the cookie
// deadlines around each step:
//
//   seeded  → what the stored context carries before any navigation
//   /agent/ → is the portal still authenticated?
//   jump    → does `/agent/sso/foresight` land in the tool or on the Auth0 wall?
//
// The discriminator is whether an Auth0 cookie's expiry *moves forward* across a
// step. If the jump advances it, the SSO window is idle-based and a keep-alive
// that traverses the jump can hold it open. If nothing moves, the lifetime is
// absolute and no amount of touching helps — which settles the question the
// other way, and is just as complete an answer.
//
// Read-only: it navigates, and never submits a form or types a credential.
// Cookie names and domains are reported, never values, and every URL is stripped
// of its query string — the SSO chain carries one-time codes there.
//
// Run it twice, fresh and ~15 minutes later: decay is a two-sample question.
import type { SessionContext } from 'steel-sdk/resources/sessions/sessions'
import { withBrowserLockWaiting } from '../lib/national-life/browser-lock'
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'
import {
  captureSteelSessionContext,
  createSteelBrowserSession,
} from '../workers/national-life/steel-session'

const PORTAL_PATH = '/agent/'
const FORESIGHT_PATH = '/agent/sso/foresight'

export type CookieFact = {
  key: string
  domain: string
  name: string
  expiresAt: string | null
}

type RawCookie = { name?: string; domain?: string; expires?: number }

/// Cookie deadlines as facts that can be diffed between steps. Values are never
/// read: what matters is which cookie exists, on which host, and until when.
export function summarizeCookies(context: unknown): CookieFact[] {
  const cookies = (context as { cookies?: RawCookie[] })?.cookies
  if (!Array.isArray(cookies)) {
    return []
  }

  return cookies
    .map((cookie) => {
      const domain = cookie.domain ?? ''
      const name = cookie.name ?? ''
      // Session cookies carry no deadline; only a positive epoch means anything.
      const expires = typeof cookie.expires === 'number' && cookie.expires > 0 ? cookie.expires : null
      return {
        key: `${domain}|${name}`,
        domain,
        name,
        expiresAt: expires === null ? null : new Date(expires * 1000).toISOString(),
      }
    })
    .sort((left, right) => left.key.localeCompare(right.key))
}

/// The whole point of the run: an expiry that moved forward means the window is
/// idle-based and a touch renews it. One that did not move is absolute.
export function shiftedExpiries(before: CookieFact[], after: CookieFact[]) {
  const beforeByKey = new Map(before.map((fact) => [fact.key, fact]))
  const afterByKey = new Map(after.map((fact) => [fact.key, fact]))

  const moved = after
    .filter((fact) => fact.expiresAt !== null)
    .map((fact) => {
      const previous = beforeByKey.get(fact.key)
      if (!previous?.expiresAt || previous.expiresAt === fact.expiresAt) {
        return null
      }
      const movedMs = new Date(fact.expiresAt as string).getTime() - new Date(previous.expiresAt).getTime()
      return {
        key: fact.key,
        from: previous.expiresAt,
        to: fact.expiresAt as string,
        movedMinutes: Number((movedMs / 60_000).toFixed(2)),
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  return {
    moved,
    appeared: after.filter((fact) => !beforeByKey.has(fact.key)).map((fact) => fact.key),
    vanished: before.filter((fact) => !afterByKey.has(fact.key)).map((fact) => fact.key),
  }
}

/// Where the browser actually went. Query strings are dropped before anything is
/// printed: `/authorize` and the carrier callback carry codes and MFA tokens.
export function hopPaths(urls: readonly string[]): string[] {
  const hops: string[] = []
  for (const url of urls) {
    const stripped = url.split('?')[0].split('#')[0]
    if (stripped !== hops[hops.length - 1]) {
      hops.push(stripped)
    }
  }
  return hops
}

export function classifyLanding(html: string, url: string) {
  const hasPasswordField = /<input[^>]+type=["']password["']/i.test(html)
  const looksLikeMfa = /(verification code|one[- ]time|authenticator|send code|text message)/i.test(
    html,
  )
  const hasLogout = /log\s?out|sign\s?out/i.test(html)

  return {
    // A log out link outranks an MFA-looking phrase: a challenge screen does not
    // offer to log you out, but an authenticated portal page can easily mention
    // a text message. Reading the phrase first called the live `/agent/` page
    // NEEDS_MFA on 2026-07-31, which is how this ordering was found.
    verdict: hasPasswordField
      ? 'NEEDS_LOGIN'
      : hasLogout
        ? 'AUTHENTICATED'
        : looksLikeMfa
          ? 'NEEDS_MFA'
          : 'UNKNOWN',
    // The raw signals travel with the verdict so a reader can second-guess it
    // instead of trusting one regex with the whole conclusion.
    hasPasswordField,
    looksLikeMfa,
    hasLogout,
    // An Auth0 wall reached through the jump says nothing about the portal
    // session, and must never be read as one.
    onAuth0: /auth0\.com/i.test(url),
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
    try {
      // Document navigations only, across every host: the earlier probe filtered
      // to nationallife.com and so could not see the Auth0 leg at all.
      let hops: string[] = []
      const blocked = new Set<string>()
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) hops.push(frame.url())
      })
      page.on('requestfailed', (request) => {
        if (!request.isNavigationRequest()) return
        // The navigation guard aborts with `blockedbyclient`; reported as an
        // origin so an allowlist gap is never misread as a login wall.
        try {
          blocked.add(new URL(request.url()).origin)
        } catch {
          blocked.add('unparseable')
        }
      })

      const visit = async (path: string) => {
        hops = []
        let navigationError: string | null = null
        try {
          await page.goto(new URL(path, env.portalLoginUrl).toString(), {
            waitUntil: 'domcontentloaded',
            timeout: 60_000,
          })
        } catch (error) {
          navigationError = String(error).split('\n')[0].slice(0, 200)
        }
        // The SSO chain posts through a WebForms shell before it settles.
        await page.waitForTimeout(15_000)
        const html = await page.content()
        return {
          landedOn: page.url().split('?')[0],
          ...classifyLanding(html, page.url()),
          hops: hopPaths(hops),
          navigationError,
        }
      }

      // Read the deadlines twice, from two places. Steel's `sessions.context()`
      // is only ever called once per job elsewhere, at the end — whether it
      // reflects live cookie state mid-session or a snapshot that settles on
      // release has never been checked. A stale snapshot would report "nothing
      // moved", which is indistinguishable from the absolute-lifetime verdict
      // and would end this investigation on a confident wrong answer. The
      // browser's own jar is the primary signal; Steel is the cross-check.
      const capture = async () => ({
        live: summarizeCookies({ cookies: await page.context().cookies() }),
        steel: summarizeCookies(await captureSteelSessionContext(session.steelSessionId, env)),
      })

      const seeded = summarizeCookies(sessionContext as SessionContext)

      const portal = await visit(PORTAL_PATH)
      const afterPortal = await capture()

      const foresight = await visit(FORESIGHT_PATH)
      const afterJump = await capture()

      console.log(
        JSON.stringify(
          {
            probedAt: new Date().toISOString(),
            storedCarrierExpiresAt: stored.carrierExpiresAt?.toISOString() ?? null,
            minutesToStoredExpiry: stored.carrierExpiresAt
              ? Number(((stored.carrierExpiresAt.getTime() - Date.now()) / 60_000).toFixed(1))
              : null,
            allowedOrigins: env.portalOrigins,
            blockedOrigins: Array.from(blocked).sort(),
            // The measurement that never existed: both verdicts, one browser,
            // one minute.
            portal,
            foresight,
            cookies: { seeded, afterPortal, afterJump },
            // The measurement: did the jump renew an Auth0 deadline? Read
            // `live` first. If `live` and `steel` disagree, the Steel snapshot
            // is stale — which is a finding about the tool, not about the
            // carrier, and must not be read as "the deadline is absolute".
            jumpMoved: {
              live: shiftedExpiries(afterPortal.live, afterJump.live),
              steel: shiftedExpiries(afterPortal.steel, afterJump.steel),
            },
            // Context: the seeded side comes from the decrypted database row and
            // the other from a live jar, so churn here is source difference as
            // much as renewal. Not the signal.
            portalTouchMoved: shiftedExpiries(seeded, afterPortal.live),
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
