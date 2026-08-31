const HASH = /^[a-f0-9]{64}$/i
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/
const PHONE = /^\+[1-9]\d{7,14}$/
const STATE = /^[A-Z]{2}$/
const POSTAL_CODE = /^\d{5}(?:-\d{4})?$/

export const IGO_TERM_PRODUCTS = [
  'LSW 10-G', 'LSW 15-G', 'LSW 20-G', 'LSW 30-G', 'LSW ART',
  'NL 10-G', 'NL 15-G', 'NL 20-G', 'NL 30-G', 'NL ART',
] as const

export const IGO_IUL_PRODUCTS = [
  '2019 PeakLife NL',
  'FlexLife (25)(LSW)',
  'RapidProtect (LSW)',
  'RapidProtect NL',
  'SummitLife (LSW)',
] as const

export const IGO_TERM_DURATIONS = ['10-G', '15-G', '20-G', '30-G', 'ART'] as const

type IgoTermProduct = (typeof IGO_TERM_PRODUCTS)[number]
type IgoIulProduct = (typeof IGO_IUL_PRODUCTS)[number]
type IgoTermDuration = (typeof IGO_TERM_DURATIONS)[number]

type IgoCoverageBase = {
  issueState: string
  applicationType: 'FULL' | 'TERM_CONVERSION'
  illustrationId: string
  illustrationInputHash: string
  faceAmount: number
  premiumMode: 'MONTHLY' | 'ANNUAL'
  plannedPremium: number
}

export type IgoApplicationCoverage =
  | IgoCoverageBase & {
    family: 'TERM'
    carrierProduct: IgoTermProduct
    termDuration: IgoTermDuration
  }
  | IgoCoverageBase & {
    family: 'IUL'
    carrierProduct: IgoIulProduct
  }

export type IgoApplicationDossierV2 = {
  version: 2
  insured: {
    firstName: string
    lastName: string
    birthDate: string
    sexAtBirth: 'MALE' | 'FEMALE'
    email: string
    phone: string
  }
  address: {
    line1: string
    line2?: string
    city: string
    state: string
    postalCode: string
  }
  owner: {
    sameAsInsured: boolean
    relationship: 'SELF' | 'SPOUSE' | 'PARENT' | 'BUSINESS' | 'OTHER'
    fullName?: string
  }
  beneficiaries: Array<{
    fullName: string
    relationship: string
    sharePercent: number
  }>
  coverage: IgoApplicationCoverage
  agent: { carrierNumber: string }
  existingCoverage: { hasExisting: boolean; replacementExpected: boolean }
  documents: Array<{
    documentId: string
    type: 'IDENTITY' | 'AUTHORIZATION' | 'FINANCIAL' | 'REPLACEMENT' | 'OTHER'
    contentHash: string
  }>
  consent: { clientAuthorizedCollection: boolean; agentAttestedAccuracy: boolean }
}

export type IgoApplicationSnapshotV2 = {
  schemaVersion: 2
  applicationId: string
  payloadHash: string
  dossier: IgoApplicationDossierV2
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

function boundedText(value: unknown, max = 120): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= max &&
    !/[<>\u0000-\u001f\u007f]/.test(value)
}

function isoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year!, month! - 1, day!))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day
}

function positiveMoney(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= maximum
}

function parseCoverage(value: unknown): IgoApplicationCoverage | null {
  if (!isObject(value)) return null
  const baseKeys = [
    'family', 'carrierProduct', 'issueState', 'applicationType', 'illustrationId',
    'illustrationInputHash', 'faceAmount', 'premiumMode', 'plannedPremium',
  ] as const
  const isTerm = value.family === 'TERM'
  if (!hasExactKeys(value, isTerm ? [...baseKeys, 'termDuration'] : baseKeys)) return null
  if (!STATE.test(String(value.issueState)) || !['FULL', 'TERM_CONVERSION'].includes(String(value.applicationType)) ||
    !IDENTIFIER.test(String(value.illustrationId)) || !HASH.test(String(value.illustrationInputHash)) ||
    !positiveMoney(value.faceAmount, 100_000_000) || !positiveMoney(value.plannedPremium, 10_000_000) ||
    !['MONTHLY', 'ANNUAL'].includes(String(value.premiumMode))) return null

  if (isTerm) {
    if (!(IGO_TERM_PRODUCTS as readonly string[]).includes(String(value.carrierProduct)) ||
      !(IGO_TERM_DURATIONS as readonly string[]).includes(String(value.termDuration)) ||
      !String(value.carrierProduct).endsWith(String(value.termDuration))) return null
    return value as IgoApplicationCoverage
  }
  if (value.family !== 'IUL' || !(IGO_IUL_PRODUCTS as readonly string[]).includes(String(value.carrierProduct))) return null
  return value as IgoApplicationCoverage
}

