import 'server-only'

import type { CalendarIntegration, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GOOGLE_CALENDAR_TOKEN_REFRESH_SKEW_MS } from './constants'
import { decryptGoogleSecret, encryptGoogleSecret } from './crypto'
import type { GoogleCalendarEnv } from './env'
import { GoogleReconnectRequiredError } from './errors'
import type { GoogleFetch } from './http'
import { refreshGoogleAccessToken } from './oauth'
import type { GoogleTokenResponse, GoogleUserInfo } from './types'

type CredentialDb = Pick<PrismaClient, 'calendarIntegration' | 'calendarSyncJob' | '$transaction'>

type EncryptedColumns = {
  keyVersion: string | null
  algorithm: string | null
  iv: string | null
  ciphertext: string | null
  authTag: string | null
}

function encryptedFromColumns(value: EncryptedColumns) {
  if (!value.keyVersion || !value.algorithm || !value.iv || !value.ciphertext || !value.authTag) {
    return null
  }
  return {
    keyVersion: value.keyVersion,
    algorithm: value.algorithm as 'aes-256-gcm',
    iv: value.iv,
    ciphertext: value.ciphertext,
    authTag: value.authTag,
  }
}

function binding(userId: string, providerAccountId: string, tokenKind: 'access' | 'refresh') {
  return { purpose: 'google-calendar-token', userId, providerAccountId, tokenKind }
}

function accessColumns(encrypted: ReturnType<typeof encryptGoogleSecret>) {
  return {
    accessKeyVersion: encrypted.keyVersion,
    accessAlgorithm: encrypted.algorithm,
    accessIv: encrypted.iv,
    accessCiphertext: encrypted.ciphertext,
    accessAuthTag: encrypted.authTag,
  }
}

function refreshColumns(encrypted: ReturnType<typeof encryptGoogleSecret>) {
  return {
    refreshKeyVersion: encrypted.keyVersion,
    refreshAlgorithm: encrypted.algorithm,
    refreshIv: encrypted.iv,
    refreshCiphertext: encrypted.ciphertext,
    refreshAuthTag: encrypted.authTag,
  }
}

function tokenExpiry(tokens: GoogleTokenResponse, now: Date) {
  const seconds = Number(tokens.expires_in)
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Google returned an invalid token expiry')
  return new Date(now.getTime() + seconds * 1000)
}

export async function saveGoogleCalendarConnection(
  input: {
    userId: string
    identity: GoogleUserInfo
    tokens: GoogleTokenResponse
    now?: Date
  },
  env: GoogleCalendarEnv,
  db: CredentialDb = prisma,
) {
  const now = input.now ?? new Date()
  const existing = await db.calendarIntegration.findUnique({
    where: { userId_provider: { userId: input.userId, provider: 'GOOGLE' } },
  })
  if (existing && existing.providerAccountId !== input.identity.sub) {
    // Replacing an account without disconnecting would leave calendars and
    // provider IDs from two Google identities under one integration.
    throw new Error('Disconnect the current Google Calendar account before connecting another one')
  }
  if (!input.tokens.refresh_token && !existing?.refreshCiphertext) {
    throw new GoogleReconnectRequiredError('Google did not return an offline refresh token')
  }

  const encryptedAccess = encryptGoogleSecret(
    input.tokens.access_token,
    binding(input.userId, input.identity.sub, 'access'),
    env,
  )
  const encryptedRefresh = input.tokens.refresh_token
    ? encryptGoogleSecret(
        input.tokens.refresh_token,
        binding(input.userId, input.identity.sub, 'refresh'),
        env,
      )
    : null
  const data = {
    providerAccountId: input.identity.sub,
    providerEmail: input.identity.email,
    displayName: input.identity.name ?? null,
    status: 'CONNECTED' as const,
    grantedScopes: input.tokens.scope?.split(/\s+/).filter(Boolean) ?? [],
    ...accessColumns(encryptedAccess),
    ...(encryptedRefresh ? refreshColumns(encryptedRefresh) : {}),
    tokenExpiresAt: tokenExpiry(input.tokens, now),
    connectedAt: now,
    disconnectedAt: null,
    lastErrorCode: null,
  }
  return db.calendarIntegration.upsert({
    where: { userId_provider: { userId: input.userId, provider: 'GOOGLE' } },
    create: { userId: input.userId, provider: 'GOOGLE', ...data },
    update: data,
  })
}

