/// The carrier's own record of every time a client touched it: payment
/// failures, lapse letters, surrender requests, birthdays coming up.
///
/// This grid is the only place the integration gets an email or a phone number
/// — the inforce book returns those columns null for all 9,614 policies, across
/// every status and product class. It is also the only place that says a client
/// is trying to leave.
import type { Prisma } from '@prisma/client'

export type ClientServiceSignal = 'AT_RISK' | 'OPPORTUNITY' | 'ROUTINE'

export type ClientServiceEvent = {
  id: string
  policyNumber: string | null
  customerName: string | null
  email: string | null
  phone: string | null
  /// The carrier's own bucket: Payments, Client Service, Life Event,
  /// Conservation, Disbursements, New Business.
  category: string | null
  /// The carrier's own reason, verbatim.
  reason: string | null
  occurredAt: Date | null
  agentName: string | null
  description: string | null
  signal: ClientServiceSignal
}

export type ClientActionItem = {
  policyNumber: string
  customerName: string | null
  email: string | null
  phone: string | null
  category: string | null
  reason: string | null
  description: string | null
  occurredAt: Date
  signal: Exclude<ClientServiceSignal, 'ROUTINE'>
  eventCount: number
}

/// Reasons that mean the money stopped or the policy is on its way out.
///
/// This is our reading, not the carrier's. The carrier files most of these
/// under `Payments`, which is true and useless — a drafted payment and a failed
/// one are both payments. Naming them here means the list is arguable and
/// visible, instead of a regex buried in a component.
const AT_RISK_REASONS = new Set([
  'EftFailure',
  'Lapse Letter',
  'Pending Lapse Warning',
  'Surrender Request',
  'Surrender Inquiry',
  'Deleted auto payment',
  'Client goes off monthly EFT in year 1',
  'Planned Premium Overdue (Life - IUL/UL)',
  'Reinstatement Quote and Forms',
])

/// Reasons that are a reason to call, rather than a problem to fix.
const OPPORTUNITY_REASONS = new Set([
  'Client Birthday Coming up in next 7 days',
  'Policy Anniversary',
])

export function classifySignal(
  reason: string | null,
  category: string | null,
): ClientServiceSignal {
  if (reason && AT_RISK_REASONS.has(reason)) return 'AT_RISK'
  // The carrier files a conversation about keeping the policy under
  // Conservation whatever the reason line says, so it counts even when the
  // reason is one we have never seen.
  if (category === 'Conservation') return 'AT_RISK'
  if (reason && OPPORTUNITY_REASONS.has(reason)) return 'OPPORTUNITY'
  return 'ROUTINE'
}

/// Several of these arrive as rendered markup — an anchor around the policy
/// number, a styled div around the category — so the text has to be pulled out
/// rather than printed.
export function stripMarkup(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : text
}

function parseCarrierDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null

  // `CaseDate` is ISO with no zone; `CreatedDate` is MM/DD/YYYY.
  const slashed = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slashed) {
    const [, month, day, year] = slashed
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function emailOrNull(value: unknown): string | null {
  const text = stripMarkup(value)
  return text && text.includes('@') ? text : null
}

function phoneOrNull(value: unknown): string | null {
  const text = stripMarkup(value)
  if (!text) return null
  // Keep the carrier's own formatting; only reject something with no digits at
  // all, which is how this grid spells "we do not have one".
  return /\d/.test(text) ? text : null
}

export function toClientServiceEvent(row: {
  id: string
  raw: Prisma.JsonValue | null
}): ClientServiceEvent {
  const raw = (row.raw ?? {}) as Record<string, unknown>

  const category = stripMarkup(raw.Category)
  const reason = stripMarkup(raw.CallReason)

  return {
    id: row.id,
    policyNumber: stripMarkup(raw.PolicyNumber),
    customerName: stripMarkup(raw.CustomerName),
    email: emailOrNull(raw.EmailAddress),
    phone: phoneOrNull(raw.PhoneNumber),
    category,
    reason,
    occurredAt: parseCarrierDate(raw.CaseDate) ?? parseCarrierDate(raw.CreatedDate),
    agentName: stripMarkup(raw.AgentName),
    description: stripMarkup(raw.Description),
    signal: classifySignal(reason, category),
  }
}

export function toClientServiceEvents(
  rows: Array<{ id: string; raw: Prisma.JsonValue | null }>,
): ClientServiceEvent[] {
  return rows
    .map(toClientServiceEvent)
    .sort((left, right) => {
      // Undated events sort last rather than to 1970, which would put them at
      // the top of a descending list and read as the most recent thing to
      // happen to the client.
      if (!left.occurredAt) return 1
      if (!right.occurredAt) return -1
      return right.occurredAt.getTime() - left.occurredAt.getTime()
    })
}

const SIGNAL_PRIORITY: Record<ClientServiceSignal, number> = {
  AT_RISK: 2,
  OPPORTUNITY: 1,
  ROUTINE: 0,
}

/// Builds the operational call list from the carrier's contact history.
///
/// The queue is intentionally one row per policy. A client can generate several
/// portal events in a month, but the agent needs one next action, with the most
/// urgent recent signal and the best contact details available in that period.
export function buildClientActionQueue(
  events: ClientServiceEvent[],
  options: { asOf: Date; windowDays?: number },
): ClientActionItem[] {
  const windowDays = options.windowDays ?? 30
  const windowStart = new Date(options.asOf.getTime() - windowDays * 24 * 60 * 60_000)
  const grouped = new Map<string, ClientServiceEvent[]>()

  for (const event of events) {
    if (
      !event.policyNumber ||
      !event.occurredAt ||
      event.signal === 'ROUTINE' ||
      event.occurredAt < windowStart ||
      event.occurredAt > options.asOf
    ) {
      continue
    }
    const existing = grouped.get(event.policyNumber) ?? []
    existing.push(event)
    grouped.set(event.policyNumber, existing)
  }

  return [...grouped.entries()]
    .map(([policyNumber, policyEvents]) => {
      const ordered = [...policyEvents].sort((left, right) => {
        const priority = SIGNAL_PRIORITY[right.signal] - SIGNAL_PRIORITY[left.signal]
        if (priority !== 0) return priority
        return right.occurredAt!.getTime() - left.occurredAt!.getTime()
      })
      const selected = ordered[0]!
      const byRecency = [...policyEvents].sort(
        (left, right) => right.occurredAt!.getTime() - left.occurredAt!.getTime(),
      )
      const contact = byRecency.find((event) => event.email || event.phone)
      const named = byRecency.find((event) => event.customerName)

      return {
        policyNumber,
        customerName: selected.customerName ?? named?.customerName ?? null,
        email: selected.email ?? contact?.email ?? null,
        phone: selected.phone ?? contact?.phone ?? null,
        category: selected.category,
        reason: selected.reason,
        description: selected.description,
        occurredAt: selected.occurredAt!,
        signal: selected.signal as ClientActionItem['signal'],
        eventCount: policyEvents.length,
      }
    })
    .sort((left, right) => {
      const priority = SIGNAL_PRIORITY[right.signal] - SIGNAL_PRIORITY[left.signal]
      if (priority !== 0) return priority
      return right.occurredAt.getTime() - left.occurredAt.getTime()
    })
}
