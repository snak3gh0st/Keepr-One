import { z } from 'zod'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '../portal-grid-client'

export const LOCAL_CONNECTOR_SCHEMA_VERSION = 2 as const
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
    schemaVersion: z.literal(LOCAL_CONNECTOR_SCHEMA_VERSION),
    runId: identifier,
    // The client's gridKey is never treated as authoritative on its own: it is
    // validated here against the server's own grid allowlist, and the route
    // additionally cross-checks it against the URL segment before ingest.
    gridKey: z.enum(
      Object.keys(NATIONAL_LIFE_GRIDS) as [NationalLifeGridKey, ...NationalLifeGridKey[]],
    ),
    sequence: z.number().int().min(0).max(10_000),
    observedAt: z.string().datetime({ offset: true }),
    recordsTotal: z.number().int().min(0).max(LOCAL_CONNECTOR_MAX_RECORDS_TOTAL),
    truncated: z.boolean(),
    records: z.array(rawGridRowSchema).max(LOCAL_CONNECTOR_MAX_RECORDS),
  })
  .superRefine((envelope, ctx) => {
    if (envelope.recordsTotal < envelope.records.length) {
      ctx.addIssue({ code: 'custom', message: 'recordsTotal is below the page it carries' })
    }
  })

export type LocalConnectorRawStageEnvelope = z.infer<typeof localConnectorRawStageEnvelopeSchema>

export type PublicP256Jwk = z.infer<typeof publicP256JwkSchema>
