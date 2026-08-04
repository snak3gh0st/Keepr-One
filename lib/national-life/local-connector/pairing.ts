import 'server-only'

import { createHash, randomBytes, webcrypto } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { publicP256JwkSchema, type PublicP256Jwk } from './contracts'

export const LOCAL_CONNECTOR_PAIRING_TTL_MS = 5 * 60_000

type PairingDb = Pick<
  PrismaClient,
  'nationalLifeConnectorPairing' | 'nationalLifeConnectorDevice' | '$transaction'
>

export class LocalConnectorPairingError extends Error {
  constructor(readonly code: 'INVALID_PAIRING' | 'DEVICE_EXISTS') {
    super(code)
  }
}

export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

export async function createLocalConnectorPairing(
  db: Pick<PrismaClient, 'nationalLifeConnectorPairing'>,
  input: { agentId: string; now?: Date },
) {
  const now = input.now ?? new Date()
  const code = `NL-${randomBytes(24).toString('base64url')}`
  const expiresAt = new Date(now.getTime() + LOCAL_CONNECTOR_PAIRING_TTL_MS)

  await db.nationalLifeConnectorPairing.create({
    data: {
      agentId: input.agentId,
      codeHash: hashPairingCode(code),
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  })

  return { code, expiresAt }
}

export function publicKeyThumbprint(jwk: PublicP256Jwk): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
  return createHash('sha256').update(canonical, 'utf8').digest('base64url')
}

export async function exchangeLocalConnectorPairing(
  db: PairingDb,
  input: { code: string; label: string; publicKeyJwk: unknown; now?: Date },
) {
  const now = input.now ?? new Date()
  const publicKeyJwk = publicP256JwkSchema.parse(input.publicKeyJwk)
  await webcrypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const codeHash = hashPairingCode(input.code)
  const thumbprint = publicKeyThumbprint(publicKeyJwk)

  try {
    return await db.$transaction(async (tx) => {
      const pairing = await tx.nationalLifeConnectorPairing.findUnique({
        where: { codeHash },
        select: { id: true, agentId: true },
      })
      if (!pairing) throw new LocalConnectorPairingError('INVALID_PAIRING')

      const existing = await tx.nationalLifeConnectorDevice.findUnique({
        where: { publicKeyThumbprint: thumbprint },
        select: { id: true, agentId: true },
      })
      if (existing && existing.agentId !== pairing.agentId) {
        throw new LocalConnectorPairingError('DEVICE_EXISTS')
      }

      const consumed = await tx.nationalLifeConnectorPairing.updateMany({
        where: { id: pairing.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now, updatedAt: now },
      })
      if (consumed.count !== 1) throw new LocalConnectorPairingError('INVALID_PAIRING')

      if (existing) {
        await tx.nationalLifeConnectorDevice.update({
          where: { id: existing.id },
          data: {
            label: input.label,
            publicKeyJwk: publicKeyJwk as Prisma.InputJsonValue,
            status: 'ACTIVE',
            revokedAt: null,
            lastSeenAt: now,
            updatedAt: now,
          },
        })
        return { deviceId: existing.id, reclaimed: true as const }
      }

      const device = await tx.nationalLifeConnectorDevice.create({
        data: {
          agentId: pairing.agentId,
          label: input.label,
          publicKeyJwk: publicKeyJwk as Prisma.InputJsonValue,
          publicKeyThumbprint: thumbprint,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })
      return { deviceId: device.id, reclaimed: false as const }
    })
  } catch (error) {
    if (error instanceof LocalConnectorPairingError) throw error
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      throw new LocalConnectorPairingError('DEVICE_EXISTS')
    }
    throw error
  }
}
