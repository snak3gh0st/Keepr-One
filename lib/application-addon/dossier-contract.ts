import { createHash } from 'node:crypto'
import { z } from 'zod'

const boundedText = z.string().trim().min(1).max(120)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}, 'INVALID_DATE')

const dossierSchema = z.strictObject({
  version: z.literal(1),
  insured: z.strictObject({
    firstName: boundedText,
    lastName: boundedText,
    birthDate: isoDate,
    sexAtBirth: z.enum(['MALE', 'FEMALE']),
    email: z.email().max(254),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }),
  address: z.strictObject({
    line1: z.string().trim().min(1).max(160),
    line2: z.string().trim().max(160).optional(),
    city: boundedText,
    state: z.string().regex(/^[A-Z]{2}$/),
    postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  }),
  owner: z.strictObject({
    sameAsInsured: z.boolean(),
    relationship: z.enum(['SELF', 'SPOUSE', 'PARENT', 'BUSINESS', 'OTHER']),
    fullName: boundedText.optional(),
  }),
  beneficiaries: z.array(z.strictObject({
    fullName: boundedText,
    relationship: boundedText,
    sharePercent: z.number().finite().positive().max(100),
  })).min(1).max(10),
  coverage: z.strictObject({
    product: z.enum(['IUL', 'TERM']),
    faceAmount: z.number().finite().positive().max(100_000_000),
    premiumMode: z.enum(['MONTHLY', 'ANNUAL']),
    plannedPremium: z.number().finite().positive().max(10_000_000),
  }),
  existingCoverage: z.strictObject({
    hasExisting: z.boolean(),
    replacementExpected: z.boolean(),
  }),
  documents: z.array(z.strictObject({
    documentId: z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/),
    type: z.enum(['IDENTITY', 'AUTHORIZATION', 'FINANCIAL', 'REPLACEMENT', 'OTHER']),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  })).max(20),
  consent: z.strictObject({
    clientAuthorizedCollection: z.boolean(),
    agentAttestedAccuracy: z.boolean(),
  }),
})

export type ApplicationDossierV1 = z.infer<typeof dossierSchema>

const dossierDraftSchema = z.strictObject({
  version: z.literal(1),
  insured: dossierSchema.shape.insured.partial().optional(),
  address: dossierSchema.shape.address.partial().optional(),
  owner: dossierSchema.shape.owner.partial().optional(),
  beneficiaries: dossierSchema.shape.beneficiaries.optional(),
  coverage: dossierSchema.shape.coverage.partial().optional(),
  existingCoverage: dossierSchema.shape.existingCoverage.partial().optional(),
  documents: dossierSchema.shape.documents.optional(),
  consent: dossierSchema.shape.consent.partial().optional(),
})

export type ApplicationDossierDraftV1 = z.infer<typeof dossierDraftSchema>

export type ApplicationDossierMissingItem =
  | 'INSURED_NAME'
  | 'INSURED_BIRTH_DATE'
  | 'INSURED_SEX'
  | 'INSURED_CONTACT'
  | 'ADDRESS'
  | 'OWNER'
  | 'OWNER_NAME'
  | 'BENEFICIARIES'
  | 'BENEFICIARY_SHARES'
  | 'COVERAGE_VALUES'
  | 'EXISTING_COVERAGE'
  | 'IDENTITY_DOCUMENT'
  | 'CLIENT_AUTHORIZATION'
  | 'AGENT_ATTESTATION'

export function parseApplicationDossier(value: unknown): ApplicationDossierV1 {
  return dossierSchema.parse(value)
}

export function parseApplicationDossierDraft(value: unknown): ApplicationDossierDraftV1 {
  return dossierDraftSchema.parse(value)
}

export function applicationDossierReadiness(
  dossier: ApplicationDossierDraftV1,
): { ready: boolean; missing: ApplicationDossierMissingItem[] } {
  const missing: ApplicationDossierMissingItem[] = []
  if (!dossier.insured?.firstName || !dossier.insured.lastName) missing.push('INSURED_NAME')
  if (!dossier.insured?.birthDate) missing.push('INSURED_BIRTH_DATE')
  if (!dossier.insured?.sexAtBirth) missing.push('INSURED_SEX')
  if (!dossier.insured?.email || !dossier.insured.phone) missing.push('INSURED_CONTACT')
  if (!dossier.address?.line1 || !dossier.address.city || !dossier.address.state || !dossier.address.postalCode) {
    missing.push('ADDRESS')
  }
  if (dossier.owner?.sameAsInsured === undefined || !dossier.owner.relationship) missing.push('OWNER')
  if (dossier.owner?.sameAsInsured === false && !dossier.owner.fullName) missing.push('OWNER_NAME')
  if (!dossier.beneficiaries?.length) missing.push('BENEFICIARIES')
  const beneficiaryTotal = (dossier.beneficiaries ?? []).reduce(
    (sum, beneficiary) => sum + beneficiary.sharePercent,
    0,
  )
  if (dossier.beneficiaries?.length && Math.abs(beneficiaryTotal - 100) > 0.001) {
    missing.push('BENEFICIARY_SHARES')
  }
  if (!dossier.coverage?.product || !dossier.coverage.faceAmount || !dossier.coverage.premiumMode ||
    !dossier.coverage.plannedPremium) missing.push('COVERAGE_VALUES')
  if (dossier.existingCoverage?.hasExisting === undefined ||
    dossier.existingCoverage.replacementExpected === undefined) missing.push('EXISTING_COVERAGE')
  if (!(dossier.documents ?? []).some((document) => document.type === 'IDENTITY')) {
    missing.push('IDENTITY_DOCUMENT')
  }
  if (!dossier.consent?.clientAuthorizedCollection) missing.push('CLIENT_AUTHORIZATION')
  if (!dossier.consent?.agentAttestedAccuracy) missing.push('AGENT_ATTESTATION')
  return { ready: missing.length === 0, missing }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sha256ApplicationDossier(dossier: ApplicationDossierV1): string {
  return createHash('sha256').update(canonicalJson(dossier)).digest('hex')
}
