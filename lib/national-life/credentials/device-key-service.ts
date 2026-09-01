import 'server-only'

import { createHash, webcrypto } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import {
  publicRsaOaepJwkSchema,
  type PublicRsaOaepJwk,
} from '@/lib/national-life/local-connector/contracts'

type DeviceKeyDb = Pick<PrismaClient, 'nationalLifeConnectorDevice'>

export type DeviceEncryptionKeyErrorCode =
  | 'DEVICE_NOT_ACTIVE'
  | 'DEVICE_ENCRYPTION_KEY_INVALID'
  | 'DEVICE_ENCRYPTION_KEY_CONFLICT'

export class DeviceEncryptionKeyError extends Error {
  constructor(readonly code: DeviceEncryptionKeyErrorCode) {
    super(code)
    this.name = 'DeviceEncryptionKeyError'
  }
}

export function credentialEncryptionKeyThumbprint(jwk: JsonWebKey): string {
  const parsed = publicRsaOaepJwkSchema.safeParse(jwk)
  if (!parsed.success) throw new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_INVALID')
  const canonical = JSON.stringify({ e: parsed.data.e, kty: parsed.data.kty, n: parsed.data.n })
  return createHash('sha256').update(canonical, 'utf8').digest('base64url')
}

async function validateKey(value: unknown): Promise<PublicRsaOaepJwk> {
  const parsed = publicRsaOaepJwkSchema.safeParse(value)
  if (!parsed.success) throw new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_INVALID')
  try {
    await webcrypto.subtle.importKey(
      'jwk',
      parsed.data,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    )
  } catch {
    throw new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_INVALID')
  }
  return parsed.data
}

export async function registerDeviceEncryptionKey(
  db: DeviceKeyDb,
  input: { deviceId: string; agentId: string; publicKeyJwk: unknown },
) {
  const publicKeyJwk = await validateKey(input.publicKeyJwk)
  const thumbprint = credentialEncryptionKeyThumbprint(publicKeyJwk)
  const device = await db.nationalLifeConnectorDevice.findFirst({
    where: {
      id: input.deviceId,
      agentId: input.agentId,
      status: 'ACTIVE',
      revokedAt: null,
    },
    select: { id: true, agentId: true, encryptionKeyThumbprint: true },
  })
  if (!device) throw new DeviceEncryptionKeyError('DEVICE_NOT_ACTIVE')
  if (device.encryptionKeyThumbprint) {
    if (device.encryptionKeyThumbprint !== thumbprint) {
      throw new DeviceEncryptionKeyError('DEVICE_ENCRYPTION_KEY_CONFLICT')
    }
    return { registered: false as const, thumbprint, publicKeyJwk }
  }

  const updated = await db.nationalLifeConnectorDevice.updateMany({
    where: {
      id: input.deviceId,
      agentId: input.agentId,
      status: 'ACTIVE',
      revokedAt: null,
      encryptionKeyThumbprint: null,
    },
    data: {
      encryptionPublicKeyJwk: publicKeyJwk as Prisma.InputJsonValue,
      encryptionKeyThumbprint: thumbprint,
    },
  })
  if (updated.count !== 1) {
    const current = await db.nationalLifeConnectorDevice.findFirst({
      where: {
        id: input.deviceId,
        agentId: input.agentId,
        status: 'ACTIVE',
        revokedAt: null,
      },
      select: { encryptionKeyThumbprint: true },
    })
    if (current?.encryptionKeyThumbprint === thumbprint) {
      return { registered: false as const, thumbprint, publicKeyJwk }
    }
    throw new DeviceEncryptionKeyError(
      current ? 'DEVICE_ENCRYPTION_KEY_CONFLICT' : 'DEVICE_NOT_ACTIVE',
    )
  }
  return { registered: true as const, thumbprint, publicKeyJwk }
}
