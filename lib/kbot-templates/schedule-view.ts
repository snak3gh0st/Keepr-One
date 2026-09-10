import type { SendGateBlockReason } from '@/lib/kbot-messaging/send-gate'

/// How the messaging area reads `KBotFollowupJob` rows of a scheduled category.
///
/// The engine that creates and dispatches these rows is being written
/// separately. This module is the contract between the two: a row the gate
/// refused is written with `status: 'BLOCKED'` and `errorCode` set to the
/// gate's own reason. Both columns already exist and are free-text, so nothing
/// here needs a migration — and the reason union is imported from the gate
/// rather than retyped, so the screen cannot drift from the rule.
export const SCHEDULED_BLOCKED_STATUS = 'BLOCKED'
/// The same string as `AWAITING_APPROVAL` in `lib/kbot-followup/domain.ts`,
/// repeated rather than imported: that module reaches for `node:crypto` and
/// this one is read by the client bundle. The test pins the two together.
export const AWAITING_APPROVAL_STATUS = 'AWAITING_APPROVAL'

/// Waiting for its moment, or already in the worker's hands.
const SCHEDULED_STATUSES = ['PENDING', 'PREPARING', 'DISPATCHING', 'CANCEL_REQUESTED']
/// Handed to the provider or confirmed by it. `ACCEPTED` counts as sent: the
/// message left, only the receipt is still open.
const SENT_STATUSES = ['ACCEPTED', 'SENT', 'DELIVERED', 'READ']

const BLOCK_REASONS: readonly SendGateBlockReason[] = ['OPTED_OUT', 'SNOOZED', 'RECENT_CONTACT', 'QUIET_HOURS']

export type ScheduledJobRow = {
  id: string
  category: string
  customerName: string
  phone: string
  language: string
  status: string
  errorCode: string | null
  content: string | null
  createdAt: Date
  updatedAt: Date
}

/// `ATTENTION` is everything that neither went out nor was deliberately held
/// back — a provider failure, an unconfirmed send, a cancellation. It is kept
/// apart from `BLOCKED` on purpose: "we chose not to message this person" and
/// "we tried and something broke" are different answers to the agent's
/// question, and merging them hides both.
///
/// `AWAITING_APPROVAL` is named here even though the deliveries query excludes
/// it: those proposals live in the approval queue at the top of the screen, and
/// without a case of their own they would fall through to `ATTENTION` — a
/// message waiting for the agent, filed as a message that went wrong.
export type ScheduledBucket = 'AWAITING_APPROVAL' | 'SCHEDULED' | 'SENT' | 'BLOCKED' | 'ATTENTION'

export type ScheduledEntry = {
  id: string
  category: string
  customerName: string
  phone: string
  language: string
  status: string
  bucket: ScheduledBucket
  /// Only set for `BLOCKED`, and only when the code is one the gate produces.
  blockedReason: SendGateBlockReason | null
  content: string | null
  createdAt: string
  updatedAt: string
}

export function bucketForJob(row: Pick<ScheduledJobRow, 'status'>): ScheduledBucket {
  if (row.status === AWAITING_APPROVAL_STATUS) return 'AWAITING_APPROVAL'
  if (row.status === SCHEDULED_BLOCKED_STATUS) return 'BLOCKED'
  if (SCHEDULED_STATUSES.includes(row.status)) return 'SCHEDULED'
  if (SENT_STATUSES.includes(row.status)) return 'SENT'
  return 'ATTENTION'
}

/// An unrecognised code becomes `null` rather than being shown raw: a screen
/// whose whole value is the explanation should not print an internal string it
/// cannot explain.
export function blockedReasonForJob(row: Pick<ScheduledJobRow, 'status' | 'errorCode'>): SendGateBlockReason | null {
  if (row.status !== SCHEDULED_BLOCKED_STATUS) return null
  const code = row.errorCode as SendGateBlockReason | null
  return code && BLOCK_REASONS.includes(code) ? code : null
}

export function toScheduledEntry(row: ScheduledJobRow): ScheduledEntry {
  return {
    id: row.id,
    category: row.category,
    customerName: row.customerName,
    phone: row.phone,
    language: row.language,
    status: row.status,
    bucket: bucketForJob(row),
    blockedReason: blockedReasonForJob(row),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/// How many contacts each block reason accounts for, most frequent first. This
/// is the line the agent reads before anything else: it turns "nobody got the
/// birthday message" into "eleven people asked to stop".
export function blockedReasonTotals(entries: readonly ScheduledEntry[]): Array<{ reason: SendGateBlockReason; total: number }> {
  return BLOCK_REASONS
    .map((reason) => ({ reason, total: entries.filter((entry) => entry.blockedReason === reason).length }))
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
}
