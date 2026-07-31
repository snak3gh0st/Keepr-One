// Keeps the carrier session alive by touching an authenticated page more often
// than its ~20 minute sliding window, so a scheduled sync finds a live session.
//
//   tsx scripts/national-life-keep-alive.ts
//
// Run it on a schedule shorter than the window (10 minutes). Silent re-auth was
// measured not to work and the product does not store the carrier password, so
// letting the window close means a human has to log in again — this is the only
// unattended way to avoid that.
//
// Uses a real browser: the portal is behind Akamai, so a bare HTTP request with
// the cookie jar is not a safe substitute.
//
// Touching `/agent/` renews the portal session and nothing else. The SSO targets
// downstream — Foresight, where a client's illustration PDF comes from — sit
// behind the carrier's Auth0 tenant, whose session has its own clock. With
// `NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP=true` each tick also traverses
// `/agent/sso/foresight`, which round-trips `/authorize` and renews that window
// too *if it is idle-based*. Measure with
// `scripts/national-life-probe-foresight-session.ts` before turning it on: if
// the Auth0 deadline never moves, the lifetime is absolute and the extra traffic
// buys nothing.
import {
  decryptBrowserContext,
  encryptBrowserContext,
} from '../lib/national-life/browser-context-crypto'
import { tryAcquireBrowserLock, releaseBrowserLock } from '../lib/national-life/browser-lock'
import { getNationalLifeEnv } from '../lib/national-life/env'
import {
  countContextCookies,
  createPrismaSessionRefreshStore,
  deriveCarrierExpiresAt,
  refreshStoredCarrierSession,
} from '../lib/national-life/session-refresh'
import { prisma } from '../lib/prisma'
import {
  captureSteelSessionContext,
  createSteelBrowserSession,
} from '../workers/national-life/steel-session'

const INTERACTIVE_STATES = ['OPENING_PORTAL', 'AWAITING_LOGIN', 'AWAITING_MFA']

function log(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ scope: 'national-life-keep-alive', ...payload }))
}

async function main() {
  const env = getNationalLifeEnv()

  // A login in progress owns the browser and the container's PID budget; a
  // keep-alive running alongside it is how Steel was wedged before.
  const interactive = await prisma.nationalLifeConnectionAttempt.count({
    where: {
      deploymentScope: env.sessionScopeId,
      provider: 'NATIONAL_LIFE',
      state: { in: INTERACTIVE_STATES },
      expiresAt: { gt: new Date() },
    },
  })
  if (interactive > 0) {
    log({ skipped: 'interactive login in progress' })
    await prisma.$disconnect()
    return
  }

  // Steel runs one Chrome: a tick that starts while an extraction is running
  // kills it mid-navigation. Skipping is always safe — the next tick is minutes
  // away and well inside the session window.
  if (!(await tryAcquireBrowserLock(prisma))) {
    log({ skipped: 'another carrier browser job is running' })
    await prisma.$disconnect()
    return
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
    log({ skipped: 'no connected session to keep alive' })
    await releaseBrowserLock(prisma)
    await prisma.$disconnect()
    return
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

  const session = await createSteelBrowserSession(env, { sessionContext })
  try {
    await session.page.goto(new URL('/agent/', env.portalLoginUrl).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await session.page.waitForTimeout(4_000)

    const html = await session.page.content()
    const stillAuthenticated =
      /log\s?out|sign\s?out/i.test(html) && !/<input[^>]+type=["']password["']/i.test(html)

    if (!stillAuthenticated) {
      // Leaving a dead session marked CONNECTED makes the card claim a working
      // integration and every sync fail confusingly. Mark it so the UI can ask
      // for a new login.
      await prisma.agentIntegrationSession.updateMany({
        where: { id: stored.id, deploymentScope: env.sessionScopeId, status: 'CONNECTED' },
        data: { status: 'SESSION_EXPIRED' },
      })
      log({ alive: false, markedExpired: true })
      return
    }

    // Strictly after the expiry decision above, and it never feeds into one: an
    // Auth0 login wall means the downstream SSO session is gone, not that the
    // portal session this job exists to protect is. Acting on it would throw
    // away a live session and force a human to log in again.
    let ssoJump: Record<string, unknown> | undefined
    if (env.keepAliveSsoJump) {
      try {
        await session.page.goto(new URL('/agent/sso/foresight', env.portalLoginUrl).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        })
        // The jump posts through a WebForms shell before Auth0 answers.
        await session.page.waitForTimeout(8_000)
        const jumpHtml = await session.page.content()
        const landedOn = session.page.url()
        ssoJump = {
          // Origin and path only: the SSO chain carries one-time codes in the query.
          landedOn: landedOn.split('?')[0],
          onAuth0: /auth0\.com/i.test(landedOn),
          authenticated: !/<input[^>]+type=["']password["']/i.test(jumpHtml),
        }
      } catch (error) {
        ssoJump = { failed: String(error).split('\n')[0].slice(0, 200) }
      }

      // Recorded so the agent can be told the illustration is out of reach
      // before clicking towards a PDF that will not come. Only written when the
      // jump actually produced a verdict: a navigation failure knows nothing,
      // and nothing is worse than false confidence in either direction.
      if (typeof ssoJump.authenticated === 'boolean') {
        await prisma.agentIntegrationSession.updateMany({
          where: { id: stored.id, deploymentScope: env.sessionScopeId, status: 'CONNECTED' },
          data: {
            illustrationSsoReachable: ssoJump.authenticated,
            illustrationSsoCheckedAt: new Date(),
          },
        })
      }
    }

    // Captured after the jump so a renewed Auth0 cookie is what gets stored.
    const refreshedContext = await captureSteelSessionContext(session.steelSessionId, env)
    const carrierExpiresAt = deriveCarrierExpiresAt(refreshedContext, env.portalOrigins)
    const { refreshed } = await refreshStoredCarrierSession(
      {
        sessionId: stored.id,
        encryptedContext: encryptBrowserContext(
          refreshedContext,
          {
            agentId: stored.agentId,
            scopeId: env.sessionScopeId,
            provider: 'NATIONAL_LIFE',
            purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
            formatVersion: 1,
          },
          { version: env.sessionKeyVersion, base64Key: env.sessionKeys[env.sessionKeyVersion] },
        ),
        carrierExpiresAt,
        refreshedAt: new Date(),
      },
      createPrismaSessionRefreshStore(prisma, env.sessionScopeId),
    )

    log({
      alive: true,
      refreshed,
      cookies: countContextCookies(refreshedContext),
      carrierExpiresAt: carrierExpiresAt?.toISOString() ?? null,
      ...(ssoJump ? { ssoJump } : {}),
    })
  } finally {
    await session.close()
    await releaseBrowserLock(prisma)
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  log({ failed: String(error).slice(0, 300) })
  process.exit(1)
})
