import { Buffer } from 'node:buffer'
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
  type BinaryLike,
  type KeyObject,
} from 'node:crypto'
import { z } from 'zod'

export type ViewerBootstrapPayload = {
  purpose: 'NATIONAL_LIFE_VIEWER_BOOTSTRAP'
  attemptId: string
  agentId: string
  nonce: string
  expiresAt: string
}

export type ViewerSessionPayload = {
  purpose: 'NATIONAL_LIFE_VIEWER_SESSION'
  attemptId: string
  agentId: string
  expiresAt: string
}

type SigningKey = BinaryLike | KeyObject

const bootstrapPayloadSchema = z
  .object({
    purpose: z.literal('NATIONAL_LIFE_VIEWER_BOOTSTRAP'),
    attemptId: z.string().min(1),
    agentId: z.string().min(1),
    nonce: z.string().min(1),
    expiresAt: z.iso.datetime(),
  })
  .strict()

const sessionPayloadSchema = z
  .object({
    purpose: z.literal('NATIONAL_LIFE_VIEWER_SESSION'),
    attemptId: z.string().min(1),
    agentId: z.string().min(1),
    expiresAt: z.iso.datetime(),
  })
  .strict()

function signPayload(payload: object, signingKey: SigningKey) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', signingKey)
    .update(encodedPayload)
    .digest('base64url')
  return `${encodedPayload}.${signature}`
}

function decodeBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid viewer token')
  }

  const decoded = Buffer.from(value, 'base64url')
  if (decoded.toString('base64url') !== value) {
    throw new Error('Invalid viewer token')
  }
  return decoded
}

function verifyToken<T>(
  token: string,
  signingKey: SigningKey,
  now: Date,
  schema: z.ZodType<T>,
): T {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) {
      throw new Error('Invalid token format')
    }

    const [encodedPayload, encodedSignature] = parts
    const signature = decodeBase64Url(encodedSignature)
    const expectedSignature = createHmac('sha256', signingKey)
      .update(encodedPayload)
      .digest()

    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(signature, expectedSignature)
    ) {
      throw new Error('Invalid token signature')
    }

    const parsed = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'))
    const payload = schema.parse(parsed)
    const expiresAt = (payload as { expiresAt: string }).expiresAt

    if (new Date(expiresAt).getTime() <= now.getTime()) {
      throw new Error('Expired viewer token')
    }

    return payload
  } catch {
    throw new Error('Invalid viewer token')
  }
}

export function hashViewerNonce(nonce: string) {
  return createHash('sha256').update(nonce).digest('base64url')
}

export function createViewerBootstrapToken(
  payload: Omit<ViewerBootstrapPayload, 'purpose' | 'nonce'>,
  signingKey: SigningKey,
  createNonce: () => Buffer = () => randomBytes(32),
) {
  const nonce = createNonce().toString('base64url')
  const token = signPayload(
    {
      purpose: 'NATIONAL_LIFE_VIEWER_BOOTSTRAP',
      attemptId: payload.attemptId,
      agentId: payload.agentId,
      nonce,
      expiresAt: payload.expiresAt,
    } satisfies ViewerBootstrapPayload,
    signingKey,
  )

  return {
    token,
    nonce,
    nonceHash: hashViewerNonce(nonce),
  }
}

export function verifyViewerBootstrapToken(
  token: string,
  signingKey: SigningKey,
  now: Date = new Date(),
): ViewerBootstrapPayload {
  return verifyToken(token, signingKey, now, bootstrapPayloadSchema)
}

export function createViewerSessionToken(
  payload: Omit<ViewerSessionPayload, 'purpose'>,
  signingKey: SigningKey,
) {
  return signPayload(
    {
      purpose: 'NATIONAL_LIFE_VIEWER_SESSION',
      attemptId: payload.attemptId,
      agentId: payload.agentId,
      expiresAt: payload.expiresAt,
    } satisfies ViewerSessionPayload,
    signingKey,
  )
}

export function verifyViewerSessionToken(
  token: string,
  signingKey: SigningKey,
  now: Date = new Date(),
): ViewerSessionPayload {
  return verifyToken(token, signingKey, now, sessionPayloadSchema)
}
