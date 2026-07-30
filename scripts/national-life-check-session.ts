// Liveness probe for the stored carrier session, and the test for whether the
// carrier's IdP re-authenticates us silently.
//
//   tsx scripts/national-life-check-session.ts
//
// Opens the portal with the stored context and reports where it lands: still
// authenticated, silently re-authenticated by SSO, or stopped at a login/MFA
// screen. A scheduled sync needs one of the first two; the third means a human
// has to log in again.
//
// Read-only and non-interactive: it never types credentials or submits a form.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { countContextCookies, deriveCarrierExpiresAt } from '../lib/national-life/session-refresh'
import { prisma } from '../lib/prisma'
import {
  captureSteelSessionContext,
  createSteelBrowserSession,
} from '../workers/national-life/steel-session'

const maskDigits = (value: string) => value.replace(/\d/g, '#')

function classify(html: string, url: string) {
  const hasPasswordField = /<input[^>]+type=["']password["']/i.test(html)
  const looksLikeMfa = /(verification code|one[- ]time|authenticator|send code|text message)/i.test(
    html,
  )
  const hasLogout = /log\s?out|sign\s?out/i.test(html)
  const onAuth0 = /auth0\.com/i.test(url)

  return {
    hasPasswordField,
    looksLikeMfa,
    hasLogout,
    onAuth0,
    verdict: hasPasswordField
      ? 'NEEDS_LOGIN'
      : looksLikeMfa
        ? 'NEEDS_MFA'
        : hasLogout
          ? 'AUTHENTICATED'
          : 'UNKNOWN',
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

  console.log(
    JSON.stringify({
      step: 'stored',
      cookies: countContextCookies(sessionContext),
      carrierExpiresAt: stored.carrierExpiresAt?.toISOString() ?? null,
      lastUsedAt: stored.lastUsedAt?.toISOString() ?? null,
      hoursSinceExpiry: stored.carrierExpiresAt
        ? Number(((Date.now() - stored.carrierExpiresAt.getTime()) / 3_600_000).toFixed(2))
        : null,
    }),
  )

  const session = await createSteelBrowserSession(env, { sessionContext })
  try {
    // Step 1: does the stored context still open an authenticated page?
    await session.page.goto(new URL('/agent/', env.portalLoginUrl).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    })
    await session.page.waitForTimeout(6_000)
    const directHtml = await session.page.content()
    const direct = classify(directHtml, session.page.url())
    console.log(
      JSON.stringify({ step: 'direct', landedOn: maskDigits(session.page.url()), ...direct }),
    )

    // Step 2: if it is gone, does the IdP hand us a new session with no
    // interaction? That is what makes an unattended daily sync possible.
    if (direct.verdict !== 'AUTHENTICATED') {
      await session.page.goto(env.portalLoginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      })
      await session.page.waitForTimeout(10_000)
      const ssoHtml = await session.page.content()
      const sso = classify(ssoHtml, session.page.url())
      console.log(
        JSON.stringify({
          step: 'sso-retry',
          landedOn: maskDigits(session.page.url()),
          ...sso,
          silentReauthWorks: sso.verdict === 'AUTHENTICATED',
        }),
      )

      if (sso.verdict === 'AUTHENTICATED') {
        const refreshed = await captureSteelSessionContext(session.steelSessionId, env)
        console.log(
          JSON.stringify({
            step: 'refreshed-context',
            cookies: countContextCookies(refreshed),
            carrierExpiresAt:
              deriveCarrierExpiresAt(refreshed, env.portalOrigins)?.toISOString() ?? null,
          }),
        )
      }
    }
  } finally {
    await session.close()
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