function decryptAccess(integration: CalendarIntegration, env: GoogleCalendarEnv) {
  const encrypted = encryptedFromColumns({
    keyVersion: integration.accessKeyVersion,
    algorithm: integration.accessAlgorithm,
    iv: integration.accessIv,
    ciphertext: integration.accessCiphertext,
    authTag: integration.accessAuthTag,
  })
  return encrypted
    ? decryptGoogleSecret(
        encrypted,
        binding(integration.userId, integration.providerAccountId, 'access'),
        env,
      )
    : null
}

function decryptRefresh(integration: CalendarIntegration, env: GoogleCalendarEnv) {
  const encrypted = encryptedFromColumns({
    keyVersion: integration.refreshKeyVersion,
    algorithm: integration.refreshAlgorithm,
    iv: integration.refreshIv,
    ciphertext: integration.refreshCiphertext,
    authTag: integration.refreshAuthTag,
  })
  return encrypted
    ? decryptGoogleSecret(
        encrypted,
        binding(integration.userId, integration.providerAccountId, 'refresh'),
        env,
      )
    : null
}

export async function getGoogleAccessToken(
  integrationId: string,
  env: GoogleCalendarEnv,
  options: { now?: Date; fetch?: GoogleFetch; db?: CredentialDb } = {},
) {
  const db = options.db ?? prisma
  const now = options.now ?? new Date()
  const integration = await db.calendarIntegration.findUnique({ where: { id: integrationId } })
  if (!integration || integration.status !== 'CONNECTED') throw new GoogleReconnectRequiredError()
  const current = decryptAccess(integration, env)
  if (
    current &&
    integration.tokenExpiresAt &&
    integration.tokenExpiresAt.getTime() > now.getTime() + GOOGLE_CALENDAR_TOKEN_REFRESH_SKEW_MS
  ) {
    return current
  }

  const refreshToken = decryptRefresh(integration, env)
  if (!refreshToken) throw new GoogleReconnectRequiredError()
  try {
    const refreshed = await refreshGoogleAccessToken(refreshToken, env, options.fetch)
    const encrypted = encryptGoogleSecret(
      refreshed.access_token,
      binding(integration.userId, integration.providerAccountId, 'access'),
      env,
    )
    await db.calendarIntegration.update({
      where: { id: integration.id },
      data: {
        ...accessColumns(encrypted),
        tokenExpiresAt: tokenExpiry(refreshed, now),
        status: 'CONNECTED',
        lastErrorCode: null,
      },
    })
    return refreshed.access_token
  } catch (error) {
    if (error instanceof GoogleReconnectRequiredError) {
      await db.calendarIntegration.update({
        where: { id: integration.id },
        data: { status: 'RECONNECT_REQUIRED', lastErrorCode: error.code },
      })
    }
    throw error
  }
}

export async function readGoogleRefreshToken(
  integrationId: string,
  env: GoogleCalendarEnv,
  db: CredentialDb = prisma,
) {
  const integration = await db.calendarIntegration.findUnique({ where: { id: integrationId } })
  if (!integration) return null
  return decryptRefresh(integration, env)
}

export async function disconnectGoogleCalendarLocally(
  userId: string,
  db: CredentialDb = prisma,
) {
  return db.$transaction(async (tx) => {
    const integration = await tx.calendarIntegration.findUnique({
      where: { userId_provider: { userId, provider: 'GOOGLE' } },
    })
    if (!integration) return null
    await tx.calendarWatchChannel.updateMany({
      where: { integrationId: integration.id, status: { in: ['ACTIVE', 'ERROR'] } },
      data: { status: 'STOPPED' },
    })
    return tx.calendarIntegration.update({
      where: { id: integration.id },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        accessKeyVersion: null,
        accessAlgorithm: null,
        accessIv: null,
        accessCiphertext: null,
        accessAuthTag: null,
        refreshKeyVersion: null,
        refreshAlgorithm: null,
        refreshIv: null,
        refreshCiphertext: null,
        refreshAuthTag: null,
        tokenExpiresAt: null,
      },
    })
  })
}
