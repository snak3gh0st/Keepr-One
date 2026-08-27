import 'server-only'

import { createHash, timingSafeEqual, webcrypto } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import {
  FounderAccessRequiredError,
  requireFounderAccessForAgent,
} from '@/lib/founder-access'
import { publicP256JwkSchema } from './contracts'

export const LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS = 5 * 60_000
export const LOCAL_CONNECTOR_SIGNATURE_HEADERS = {
  deviceId: 'x-fyntra-device-id',
  jti: 'x-fyntra-jti',
  timestamp: 'x-fyntra-timestamp',
  bodyHash: 'x-fyntra-body-sha256',
  signature: 'x-fyntra-signature',
} as const

const signedHeadersSchema = z.strictObject({
  deviceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  jti: z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  timestamp: z.string().datetime({ offset: true }),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  signature: z.string().min(80).max(160).regex(/^[A-Za-z0-9_-]+$/),
})

type SignatureDb = Pick<
  PrismaClient,
  'nationalLifeConnectorDevice' | 'nationalLifeConnectorReplay' | '$transaction'
>

/// `DEVICE_REVOKED` é a única afirmação sobre o dispositivo em si: o servidor
/// não conhece mais esta identidade. `FOUNDER_ACCESS_REQUIRED` afirma apenas o
/// estado comercial da conta, mantendo a identidade pareada intacta. Todo erro
/// técnico — relógio fora da janela, hash divergente, JWK ilegível ou soluço de
/// banco — é `INVALID_DEVICE_SIGNATURE` e pode dar certo na próxima tentativa.
///
/// A distinção é o que impede o cliente de destruir a chave privada de um
/// dispositivo saudável só porque o relógio dele está adiantado: apagar a chave
/// por causa de desvio de horário é um laço, porque o desvio persiste depois de
/// reparear.
export type LocalConnectorSignatureFailure =
  | 'INVALID_DEVICE_SIGNATURE'
  | 'DEVICE_REVOKED'
  | 'FOUNDER_ACCESS_REQUIRED'

export class LocalConnectorSignatureError extends Error {
  constructor(readonly code: LocalConnectorSignatureFailure = 'INVALID_DEVICE_SIGNATURE') {
    super(code)
  }
}

export function sha256Hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex')
}

export function canonicalDeviceMessage(input: {
  method: string
  pathname: string
  jti: string
  timestamp: string
  bodyHash: string
}): string {
  return [
    input.method.toUpperCase(),
    input.pathname,
    input.jti,
    input.timestamp,
    input.bodyHash,
  ].join('\n')
}

function readSignedHeaders(headers: Headers) {
  return signedHeadersSchema.parse({
    deviceId: headers.get(LOCAL_CONNECTOR_SIGNATURE_HEADERS.deviceId),
    jti: headers.get(LOCAL_CONNECTOR_SIGNATURE_HEADERS.jti),
    timestamp: headers.get(LOCAL_CONNECTOR_SIGNATURE_HEADERS.timestamp),
    bodyHash: headers.get(LOCAL_CONNECTOR_SIGNATURE_HEADERS.bodyHash),
    signature: headers.get(LOCAL_CONNECTOR_SIGNATURE_HEADERS.signature),
  })
}

function equalHash(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'hex')
  const actualBytes = Buffer.from(actual, 'hex')
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)
}

export async function verifyLocalConnectorDeviceRequest(
  db: SignatureDb,
  input: {
    method: string
    pathname: string
    headers: Headers
    body: Uint8Array
    now?: Date
  },
): Promise<{ deviceId: string; agentId: string; jti: string }> {
  try {
    const now = input.now ?? new Date()
    const signed = readSignedHeaders(input.headers)
    const signedAt = new Date(signed.timestamp)
    if (
      !Number.isFinite(signedAt.getTime()) ||
      Math.abs(now.getTime() - signedAt.getTime()) > LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS
    ) {
      throw new LocalConnectorSignatureError()
    }

    const actualBodyHash = sha256Hex(input.body)
    if (!equalHash(signed.bodyHash, actualBodyHash)) {
      throw new LocalConnectorSignatureError()
    }

    const device = await db.nationalLifeConnectorDevice.findFirst({
      where: { id: signed.deviceId, status: 'ACTIVE', revokedAt: null },
      select: { id: true, agentId: true, publicKeyJwk: true },
    })
    if (!device) throw new LocalConnectorSignatureError('DEVICE_REVOKED')

    const publicKeyJwk = publicP256JwkSchema.parse(device.publicKeyJwk)
    const key = await webcrypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const message = canonicalDeviceMessage({
      method: input.method,
      pathname: input.pathname,
      jti: signed.jti,
      timestamp: signed.timestamp,
      bodyHash: signed.bodyHash,
    })
    const valid = await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      Buffer.from(signed.signature, 'base64url'),
      new TextEncoder().encode(message),
    )
    if (!valid) throw new LocalConnectorSignatureError()

    // A signed connector request is an authenticated product entrypoint just
    // like an Agent Route Handler. Enforce the additive commercial boundary
    // here so every device-signed route inherits it. This happens only after
    // the signature is proven, avoiding an oracle for arbitrary device IDs,
    // and before replay/last-seen writes so a billing refusal does not mutate
    // otherwise healthy device state.
    await requireFounderAccessForAgent(device.agentId)

    await db.$transaction(async (tx) => {
      await tx.nationalLifeConnectorReplay.create({
        data: {
          deviceId: device.id,
          jti: signed.jti,
          expiresAt: new Date(signedAt.getTime() + LOCAL_CONNECTOR_SIGNATURE_WINDOW_MS),
          createdAt: now,
          updatedAt: now,
        },
      })
      await tx.nationalLifeConnectorDevice.update({
        where: { id: device.id },
        data: { lastSeenAt: now, updatedAt: now },
      })
    })

    return { deviceId: device.id, agentId: device.agentId, jti: signed.jti }
  } catch (error) {
    // Só escapam motivos que o cliente precisa distinguir: revogação da
    // identidade ou bloqueio comercial. Qualquer exceção técnica continua
    // colapsando em "assinatura inválida", para não virar oráculo de qual etapa
    // da verificação falhou.
    if (error instanceof FounderAccessRequiredError) {
      throw new LocalConnectorSignatureError('FOUNDER_ACCESS_REQUIRED')
    }
    if (
      error instanceof LocalConnectorSignatureError
      && (error.code === 'DEVICE_REVOKED' || error.code === 'FOUNDER_ACCESS_REQUIRED')
    ) {
      throw error
    }
    throw new LocalConnectorSignatureError()
  }
}
