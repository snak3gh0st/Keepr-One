import {
  IGO_IUL_PRODUCTS,
  IGO_TERM_DURATIONS,
  IGO_TERM_PRODUCTS,
  parseIgoApplicationSnapshot,
  type IgoApplicationSnapshotV2,
} from './igo-contract'

const HASH = /^[a-f0-9]{64}$/
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,200}$/

export type ExecuteIgoApplicationDraftMessage = {
  type: 'EXECUTE_IGO_APPLICATION_DRAFT'
  token: string
  correlationId: string
  payloadHash: string
  snapshot: IgoApplicationSnapshotV2
}

export type IgoMissingQuestion = {
  section: string
  label: string
  allowedValues?: string[]
}

export type IgoConfirmedValues = {
  insuredName: string
  birthDate: string
  family: 'IUL' | 'TERM'
  carrierProduct: (typeof IGO_TERM_PRODUCTS)[number] | (typeof IGO_IUL_PRODUCTS)[number]
  termDuration: (typeof IGO_TERM_DURATIONS)[number] | null
  issueState: string
  applicationType?: 'FULL' | 'TERM_CONVERSION'
  agentNumber?: string
  illustrationId?: string
  faceAmount?: number
  plannedPremium?: number
  premiumMode?: 'MONTHLY' | 'ANNUAL'
}

export type IgoApplicationDraftReceiptV2 = {
  schemaVersion: 2
  applicationId: string
  payloadHash: string
  draftReadBackHash: string
  externalApplicationId: string
  carrierStatus: string
  progress: 'CASE_CREATED' | 'APPLICATION_PARTIAL' | 'DRAFT_READY'
  confirmedValues: IgoConfirmedValues
  changes: Array<{ field: string; requested: string; carrier: string }>
  missingQuestions: IgoMissingQuestion[]
}

export type IgoApplicationDraftResponse =
  | {
      ok: true
      type: 'IGO_APPLICATION_DRAFT_SAVED'
      token: string
      correlationId: string
      receipt: IgoApplicationDraftReceiptV2
    }
  | {
      ok: false
      type: 'IGO_APPLICATION_DRAFT_FAILED'
      token: string
      correlationId: string
      code: string
    }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
}

function boundedText(value: unknown, max = 240): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= max &&
    !/[<>\u0000-\u001f\u007f]/.test(value)
}

function positiveAmount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
}

function parseConfirmedValues(value: unknown): IgoConfirmedValues | null {
  if (!isObject(value) || !exactKeys(value, [
    'insuredName', 'birthDate', 'family', 'carrierProduct', 'termDuration', 'issueState',
  ], [
    'applicationType', 'agentNumber', 'illustrationId', 'faceAmount', 'plannedPremium', 'premiumMode',
  ])) return null
  if (!boundedText(value.insuredName) || typeof value.birthDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate) || !['TERM', 'IUL'].includes(String(value.family)) ||
    typeof value.issueState !== 'string' || !/^[A-Z]{2}$/.test(value.issueState)) return null
  if ('applicationType' in value && !['FULL', 'TERM_CONVERSION'].includes(String(value.applicationType))) return null
  if ('agentNumber' in value && (typeof value.agentNumber !== 'string' || !IDENTIFIER.test(value.agentNumber))) return null
  if ('illustrationId' in value && (typeof value.illustrationId !== 'string' || !IDENTIFIER.test(value.illustrationId))) return null
  if ('faceAmount' in value && !positiveAmount(value.faceAmount, 100_000_000)) return null
  if ('plannedPremium' in value && !positiveAmount(value.plannedPremium, 10_000_000)) return null
  if ('premiumMode' in value && !['MONTHLY', 'ANNUAL'].includes(String(value.premiumMode))) return null
  if (value.family === 'TERM') {
    if (!(IGO_TERM_PRODUCTS as readonly unknown[]).includes(value.carrierProduct) ||
      !(IGO_TERM_DURATIONS as readonly unknown[]).includes(value.termDuration) ||
      !String(value.carrierProduct).endsWith(String(value.termDuration))) return null
  } else if (!(IGO_IUL_PRODUCTS as readonly unknown[]).includes(value.carrierProduct) || value.termDuration !== null) {
    return null
  }
  return value as IgoConfirmedValues
}

function parseMissingQuestions(value: unknown): IgoMissingQuestion[] | null {
  if (!Array.isArray(value) || value.length > 100) return null
  const questions: IgoMissingQuestion[] = []
  for (const item of value) {
    if (!isObject(item) || !exactKeys(item, ['section', 'label'], ['allowedValues']) ||
      !boundedText(item.section, 120) || !boundedText(item.label, 240)) return null
    if ('allowedValues' in item && (!Array.isArray(item.allowedValues) || item.allowedValues.length > 50 ||
      item.allowedValues.some((option) => !boundedText(option, 160)))) return null
    questions.push(item as IgoMissingQuestion)
  }
  return questions
}

