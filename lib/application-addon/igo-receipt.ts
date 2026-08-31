import { z } from 'zod'

const hash = z.string().regex(/^[a-f0-9]{64}$/i)
const identifier = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/)

const missingQuestion = z.strictObject({
  section: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  allowedValues: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
})

const draftReceipt = z.strictObject({
  applicationId: identifier,
  payloadHash: hash,
  draftReadBackHash: hash,
  externalApplicationId: identifier,
  carrierStatus: z.string().trim().min(1).max(120),
  confirmedValues: z.strictObject({
    insuredName: z.string().trim().min(1).max(240),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    product: z.enum(['IUL', 'TERM']),
    faceAmount: z.number().finite().positive().max(100_000_000),
    plannedPremium: z.number().finite().positive().max(10_000_000),
    premiumMode: z.enum(['MONTHLY', 'ANNUAL']),
  }),
  changes: z.array(z.strictObject({
    field: z.string().trim().min(1).max(120),
    requested: z.string().trim().max(240),
    carrier: z.string().trim().max(240),
  })).max(50),
  missingQuestions: z.array(missingQuestion).max(100),
})

export type IgoApplicationDraftReceipt = z.infer<typeof draftReceipt>

export function parseIgoApplicationDraftReceipt(value: unknown): IgoApplicationDraftReceipt | null {
  const parsed = draftReceipt.safeParse(value)
  return parsed.success ? parsed.data : null
}
