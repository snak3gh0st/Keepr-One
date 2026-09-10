/// Which clients have a date today, and what the job for it is called.
///
/// Pure on purpose: no Prisma, no clock of its own. The caller hands in the
/// book and the instant, so the two questions that actually decide whether a
/// message is right — *whose* today is it, and *have we already sent this year*
/// — are answered by code a test can drive across a leap year in one line.
import { FALLBACK_ZONE, timeZoneForPhone } from './quiet-hours'

/// Categories with a date trigger. `KBotMessageTemplate.category` and
/// `KBotFollowupJob.category` carry the same strings.
export const SCHEDULED_CATEGORIES = ['BIRTHDAY', 'ANNUAL_REVIEW'] as const
export type ScheduledCategory = typeof SCHEDULED_CATEGORIES[number]

export type TriggerClient = {
  id: string
  name: string
  /// Already normalized to E.164 by the caller; null means unreachable.
  phone: string | null
  dateOfBirth: Date | null
}

export type TriggerPolicy = {
  id: string
  clientId: string
  /// The issue date. Null means the carrier never supplied one.
  effectiveDate: Date | null
}

export type ScheduledCandidate = {
  category: ScheduledCategory
  clientId: string
  customerName: string
  phone: string
  /// Deterministic for the recipient's local year. Running the engine twice on
  /// the same day yields the same key, and `@@unique([agentId, requestKey,
  /// candidateId])` turns the second write into a no-op instead of a second
  /// message. Both halves must be stable — a fresh id here would satisfy the
  /// constraint and send twice.
  requestKey: string
  candidateId: string
  /// The key preferences are stored under, same shape the manual path uses.
  subjectKey: string
  sourceHref: string
  /// The recipient's local year the key was built from, and the zone it was
  /// read in, so a report can say why a date counted as today.
  localYear: number
  timeZone: string
}

type CivilDate = { year: number; month: number; day: number }

/// The calendar date at `instant` as someone in `timeZone` would read it.
function civilDateInZone(instant: Date, timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/// 29 February, in a year that has no 29 February, is observed on 28 February.
///
/// The alternative is 1 March. Both are defensible and neither is the real day,
/// so the tie-breaker is what the message says: a birthday greeting names the
/// month it belongs to. Sent on 1 March it arrives after February is over, to
/// someone whose birthday is a February date — the greeting is late and reads
/// like the system lost track. On 28 February it is the last day of their own
/// month, which is also how most US administrative systems age a 29 February
/// date of birth. Late is worse than early for a greeting, so: 28 February.
export const LEAP_DAY_OBSERVED_ON = { month: 2, day: 28 } as const

/// Whether the month/day of `anniversary` falls on `today`.
///
/// The anniversary is read in UTC and today in the recipient's zone, and that
/// asymmetry is deliberate. A date of birth is a calendar fact stored at UTC
/// midnight — it has a month and a day and no hour worth respecting. "Today",
/// by contrast, is an instant, and which date it is depends entirely on where
/// the person reading it stands.
export function isAnniversaryToday(anniversary: Date, today: CivilDate): boolean {
  const month = anniversary.getUTCMonth() + 1
  const day = anniversary.getUTCDate()
  if (month === 2 && day === 29 && !isLeapYear(today.year)) {
    return today.month === LEAP_DAY_OBSERVED_ON.month && today.day === LEAP_DAY_OBSERVED_ON.day
  }
  return today.month === month && today.day === day
}

/// The zone a date is judged in for this recipient.
///
/// An unknown area code falls back to the same band quiet hours falls back to.
/// Being consistent matters more than being right here: if the date were read
/// in one zone and the hour in another, a message could be queued for a
/// birthday that the send window then decided was yesterday.
export function triggerZoneForPhone(phone: string | null): string {
  return timeZoneForPhone(phone) ?? FALLBACK_ZONE
}

export type ScheduledTriggerInput = {
  clients: readonly TriggerClient[]
  policies: readonly TriggerPolicy[]
  now: Date
}

/// Every candidate whose date is today, in the recipient's own zone.
///
/// Says nothing about whether a message may be sent — that is the send gate's
/// job, and the caller's. This only answers "is today the day".
export function scheduledCandidatesForDay(input: ScheduledTriggerInput): ScheduledCandidate[] {
  const clientsById = new Map(input.clients.map((client) => [client.id, client]))
  const candidates: ScheduledCandidate[] = []

  const forClient = (
    client: TriggerClient,
    anniversary: Date,
    category: ScheduledCategory,
    candidateId: string,
    sourceHref: string,
    keyPrefix: string,
    keySubject: string,
  ) => {
    // No number, no message. Not a block worth reporting: there is nowhere to
    // send it, and the manual list already surfaces a missing phone.
    if (!client.phone) return
    const timeZone = triggerZoneForPhone(client.phone)
    const today = civilDateInZone(input.now, timeZone)
    if (!isAnniversaryToday(anniversary, today)) return
    // The first anniversary is a year later, not the same day: a policy issued
    // today is not due for review, and a date of birth in the future is bad
    // data rather than a birthday.
    if (anniversary.getUTCFullYear() >= today.year) return
    candidates.push({
      category,
      clientId: client.id,
      customerName: client.name,
      phone: client.phone,
      requestKey: `${keyPrefix}:${keySubject}:${today.year}`,
      candidateId,
      subjectKey: `client:${client.id}`,
      sourceHref,
      localYear: today.year,
      timeZone,
    })
  }

  for (const client of input.clients) {
    if (!client.dateOfBirth) continue
    forClient(client, client.dateOfBirth, 'BIRTHDAY', `birthday:${client.id}`,
      `/agent/clients/${client.id}`, 'birthday', client.id)
  }

  for (const policy of input.policies) {
    if (!policy.effectiveDate) continue
    const client = clientsById.get(policy.clientId)
    if (!client) continue
    forClient(client, policy.effectiveDate, 'ANNUAL_REVIEW', `annual-review:${policy.id}`,
      `/agent/policies/${policy.id}`, 'annual-review', policy.id)
  }

  // Stable order so a pass is reproducible and a report reads the same twice.
  return candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId))
}
