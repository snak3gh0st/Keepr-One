import { createHash } from 'node:crypto'
import { phoneIssue, type PhoneIssue } from './contact-quality'

export const REASONS = ['LAPSED', 'LAPSE_WARNING', 'PAYMENT', 'REQUIREMENT'] as const
export type FollowupReason = typeof REASONS[number]
export type Candidate = {
  id: string; subjectKey: string; customerName: string; phone: string | null
  reason: FollowupReason; sourceHref: string; sourceAt: string; fingerprint: string
  blockedReason: string | null
  contactHref?: string; contactPhone?: string | null; phoneIssue?: PhoneIssue | null
}
export const ACTIVE_JOB_STATES = ['PENDING', 'PREPARING', 'CANCEL_REQUESTED', 'DISPATCHING', 'ACCEPTED', 'UNKNOWN']
export const SENT_JOB_STATES = ['SENT', 'DELIVERED', 'READ']
export const COOLDOWN_MS = 7 * 86_400_000
// Ledger stores integer tokens; display uses 100 tokens per credit.
// Fixed prompt measured at <=124 input tokens; output capped at 32 (192 includes margin).
export const TOKEN_RESERVATION = 192

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value || phoneIssue(value) !== null) return null
  return '+' + value.replace(/\D/g, '')
}

export function fingerprint(value: object): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function reasonFromStatus(status: string, sourceStatus: string | null): FollowupReason | null {
  if (status === 'LAPSED') return 'LAPSED'
  if (/^pending[ _-]lapse(?: warning)?$/i.test(sourceStatus?.trim() ?? '')) return 'LAPSE_WARNING'
  return null
}

export function availableCredits(grants: Array<{ allowance: number; reserved: number; spent: number }>) {
  return grants.reduce((total, grant) => total + Math.max(0, grant.allowance - grant.reserved - grant.spent), 0)
}

export function positiveInteger(raw: string | undefined, fallback: number, max = 100_000) {
  const n = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error('FOLLOWUP_CONFIGURATION_INVALID')
  return n
}

export function featureEnabled() { return process.env.KBOT_FOLLOWUP_ENABLED === 'true' }
export function aiEnabled() {
  return featureEnabled() && process.env.KBOT_FOLLOWUP_AI_ENABLED === 'true' && !!process.env.OPENAI_API_KEY
}

export class FollowupError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
