/**
 * The nurture sequence that accompanies the discount offer.
 *
 * Steps are addressed by a stable key rather than by position, so inserting a
 * step later never re-sends an earlier one to an account that already received
 * it. Each step names the number of days remaining at which it becomes due:
 * the sequence walks *down* to the end of access, and the final step is sent
 * after access has lapsed.
 */
export type RetentionEmailStepKey =
  | 'TRIAL_ENDING_7D'
  | 'TRIAL_ENDING_3D'
  | 'TRIAL_ENDING_1D'
  | 'ACCESS_LAPSED'

export type RetentionEmailStep = {
  key: RetentionEmailStepKey
  /** Sent once remaining days are at or below this. Negative means past due. */
  dueAtRemainingDays: number
}

export const RETENTION_EMAIL_SEQUENCE: readonly RetentionEmailStep[] = [
  { key: 'TRIAL_ENDING_7D', dueAtRemainingDays: 7 },
  { key: 'TRIAL_ENDING_3D', dueAtRemainingDays: 3 },
  { key: 'TRIAL_ENDING_1D', dueAtRemainingDays: 1 },
  { key: 'ACCESS_LAPSED', dueAtRemainingDays: -1 },
]

const DAY_MS = 86_400_000

/**
 * How long the lapsed-access reminder keeps repeating.
 *
 * "Keep emailing until they subscribe" cannot mean forever: an address that
 * never converts must eventually be left alone, both to respect the person and
 * to protect the sending domain's reputation.
 */
export const LAPSED_REMINDER_INTERVAL_DAYS = 7
export const LAPSED_REMINDER_MAX_SENDS = 4

export type RetentionEmailDecision =
  | { send: true; step: RetentionEmailStepKey; sequenceNumber: number }
  | { send: false; reason: RetentionEmailSkipReason }

export type RetentionEmailSkipReason =
  | 'ALREADY_SUBSCRIBED'
  | 'OPTED_OUT'
  | 'NOTHING_DUE'
  | 'ALREADY_SENT'
  | 'SEQUENCE_EXHAUSTED'

export type RetentionEmailState = {
  /** Sequence keys already delivered to this subscription. */
  sentKeys: readonly RetentionEmailStepKey[]
  /** When the most recent message in the sequence went out. */
  lastSentAt: Date | null
  /** How many lapsed reminders have already been sent. */
  lapsedSends: number
  optedOut: boolean
  /** True once the account is paying and not scheduled to cancel. */
  subscribed: boolean
  accessEndsAt: Date | null
}

function remainingDays(accessEndsAt: Date, now: Date): number {
  return Math.floor((accessEndsAt.getTime() - now.getTime()) / DAY_MS)
}

/**
 * Decides the single next message due for an account, or why none is.
 *
 * Only one message is ever returned per pass. If a cron run is missed and two
 * steps come due at once, the later step is the one sent — telling somebody
 * their trial ends in seven days when it ends tomorrow is worse than skipping.
 */
export function decideRetentionEmail(
  state: RetentionEmailState,
  now = new Date(),
): RetentionEmailDecision {
  if (state.subscribed) return { send: false, reason: 'ALREADY_SUBSCRIBED' }
  if (state.optedOut) return { send: false, reason: 'OPTED_OUT' }
  if (!state.accessEndsAt) return { send: false, reason: 'NOTHING_DUE' }

  const remaining = remainingDays(state.accessEndsAt, now)
  const sent = new Set(state.sentKeys)

  if (remaining < 0) {
    if (state.lapsedSends >= LAPSED_REMINDER_MAX_SENDS) {
      return { send: false, reason: 'SEQUENCE_EXHAUSTED' }
    }
    if (state.lastSentAt) {
      const sinceLast = now.getTime() - state.lastSentAt.getTime()
      if (sinceLast < LAPSED_REMINDER_INTERVAL_DAYS * DAY_MS) {
        return { send: false, reason: 'NOTHING_DUE' }
      }
    }
    return {
      send: true,
      step: 'ACCESS_LAPSED',
      sequenceNumber: state.lapsedSends + 1,
    }
  }

  // Walk from the most urgent due step backwards, so a missed pass never sends
  // a stale, less urgent message.
  const due = RETENTION_EMAIL_SEQUENCE
    .filter((step) => step.dueAtRemainingDays >= 0 && remaining <= step.dueAtRemainingDays)
    .sort((a, b) => a.dueAtRemainingDays - b.dueAtRemainingDays)[0]

  if (!due) return { send: false, reason: 'NOTHING_DUE' }
  if (sent.has(due.key)) return { send: false, reason: 'ALREADY_SENT' }

  return { send: true, step: due.key, sequenceNumber: 1 }
}
