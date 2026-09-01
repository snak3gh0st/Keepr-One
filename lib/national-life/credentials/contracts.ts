import { Buffer } from 'node:buffer'
import { z } from 'zod'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const nonBlankUsername = z.string().min(1).max(128).refine(
  (value) => value.trim().length > 0,
  'Username must not be blank',
)
const password = z.string().min(1).max(256)
const canonicalBase64Url = (minimumBytes: number, maximumBytes: number) => z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => {
    const bytes = Buffer.from(value, 'base64url')
    return bytes.length >= minimumBytes &&
      bytes.length <= maximumBytes &&
      bytes.toString('base64url') === value
  }, 'Value must be canonical base64url with an approved size')

const credentialPlaintextSchema = z.strictObject({
  formatVersion: z.literal(1),
  username: nonBlankUsername,
  password,
})

const credentialBindingSchema = z.strictObject({
  agentId: identifier,
  formatVersion: z.literal(1),
  provider: z.literal('NATIONAL_LIFE'),
  purpose: z.literal('PORTAL_CREDENTIAL'),
})

const credentialOperationSchema = z.strictObject({
  kind: z.enum(['SYNC_RUN', 'CONNECTOR_COMMAND']),
  id: identifier,
})

const credentialLeaseRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: credentialOperationSchema,
  page: z.strictObject({
    origin: z.enum([
      'https://www.nationallife.com',
      'https://nlg-prod.auth0.com',
    ]),
    pathname: z.string().min(1).max(256).regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/),
    classification: z.literal('LOGIN'),
  }),
})

const credentialLeaseResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(['AUTHENTICATED', 'MFA_REQUIRED', 'REJECTED', 'UNKNOWN_PAGE']),
})

const sealedCredentialLeaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  leaseId: identifier,
  expiresAt: z.string().datetime({ offset: true }),
  operation: credentialOperationSchema.extend({
    authEpoch: z.number().int().min(0),
  }),
  keyAlgorithm: z.literal('RSA-OAEP-256'),
  contentAlgorithm: z.literal('AES-256-GCM'),
  wrappedKey: canonicalBase64Url(384, 512),
  iv: canonicalBase64Url(12, 12),
  ciphertext: canonicalBase64Url(17, 2_048),
})

export type CredentialPlaintextV1 = Readonly<z.infer<typeof credentialPlaintextSchema>>
export type CredentialBindingV1 = Readonly<z.infer<typeof credentialBindingSchema>>
export type CredentialLeaseRequestV1 = Readonly<z.infer<typeof credentialLeaseRequestSchema>>
export type CredentialLeaseOutcome = z.infer<typeof credentialLeaseResultSchema>['outcome']
export type CredentialLeaseResultV1 = Readonly<z.infer<typeof credentialLeaseResultSchema>>
export type SealedCredentialLeaseV1 = Readonly<z.infer<typeof sealedCredentialLeaseSchema>>

function parseOrNull<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseCredentialPlaintext(value: unknown): CredentialPlaintextV1 | null {
  return parseOrNull(credentialPlaintextSchema, value)
}

export function parseCredentialBinding(value: unknown): CredentialBindingV1 | null {
  return parseOrNull(credentialBindingSchema, value)
}

export function parseCredentialLeaseRequest(value: unknown): CredentialLeaseRequestV1 | null {
  return parseOrNull(credentialLeaseRequestSchema, value)
}

export function parseCredentialLeaseResult(value: unknown): CredentialLeaseResultV1 | null {
  return parseOrNull(credentialLeaseResultSchema, value)
}

export function parseSealedCredentialLease(value: unknown): SealedCredentialLeaseV1 | null {
  return parseOrNull(sealedCredentialLeaseSchema, value)
}
