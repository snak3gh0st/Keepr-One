import { z } from 'zod'

export const LOCAL_CONNECTOR_SCHEMA_VERSION = 1 as const
export const LOCAL_CONNECTOR_MAX_BODY_BYTES = 2 * 1024 * 1024
export const LOCAL_CONNECTOR_MAX_RECORDS = 1_000
export const LOCAL_CONNECTOR_GRID_KEYS = ['NEW_BUSINESS', 'INFORCE_CLIENTS'] as const

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
  schemaVersion: z.literal(LOCAL_CONNECTOR_SCHEMA_VERSION),
  runId: identifier,
  sequence: z.number().int().min(0).max(10_000),
  observedAt: z.string().datetime({ offset: true }),
  recordsTotal: z.number().int().min(0).max(100_000),
  truncated: z.boolean(),
}

export const newBusinessEnvelopeSchema = z.strictObject({
  ...envelopeBase,
  gridKey: z.literal('NEW_BUSINESS'),
  records: z.array(newBusinessRecordSchema).max(LOCAL_CONNECTOR_MAX_RECORDS),
}).superRefine((envelope, context) => {
  if (envelope.recordsTotal < envelope.records.length) {
    context.addIssue({ code: 'custom', message: 'recordsTotal is smaller than records' })
  }
})

export const inforceClientsEnvelopeSchema = z.strictObject({
  ...envelopeBase,
  gridKey: z.literal('INFORCE_CLIENTS'),
  records: z.array(inforceClientRecordSchema).max(LOCAL_CONNECTOR_MAX_RECORDS),
}).superRefine((envelope, context) => {
  if (envelope.recordsTotal < envelope.records.length) {
    context.addIssue({ code: 'custom', message: 'recordsTotal is smaller than records' })
  }
})

export const localConnectorStageEnvelopeSchema = z.discriminatedUnion('gridKey', [
  newBusinessEnvelopeSchema,
  inforceClientsEnvelopeSchema,
])

export type PublicP256Jwk = z.infer<typeof publicP256JwkSchema>
export type NewBusinessRecord = z.infer<typeof newBusinessRecordSchema>
export type InforceClientRecord = z.infer<typeof inforceClientRecordSchema>
export type LocalConnectorStageEnvelope = z.infer<typeof localConnectorStageEnvelopeSchema>
