import { z } from 'zod'
import { IGO_IUL_PRODUCTS, IGO_TERM_DURATIONS, IGO_TERM_PRODUCTS } from './dossier-contract'

const hash = z.string().regex(/^[a-f0-9]{64}$/i)
const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/)

const missingQuestion = z.strictObject({
  section: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  allowedValues: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
})

const confirmedValues = z.strictObject({
  insuredName: z.string().trim().min(1).max(240),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  family: z.enum(['IUL', 'TERM']),
  carrierProduct: z.enum([...IGO_TERM_PRODUCTS, ...IGO_IUL_PRODUCTS]),
  termDuration: z.union([z.enum(IGO_TERM_DURATIONS), z.null()]),
  issueState: z.string().regex(/^[A-Z]{2}$/),
  applicationType: z.enum(['FULL', 'TERM_CONVERSION']).optional(),
  agentNumber: identifier.optional(),
  illustrationId: identifier.optional(),
  faceAmount: z.number().finite().positive().max(100_000_000).optional(),
  plannedPremium: z.number().finite().positive().max(10_000_000).optional(),
  premiumMode: z.enum(['MONTHLY', 'ANNUAL']).optional(),
}).superRefine((confirmed, context) => {
  if (confirmed.family === 'TERM') {
    if (!(IGO_TERM_PRODUCTS as readonly string[]).includes(confirmed.carrierProduct) ||
      !confirmed.termDuration || !confirmed.carrierProduct.endsWith(confirmed.termDuration)) {
      context.addIssue({ code: 'custom', path: ['termDuration'], message: 'TERM_PRODUCT_DURATION_MISMATCH' })
    }
    return
  }
  if (!(IGO_IUL_PRODUCTS as readonly string[]).includes(confirmed.carrierProduct) || confirmed.termDuration !== null) {
    context.addIssue({ code: 'custom', path: ['carrierProduct'], message: 'IUL_PRODUCT_MISMATCH' })
  }
})

const draftReceipt = z.strictObject({
  schemaVersion: z.literal(2),
  applicationId: identifier,
  payloadHash: hash,
  draftReadBackHash: hash,
  externalApplicationId: identifier,
  carrierStatus: z.string().trim().min(1).max(120),
  progress: z.enum(['CASE_CREATED', 'APPLICATION_PARTIAL', 'DRAFT_READY']),
  confirmedValues,
  changes: z.array(z.strictObject({
    field: z.string().trim().min(1).max(120),
    requested: z.string().trim().max(240),
    carrier: z.string().trim().max(240),
  })).max(50),
  missingQuestions: z.array(missingQuestion).max(100),
}).superRefine((receipt, context) => {
  if (receipt.progress === 'DRAFT_READY') {
    const required = [
      'applicationType', 'agentNumber', 'illustrationId', 'faceAmount', 'plannedPremium', 'premiumMode',
    ] as const
    for (const field of required) {
      if (receipt.confirmedValues[field] === undefined) {
        context.addIssue({ code: 'custom', path: ['confirmedValues', field], message: 'DRAFT_READBACK_INCOMPLETE' })
      }
    }
    if (receipt.missingQuestions.length) {
      context.addIssue({ code: 'custom', path: ['missingQuestions'], message: 'DRAFT_READY_WITH_MISSING_QUESTIONS' })
    }
  } else if (!receipt.missingQuestions.length) {
    context.addIssue({ code: 'custom', path: ['missingQuestions'], message: 'PARTIAL_DRAFT_WITHOUT_QUESTIONS' })
  }
})

export type IgoApplicationDraftReceipt = z.infer<typeof draftReceipt>

export function parseIgoApplicationDraftReceipt(value: unknown): IgoApplicationDraftReceipt | null {
  const parsed = draftReceipt.safeParse(value)
  return parsed.success ? parsed.data : null
}
