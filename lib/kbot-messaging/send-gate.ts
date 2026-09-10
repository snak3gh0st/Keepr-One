/// The one place that decides whether a message may go to a person right now.
///
/// Follow-ups and scheduled messages are different features with different
/// triggers, but they reach the same phone. If each kept its own idea of "too
/// soon", a client could get a birthday greeting and a lapse warning the same
/// afternoon and neither check would have been wrong. So the recency window is
/// evaluated over jobs of *every* category, and both paths call this.
import { withinSendWindow, type QuietHoursDecision } from './quiet-hours'

/// Same window the follow-up path has always used, now shared.
export const RECENCY_WINDOW_MS = 7 * 86_400_000

export type SendGateBlockReason =
  /// The person asked not to be contacted.
  | 'OPTED_OUT'
  /// The agent silenced this subject until a date.
  | 'SNOOZED'
  /// A message of any category already went out inside the window, or the agent
  /// spoke to them by hand.
  | 'RECENT_CONTACT'
  /// It is the wrong hour where the recipient is.
  | 'QUIET_HOURS'

export type ContactPreference = {
  optedOut?: boolean
  snoozedUntil?: Date | null
  lastManualAt?: Date | null
}

export type RecentJob = {
  /// Any category counts. That is the entire point of the shared window.
  sentAt: Date
}

export type SendGateInput = {
  phone: string | null
  /// Preferences that apply to this recipient: the subject key and, when the
  /// number is known, the number itself. A stop request arrives by phone, not
  /// by client id.
  preferences: readonly ContactPreference[]
  recentJobs: readonly RecentJob[]
  now: Date
  /// Scheduled sends must respect the recipient's clock. An agent pressing send
  /// is already choosing the moment, so that path passes `false`.
  enforceQuietHours: boolean
}

export type SendGateDecision = {
  allowed: boolean
  reason: SendGateBlockReason | null
  quietHours: QuietHoursDecision | null
}

export function evaluateSendGate(input: SendGateInput): SendGateDecision {
  const { preferences, now } = input

  if (preferences.some((preference) => preference.optedOut === true)) {
    return { allowed: false, reason: 'OPTED_OUT', quietHours: null }
  }
  if (preferences.some((preference) => preference.snoozedUntil && preference.snoozedUntil > now)) {
    return { allowed: false, reason: 'SNOOZED', quietHours: null }
  }

  const cutoff = now.getTime() - RECENCY_WINDOW_MS
  const spokenRecently = preferences.some(
    (preference) => preference.lastManualAt && preference.lastManualAt.getTime() > cutoff,
  )
  const messagedRecently = input.recentJobs.some((job) => job.sentAt.getTime() > cutoff)
  if (spokenRecently || messagedRecently) {
    return { allowed: false, reason: 'RECENT_CONTACT', quietHours: null }
  }

  if (!input.enforceQuietHours) {
    return { allowed: true, reason: null, quietHours: null }
  }
  const quietHours = withinSendWindow(input.phone, now)
  return quietHours.allowed
    ? { allowed: true, reason: null, quietHours }
    : { allowed: false, reason: 'QUIET_HOURS', quietHours }
}