function parseDossier(value: unknown): IgoApplicationDossierV2 | null {
  if (!isObject(value) || !hasExactKeys(value, [
    'version', 'insured', 'address', 'owner', 'beneficiaries', 'coverage', 'agent',
    'existingCoverage', 'documents', 'consent',
  ]) || value.version !== 2) return null

  const insured = value.insured
  if (!isObject(insured) || !hasExactKeys(insured, [
    'firstName', 'lastName', 'birthDate', 'sexAtBirth', 'email', 'phone',
  ]) || !boundedText(insured.firstName, 80) || !boundedText(insured.lastName, 80) ||
    !isoDate(insured.birthDate) || !['MALE', 'FEMALE'].includes(String(insured.sexAtBirth)) ||
    typeof insured.email !== 'string' || insured.email.length > 254 || !/^\S+@\S+\.\S+$/.test(insured.email) ||
    typeof insured.phone !== 'string' || !PHONE.test(insured.phone)) return null

  const address = value.address
  if (!isObject(address) || !hasExactKeys(address, ['line1', 'city', 'state', 'postalCode'], ['line2']) ||
    !boundedText(address.line1, 160) || ('line2' in address && !boundedText(address.line2, 160)) ||
    !boundedText(address.city) || typeof address.state !== 'string' || !STATE.test(address.state) ||
    typeof address.postalCode !== 'string' || !POSTAL_CODE.test(address.postalCode)) return null

  const owner = value.owner
  if (!isObject(owner) || !hasExactKeys(owner, ['sameAsInsured', 'relationship'], ['fullName']) ||
    typeof owner.sameAsInsured !== 'boolean' ||
    !['SELF', 'SPOUSE', 'PARENT', 'BUSINESS', 'OTHER'].includes(String(owner.relationship)) ||
    (!owner.sameAsInsured && !boundedText(owner.fullName, 120)) ||
    ('fullName' in owner && !boundedText(owner.fullName, 120))) return null

  if (!Array.isArray(value.beneficiaries) || value.beneficiaries.length < 1 || value.beneficiaries.length > 10) return null
  let beneficiaryTotal = 0
  for (const beneficiary of value.beneficiaries) {
    if (!isObject(beneficiary) || !hasExactKeys(beneficiary, ['fullName', 'relationship', 'sharePercent']) ||
      !boundedText(beneficiary.fullName) || !boundedText(beneficiary.relationship) ||
      typeof beneficiary.sharePercent !== 'number' || !Number.isFinite(beneficiary.sharePercent) ||
      beneficiary.sharePercent <= 0 || beneficiary.sharePercent > 100) return null
    beneficiaryTotal += beneficiary.sharePercent
  }
  if (Math.abs(beneficiaryTotal - 100) > 0.001) return null

  const coverage = parseCoverage(value.coverage)
  const agent = value.agent
  const existingCoverage = value.existingCoverage
  const consent = value.consent
  if (!coverage || !isObject(agent) || !hasExactKeys(agent, ['carrierNumber']) ||
    !IDENTIFIER.test(String(agent.carrierNumber)) ||
    !isObject(existingCoverage) || !hasExactKeys(existingCoverage, ['hasExisting', 'replacementExpected']) ||
    typeof existingCoverage.hasExisting !== 'boolean' || typeof existingCoverage.replacementExpected !== 'boolean' ||
    !isObject(consent) || !hasExactKeys(consent, ['clientAuthorizedCollection', 'agentAttestedAccuracy']) ||
    consent.clientAuthorizedCollection !== true || consent.agentAttestedAccuracy !== true) return null

  if (!Array.isArray(value.documents) || value.documents.length > 20) return null
  for (const document of value.documents) {
    if (!isObject(document) || !hasExactKeys(document, ['documentId', 'type', 'contentHash']) ||
      !IDENTIFIER.test(String(document.documentId)) ||
      !['IDENTITY', 'AUTHORIZATION', 'FINANCIAL', 'REPLACEMENT', 'OTHER'].includes(String(document.type)) ||
      !HASH.test(String(document.contentHash))) return null
  }
  if (!value.documents.some((document) => isObject(document) && document.type === 'IDENTITY')) return null

  return value as IgoApplicationDossierV2
}

export function parseIgoApplicationSnapshot(value: unknown): IgoApplicationSnapshotV2 | null {
  if (!isObject(value) || !hasExactKeys(value, ['schemaVersion', 'applicationId', 'payloadHash', 'dossier']) ||
    value.schemaVersion !== 2 || !IDENTIFIER.test(String(value.applicationId)) || !HASH.test(String(value.payloadHash))) return null
  const dossier = parseDossier(value.dossier)
  return dossier ? {
    schemaVersion: 2,
    applicationId: value.applicationId as string,
    payloadHash: value.payloadHash as string,
    dossier,
  } : null
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export async function sha256IgoApplicationDossier(value: unknown): Promise<string> {
  const snapshot = parseIgoApplicationSnapshot(value)
  if (!snapshot) throw new Error('IGO_APPLICATION_INPUT_INVALID')
  const bytes = new TextEncoder().encode(canonicalize(snapshot.dossier))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