function parseReceipt(value: unknown): IgoApplicationDraftReceiptV2 | null {
  if (!isObject(value) || !exactKeys(value, [
    'schemaVersion', 'applicationId', 'payloadHash', 'draftReadBackHash', 'externalApplicationId',
    'carrierStatus', 'progress', 'confirmedValues', 'changes', 'missingQuestions',
  ]) || value.schemaVersion !== 2 || typeof value.applicationId !== 'string' ||
    !IDENTIFIER.test(value.applicationId) || typeof value.payloadHash !== 'string' || !HASH.test(value.payloadHash) ||
    typeof value.draftReadBackHash !== 'string' || !HASH.test(value.draftReadBackHash) ||
    typeof value.externalApplicationId !== 'string' || !IDENTIFIER.test(value.externalApplicationId) ||
    !boundedText(value.carrierStatus, 120) ||
    !['CASE_CREATED', 'APPLICATION_PARTIAL', 'DRAFT_READY'].includes(String(value.progress))) return null
  const confirmedValues = parseConfirmedValues(value.confirmedValues)
  const missingQuestions = parseMissingQuestions(value.missingQuestions)
  if (!confirmedValues || !missingQuestions || !Array.isArray(value.changes) || value.changes.length > 50) return null
  const changes: IgoApplicationDraftReceiptV2['changes'] = []
  for (const item of value.changes) {
    if (!isObject(item) || !exactKeys(item, ['field', 'requested', 'carrier']) ||
      !boundedText(item.field, 120) || typeof item.requested !== 'string' || item.requested.length > 240 ||
      typeof item.carrier !== 'string' || item.carrier.length > 240) return null
    changes.push(item as IgoApplicationDraftReceiptV2['changes'][number])
  }
  if (value.progress === 'DRAFT_READY') {
    const complete = confirmedValues.applicationType && confirmedValues.agentNumber && confirmedValues.illustrationId &&
      confirmedValues.faceAmount && confirmedValues.plannedPremium && confirmedValues.premiumMode
    if (!complete || missingQuestions.length) return null
  } else if (!missingQuestions.length) return null
  return { ...value, confirmedValues, changes, missingQuestions } as IgoApplicationDraftReceiptV2
}

export function parseExecuteIgoApplicationDraftMessage(value: unknown): ExecuteIgoApplicationDraftMessage | null {
  if (!isObject(value) || !exactKeys(value, [
    'type', 'token', 'correlationId', 'payloadHash', 'snapshot',
  ]) || value.type !== 'EXECUTE_IGO_APPLICATION_DRAFT' || typeof value.token !== 'string' ||
    value.token.length < 32 || value.token.length > 128 || typeof value.correlationId !== 'string' ||
    value.correlationId.length < 16 || value.correlationId.length > 128 ||
    typeof value.payloadHash !== 'string' || !HASH.test(value.payloadHash)) return null
  const snapshot = parseIgoApplicationSnapshot(value.snapshot)
  if (!snapshot || snapshot.payloadHash !== value.payloadHash) return null
  return { type: value.type, token: value.token, correlationId: value.correlationId, payloadHash: value.payloadHash, snapshot }
}

export function parseIgoApplicationDraftResponse(
  value: unknown,
  expected: Pick<ExecuteIgoApplicationDraftMessage, 'token' | 'correlationId' | 'payloadHash'>,
): IgoApplicationDraftResponse {
  if (!isObject(value) || value.token !== expected.token || value.correlationId !== expected.correlationId) {
    throw new Error('IGO_RESPONSE_INVALID')
  }
  if (value.ok === false && value.type === 'IGO_APPLICATION_DRAFT_FAILED' &&
    exactKeys(value, ['ok', 'type', 'token', 'correlationId', 'code']) &&
    typeof value.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(value.code)) {
    return value as IgoApplicationDraftResponse
  }
  const receipt = parseReceipt(value.receipt)
  if (value.ok !== true || value.type !== 'IGO_APPLICATION_DRAFT_SAVED' ||
    !exactKeys(value, ['ok', 'type', 'token', 'correlationId', 'receipt']) ||
    !receipt || receipt.payloadHash !== expected.payloadHash) throw new Error('IGO_RESPONSE_INVALID')
  return { ok: true, type: value.type, token: value.token as string, correlationId: value.correlationId as string, receipt }
}
