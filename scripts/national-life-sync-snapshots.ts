// Pulls National Life agent-portal grids into the case-snapshot / inforce-policy
// staging tables using the stored authenticated session. Read-only against the
// carrier.
//
//   tsx scripts/national-life-sync-snapshots.ts [GRID_KEY ...]
//
// Defaults to every grid confirmed to expose its data via GetJsonResult. Prints
// counts only, never row values. The same runner is used by the durable worker.
import {
  decryptBrowserContext,
  encryptBrowserContext,
} from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import {
  countContextCookies,
  createPrismaSessionRefreshStore,
  deriveCarrierExpiresAt,
  refreshStoredCarrierSession,
} from '../lib/national-life/session-refresh'
import {
  type GridPage,
  type NationalLifeGridKey,
} from '../lib/national-life/portal-grid-client'
import {
  NATIONAL_LIFE_SYNC_GRID_KEYS,
  syncNationalLifeGrid,
} from '../lib/national-life/sync-grid'
import { tryAcquireBrowserLock, releaseBrowserLock } from '../lib/national-life/browser-lock'
import { prisma } from '../lib/prisma'
import {
  captureSteelSessionContext,
  createSteelBrowserSession,
} from '../workers/national-life/steel-session'

const DEFAULT_GRIDS: readonly NationalLifeGridKey[] = NATIONAL_LIFE_SYNC_GRID_KEYS

function resolveGridKeys(): NationalLifeGridKey[] {
  const requested = process.argv.slice(2)
  const known: readonly string[] = [...NATIONAL_LIFE_SYNC_GRID_KEYS]
  if (requested.length === 0) {
    return [...DEFAULT_GRIDS]
  }
  const unknown = requested.filter((key) => !known.includes(key as NationalLifeGridKey))
  if (unknown.length > 0) {
    throw new Error(`unknown grid keys: ${unknown.join(', ')} (known: ${known.join(', ')})`)
  }
  return requested as NationalLifeGridKey[]
}

async function main() {
  const env = getNationalLifeEnv()
  const gridKeys = resolveGridKeys()

  const stored = await prisma.agentIntegrationSession.findFirst({
    where: {
      provider: 'NATIONAL_LIFE',
      purpose: 'CARRIER_SESSION',
      status: 'CONNECTED',
      deploymentScope: env.sessionScopeId,
    },
    orderBy: { lastConnectedAt: 'desc' },
  })
  if (!stored) {
    throw new Error('no CONNECTED National Life session stored — connect in the app first')
  }
  if (!stored.keyVersion || !stored.iv || !stored.ciphertext || !stored.authTag) {
    throw new Error('stored National Life session is incomplete')
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

  if (!(await tryAcquireBrowserLock(prisma))) {
    console.error(JSON.stringify({ failed: 'another carrier browser job is running' }))
    await prisma.$disconnect()
    return
  }

  const session = await createSteelBrowserSession(env, { sessionContext })
  const fetchedAt = new Date()

  try {
    for (const gridKey of gridKeys) {
      try {
        const result = await syncNationalLifeGrid({
          gridKey,
          page: session.page as unknown as GridPage,
          agentId: stored.agentId,
          deploymentScope: env.sessionScopeId,
          portalLoginUrl: env.portalLoginUrl,
          fetchedAt,
        })
        console.log(JSON.stringify({ gridKey, ...result }))
      } catch (error) {
        console.error(
          JSON.stringify({
            gridKey,
            failed: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }
    // Persist whatever the carrier handed back during this run. Without this the
    // cookies captured at login are replayed forever and the stored session can
    // only get staler, which is what forces a fresh MFA login.
    try {
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
      console.log(
        JSON.stringify({
          sessionRefreshed: refreshed,
          cookies: countContextCookies(refreshedContext),
          carrierExpiresAt: carrierExpiresAt?.toISOString() ?? null,
        }),
      )
    } catch (error) {
      // A failed refresh must never fail the extraction that already succeeded.
      console.error(
        JSON.stringify({
          sessionRefreshFailed: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  } finally {
    await session.close()
    await releaseBrowserLock(prisma)
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
