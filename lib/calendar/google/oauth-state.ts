import 'server-only'

import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { GOOGLE_CALENDAR_OAUTH_STATE_TTL_MS } from './constants'
import { decryptGoogleSecret, encryptGoogleSecret, hashGoogleSecret } from './crypto'
import type { GoogleCalendarEnv } from './env'
import { createGooglePkceTransaction } from './oauth'

type OAuthStateDb = Pick<PrismaClient, 'calendarOAuthState' | '$transaction'>

function safeReturnTo(value?: string | null) {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  return value.slice(0, 500)
}
export async function createGoogleOAuthState(
  input: {
    userId: string
    sessionToken: string
    returnTo?: string | null
    now?: Date
  },
  env: GoogleCalendarEnv,
  db: OAuthStateDb = prisma,
) {
  const transaction = createGooglePkceTransaction()
  const stateHash = hashGoogleSecret(transaction.state)
  const encrypted = encryptGoogleSecret(
    transaction.codeVerifier,
    { purpose: 'calendar-oauth-state', userId: input.userId, stateHash },
    env,
  )
  const now = input.now ?? new Date()
  await db.calendarOAuthState.create({
    data: {
      userId: input.userId,
      stateHash,
      sessionTokenHash: hashGoogleSecret(input.sessionToken),
      verifierKeyVersion: encrypted.keyVersion,
      verifierAlgorithm: encrypted.algorithm,
      verifierIv: encrypted.iv,
      verifierCiphertext: encrypted.ciphertext,
      verifierAuthTag: encrypted.authTag,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(now.getTime() + GOOGLE_CALENDAR_OAUTH_STATE_TTL_MS),
    },
  })
  return transaction
}

export async function consumeGoogleOAuthState(
  input: {
    state: string
    userId: string
    sessionToken: string
    now?: Date
  },
  env: GoogleCalendarEnv,
  db: OAuthStateDb = prisma,
) {
  const now = input.now ?? new Date()
  const stateHash = hashGoogleSecret(input.state)
  return db.$transaction(async (tx) => {
    const state = await tx.calendarOAuthState.findUnique({ where: { stateHash } })
    if (
      !state ||
      state.userId !== input.userId ||
      state.consumedAt ||
      state.expiresAt <= now ||
      state.sessionTokenHash !== hashGoogleSecret(input.sessionToken)
    ) {
      throw new Error('Invalid or expired Google OAuth state')
    }
    const consumed = await tx.calendarOAuthState.updateMany({
      where: { id: state.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    })
    if (consumed.count !== 1) throw new Error('Google OAuth state was already consumed')
    const codeVerifier = decryptGoogleSecret(
      {
        keyVersion: state.verifierKeyVersion,
        algorithm: state.verifierAlgorithm as 'aes-256-gcm',
        iv: state.verifierIv,
        ciphertext: state.verifierCiphertext,
        authTag: state.verifierAuthTag,
      },
      { purpose: 'calendar-oauth-state', userId: state.userId, stateHash },
      env,
    )
    return { codeVerifier, returnTo: safeReturnTo(state.returnTo) }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}
