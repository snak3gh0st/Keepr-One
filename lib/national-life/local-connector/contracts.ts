import { z } from 'zod'
import { Buffer } from 'node:buffer'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '../portal-grid-client'

export const LOCAL_CONNECTOR_SCHEMA_VERSION = 3 as const

/// O que o servidor *aceita*, que não é o mesmo que o que ele *emite*.
///
/// `LOCAL_CONNECTOR_SCHEMA_VERSION` é a versão que o plano de run carrega para
/// fora — uma só, sempre a corrente. Este conjunto é a janela de tolerância na
/// entrada: enquanto ele tiver mais de um membro, duas versões da extensão
/// conseguem subir dados ao mesmo tempo.
///
/// É isso que transforma a próxima quebra de contrato numa depreciação em vez de
/// um corte. A Chrome Web Store não dá alavanca para acelerar atualização —
/// `requestUpdateCheck()` é limitado pelo mesmo backoff de 5h, e o Chrome só
/// instala com o service worker ocioso, o que num conector que acorda o tempo
/// todo significa dias, não horas. Rollout percentual exige >10.000 usuários
/// semanais; temos ~100. Então a única forma de não derrubar todo mundo é o
/// servidor aceitar N e N-1 durante a transição, e só depois estreitar o
/// conjunto.
///
/// Ordem do corte: (1) adicionar a versão nova aqui, (2) publicar a extensão que
/// a emite, (3) esperar a frota migrar — `x-fyntra-connector-version` diz quando —,
/// (4) remover a antiga daqui. Nunca (4) antes de (3).
export const LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS = [2, 3] as const

export type LocalConnectorSchemaVersion =
  (typeof LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS)[number]

export function isAcceptedLocalConnectorSchemaVersion(
  value: unknown,
): value is LocalConnectorSchemaVersion {
  return (LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS as readonly unknown[]).includes(value)
}
export const LOCAL_CONNECTOR_MAX_BODY_BYTES = 2 * 1024 * 1024
/// Raw carrier rows are fatter than normalized ones. 200 rows against the 2 MiB body
/// cap leaves headroom for the widest grid; the extension pages to match.
export const LOCAL_CONNECTOR_MAX_RECORDS = 200
/// Must match MAX_PORTAL_RECORDS in the extension's `lib/paging.ts`, which clamps
/// `recordsTotal` to that ceiling before it ever reaches here. A lower cap on this
/// side does not protect anything — it makes the very envelope the extension emits
/// when a grid overflows (`recordsTotal` at the ceiling, `truncated: true`) fail with
/// a 400, so a grid above the cap fails the run instead of ingesting what it got and
/// leaving the run open. The truncated path only works if both ceilings agree.
export const LOCAL_CONNECTOR_MAX_RECORDS_TOTAL = 200_000

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)

export const publicP256JwkSchema = z
  .strictObject({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    alg: z.literal('ES256').optional(),
    use: z.literal('sig').optional(),
    key_ops: z.tuple([z.literal('verify')]).optional(),
    ext: z.boolean().optional(),
  })
  .refine((jwk) => jwk.ext !== false, 'Public key must be extractable')

const rsa3072ModulusSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .refine((value) => {
    const bytes = Buffer.from(value, 'base64url')
    return bytes.length >= 384 &&
      bytes.length <= 512 &&
      bytes[0] !== 0 &&
      bytes.toString('base64url') === value
  }, 'RSA modulus must be canonical base64url for a 3072-4096 bit key')

export const publicRsaOaepJwkSchema = z.strictObject({
  kty: z.literal('RSA'),
  alg: z.literal('RSA-OAEP-256'),
  use: z.literal('enc'),
  key_ops: z.tuple([z.literal('encrypt')]),
  ext: z.literal(true),
  e: z.literal('AQAB'),
  n: rsa3072ModulusSchema,
})

export const LOCAL_CONNECTOR_MAX_ROW_BYTES = 16 * 1024

/// Shape is intentionally unconstrained: readLimitedBody already caps the whole
/// body at LOCAL_CONNECTOR_MAX_BODY_BYTES before this ever parses, and the request
/// is signed by a paired device, so a depth bound bought little security. What it
/// did cost was availability — one unexpectedly-deep row failed the whole 200-row
/// envelope, and a retry hit the same wall deterministically. Bound by serialized
/// size per row instead, which is the actual resource being protected.
export const rawGridRowSchema: z.ZodType<Record<string, unknown>> = z
  .record(z.string().max(128), z.unknown())
  .superRefine((row, ctx) => {
    if (JSON.stringify(row).length > LOCAL_CONNECTOR_MAX_ROW_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'row exceeds the per-row size cap' })
    }
  })

export const localConnectorRawStageEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal(LOCAL_CONNECTOR_ACCEPTED_SCHEMA_VERSIONS),
    runId: identifier,
    // The client's gridKey is never treated as authoritative on its own: it is
    // validated here against the server's own grid allowlist, and the route
    // additionally cross-checks it against the URL segment before ingest.
    gridKey: z.enum(
      Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]],
    ),
    sequence: z.number().int().min(0).max(10_000),
    /// Present in schema v3. Optional here so a rolling deployment can still
    /// accept v2 envelopes from an older installed extension.
    sourceOffset: z.number().int().min(0).max(LOCAL_CONNECTOR_MAX_RECORDS_TOTAL).optional(),
    nextOffset: z.number().int().min(0).max(LOCAL_CONNECTOR_MAX_RECORDS_TOTAL).optional(),
    observedAt: z.string().datetime({ offset: true }),
    recordsTotal: z.number().int().min(0).max(LOCAL_CONNECTOR_MAX_RECORDS_TOTAL),
    truncated: z.boolean(),
    records: z.array(rawGridRowSchema).max(LOCAL_CONNECTOR_MAX_RECORDS),
  })
  .superRefine((envelope, ctx) => {
    if (envelope.schemaVersion === 3 &&
      (envelope.sourceOffset === undefined || envelope.nextOffset === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'schema v3 requires source offsets' })
    }
    if (
      envelope.sourceOffset !== undefined &&
      envelope.nextOffset !== undefined &&
      envelope.nextOffset < envelope.sourceOffset
    ) {
      ctx.addIssue({ code: 'custom', message: 'nextOffset is before sourceOffset' })
    }
    if (envelope.recordsTotal < envelope.records.length) {
      ctx.addIssue({ code: 'custom', message: 'recordsTotal is below the page it carries' })
    }
  })

export type LocalConnectorRawStageEnvelope = z.infer<typeof localConnectorRawStageEnvelopeSchema>

export type PublicP256Jwk = z.infer<typeof publicP256JwkSchema>
export type PublicRsaOaepJwk = z.infer<typeof publicRsaOaepJwkSchema>
