import { z } from 'zod'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '../portal-grid-client'

export const LOCAL_CONNECTOR_SCHEMA_VERSION = 2 as const
export const LOCAL_CONNECTOR_MAX_BODY_BYTES = 2 * 1024 * 1024
/// Raw carrier rows are fatter than normalized ones. 200 rows against the 2 MiB body
/// cap leaves headroom for the widest grid; the extension pages to match.
export const LOCAL_CONNECTOR_MAX_RECORDS = 200
export const LOCAL_CONNECTOR_GRID_KEYS = ['NEW_BUSINESS', 'INFORCE_CLIENTS'] as const
/// The typed envelope below is pinned to the version the shipped extension still
/// sends. Do not couple this to LOCAL_CONNECTOR_SCHEMA_VERSION: Task 7 deletes this
/// constant together with the typed schemas once the raw path is proven.
const LEGACY_ENVELOPE_SCHEMA_VERSION = 1 as const
/// The typed envelope's own record cap. The live stage route still parses these
/// schemas against an already-installed extension that pages at 500 rows, so this
/// must not follow LOCAL_CONNECTOR_MAX_RECORDS down to 200 or every page from a
/// deployed device 400s until Task 9 lowers the extension's page size. Task 7
/// deletes this constant together with the typed schemas.
export const LEGACY_MAX_RECORDS = 1_000

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/)
const normalizedText = z
  .string()
  .trim()
  .max(512)
  .refine((value) => !/[<>]/.test(value) && !value.includes('\u0000'), 'Markup is not allowed')
const nullableText = normalizedText.nullable().optional()
const nullableEmail = z.string().trim().email().max(320).nullable().optional()

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

export const newBusinessRecordSchema = z.strictObject({
  policyNo: normalizedText.min(1).max(128),
  insuredName: nullableText,
  ownerName: nullableText,
  product: nullableText,
  carrierStatus: nullableText,
  deliveryStatus: nullableText,
  actionRequired: nullableText,
  requirements: nullableText,
  submitDate: nullableText,
  sentDate: nullableText,
  modalPremium: nullableText,
  anticipatedAnnualPremium: nullableText,
  submitMethod: nullableText,
  caseManager: nullableText,
  agency: nullableText,
  writingAgentName: nullableText,
  writingAgentNumber: nullableText,
  companyCode: nullableText,
})

export const inforceClientRecordSchema = z.strictObject({
  policyNumber: normalizedText.min(1).max(128),
  nbPolicyNumber: nullableText,
  policyStatus: nullableText,
  policyIssueDate: nullableText,
  lastStatusChangeDate: nullableText,
  productClass: nullableText,
  productName: nullableText,
  productCode: nullableText,
  companyCode: nullableText,
  systemCode: nullableText,
  planCode: nullableText,
  agentNumber: nullableText,
  agentName: nullableText,
  servicingAgentName: nullableText,
  servicingAgencyName: nullableText,
  insuredClientName: nullableText,
  insuredDob: nullableText,
  insuredEmail: nullableEmail,
  insuredPhoneNumber: nullableText,
  ownerClientName: nullableText,
  ownerDob: nullableText,
  ownerEmail: nullableEmail,
  ownerPhoneNumber: nullableText,
  accumulatedCashValue: nullableText,
  anticipatedAnnualPremium: nullableText,
  termConversionDate: nullableText,
  levelPeriodEndDate: nullableText,
  employerName: nullableText,
})

const envelopeBase = {
  schemaVersion: z.literal(LEGACY_ENVELOPE_SCHEMA_VERSION),
  runId: identifier,
  sequence: z.number().int().min(0).max(10_000),
  observedAt: z.string().datetime({ offset: true }),
  recordsTotal: z.number().int().min(0).max(100_000),
  truncated: z.boolean(),
}

export const newBusinessEnvelopeSchema = z.strictObject({
  ...envelopeBase,
  gridKey: z.literal('NEW_BUSINESS'),
  records: z.array(newBusinessRecordSchema).max(LEGACY_MAX_RECORDS),
}).superRefine((envelope, context) => {
  if (envelope.recordsTotal < envelope.records.length) {
    context.addIssue({ code: 'custom', message: 'recordsTotal is smaller than records' })
  }
})

export const inforceClientsEnvelopeSchema = z.strictObject({
  ...envelopeBase,
  gridKey: z.literal('INFORCE_CLIENTS'),
  records: z.array(inforceClientRecordSchema).max(LEGACY_MAX_RECORDS),
}).superRefine((envelope, context) => {
  if (envelope.recordsTotal < envelope.records.length) {
    context.addIssue({ code: 'custom', message: 'recordsTotal is smaller than records' })
  }
})

export const localConnectorStageEnvelopeSchema = z.discriminatedUnion('gridKey', [
  newBusinessEnvelopeSchema,
  inforceClientsEnvelopeSchema,
])

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
    recordsTotal: z.number().int().min(0).max(100_000),
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
export type NewBusinessRecord = z.infer<typeof newBusinessRecordSchema>
export type InforceClientRecord = z.infer<typeof inforceClientRecordSchema>
export type LocalConnectorStageEnvelope = z.infer<typeof localConnectorStageEnvelopeSchema>
