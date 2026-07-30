/// Writes the cookies the carrier handed back during a run into the stored
/// session, so the next run starts from them instead of replaying the ones
/// captured at login.
///
/// This existed inline in the snapshot sync and nowhere else, which meant the
/// commission-detail and rendered-report syncs let the live cookies rotate in
/// the browser and then dropped them when it closed. The stored copy could only
/// get staler, and a stale copy is what forces a human back through MFA.
///
/// Never throws: an extraction that already succeeded must not be reported as
/// failed because the bookkeeping after it did.
import { encryptBrowserContext } from './browser-context-crypto'
import type { NationalLifeEnv } from './env'
import {
  countContextCookies,
  createPrismaSessionRefreshStore,
  deriveCarrierExpiresAt,
  refreshStoredCarrierSession,
} from './session-refresh'

type SessionContextCapturer = (steelSessionId: string, env: NationalLifeEnv) => Promise<unknown>

type StoredSession = { id: string; agentId: string }

type PrismaLike = Parameters<typeof createPrismaSessionRefreshStore>[0]

export type PersistSessionContextResult = {
  sessionRefreshed: boolean
  cookies: number
  carrierExpiresAt: string | null
} | {
  sessionRefreshFailed: string
}

export async function persistRefreshedSessionContext(options: {
  steelSessionId: string
  env: NationalLifeEnv
  stored: StoredSession
  prisma: PrismaLike
  capture: SessionContextCapturer
}): Promise<PersistSessionContextResult> {
  const { steelSessionId, env, stored, prisma, capture } = options
  try {
    const refreshedContext = (await capture(steelSessionId, env)) as Parameters<
      typeof countContextCookies
    >[0]
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

    return {
      sessionRefreshed: refreshed,
      cookies: countContextCookies(refreshedContext),
      carrierExpiresAt: carrierExpiresAt?.toISOString() ?? null,
    }
  } catch (error) {
    return {
      sessionRefreshFailed: error instanceof Error ? error.message : String(error),
    }
  }
}
