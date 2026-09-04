import { z } from 'zod'

// Known limitation (deferred): this parses CSV numeric fields (premium,
// faceAmount, commission amount) into plain JS `number` rather than a
// Decimal type. That's an acceptable float-precision risk here because
// each value only goes through a single Number(string) parse — no chained
// arithmetic — and is bounded by realistic premium/face-amount ranges. The
// one place override commission math actually chains multiplication/division
// on money (lib/commission.ts' computeOverrides) was fixed to use
// decimal.js instead; rewriting this whole CSV pipeline plus every downstream
// Prisma Decimal touchpoint to be fully Decimal-based end-to-end was judged
// out of scope for this fix pass.
const numericString = z.string().transform((val, ctx) => {
  // Reject empty or whitespace-only strings
  if (val.trim() === '') {
    ctx.addIssue({ code: 'custom', message: 'o valor não pode ficar vazio' })
    return z.NEVER
  }
  const parsed = Number(val)
  // Use isFinite to reject NaN, Infinity, and -Infinity
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: 'custom', message: `"${val}" não é um número válido` })
    return z.NEVER
  }
  return parsed
})

const optionalPolicyDate = z.string().refine((value) => {
  if (value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'data deve ser uma data válida no formato AAAA-MM-DD').optional()

export const PolicyRowSchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email().optional().or(z.literal('')),
  agentNpn: z.string().min(1),
  carrier: z.string().min(1),
  product: z.string().min(1),
  policyNumber: z.string().min(1),
  faceAmount: numericString,
  premium: numericString,
  status: z.enum(['PENDING', 'APPROVED', 'INFORCE', 'LAPSED', 'CANCELLED']),
  effectiveDate: optionalPolicyDate,
  lastPaymentDate: optionalPolicyDate,
  // Optional provenance for provider-sourced imports. Absent in the existing
  // manual CSV, which stays valid; the service defaults the provider.
  sourceProvider: z.string().optional(),
  sourceExternalId: z.string().optional(),
})

export type PolicyRow = z.infer<typeof PolicyRowSchema>

// Persisted CommissionTransaction.type. Note: the plan's direction vocabulary
// (EARNING/OVERRIDE/...) is a domain concept in lib/financial-transactions.ts;
// the column stored here is the Prisma enum. A commission CSV without this
// column defaults to PAID (money actually paid) in the service.
export const COMMISSION_TRANSACTION_TYPES = ['EXPECTED', 'PAID', 'CHARGEBACK', 'ADJUSTMENT'] as const

export const CommissionRowSchema = z.object({
  policyNumber: z.string().min(1),
  agentNpn: z.string().min(1),
  amount: numericString,
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'período deve estar no formato AAAA-MM'),
  // Optional provenance for provider-sourced imports; existing CSV stays valid.
  transactionType: z.enum(COMMISSION_TRANSACTION_TYPES).optional(),
  sourceProvider: z.string().optional(),
  sourceTransactionId: z.string().optional(),
})

export type CommissionRow = z.infer<typeof CommissionRowSchema>
