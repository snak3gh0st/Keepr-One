/// A second contact source, from the grid the integration already stores.
///
/// The in-force book returns `EmailAddress` and `PhoneNumber` null for every
/// policy, so the portfolio ingest can only ever create a client with no way to
/// reach them: 1,591 of 9,406 clients carry a phone today. The client
/// intelligence grid does carry both columns, on 2,534 rows that name a policy
/// number — enough to reach 2,147 clients, 807 of whom have no phone at all.
///
/// It is a service log, not a customer record. Every safeguard below exists
/// because of that difference: the row describes a call about a policy, and the
/// number on it is whatever number that call involved.
import type { ClientServiceEvent } from './client-intelligence'
import { normalizeCarrierPolicyNumber } from './policy-number'
import type { PlannedClientContact } from './portfolio-plan'

export type ContactBackfillClient = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

/// The join key. `clientId` is the only thing that ties a service row to a
/// person: names are never matched here, only checked (see `clientNamesAgree`).
export type ContactBackfillPolicy = {
  policyNumber: string
  clientId: string
}

export type ClientContactBackfillPlan = {
  contacts: PlannedClientContact[]
  /// Why rows did not become writes. Counters rather than rows: this runs at the
  /// end of a sync and the interesting number is whether a safeguard is firing
  /// at all, not which row tripped it.
  skipped: {
    unmatchedPolicy: number
    nameMismatch: number
    agentOwnPhone: number
  }
}

/// Suffixes that decorate a legal name without changing who it belongs to.
/// Stripped only from the end, so a middle initial `V.` survives.
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv'])

function nameTokens(value: string): string[] {
  const tokens = value
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token !== '')
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop()
  return tokens
}

/// Decides whether the name on the service row and the name on the CRM record
/// are the same person.
///
/// 87% of the joined rows agree verbatim. The real divergences are a dropped
/// middle name (`ELIZA YAMANAKA` / `Eliza Saeko Yamanaka`) and a suffix the CRM
/// never recorded (`ANTONIO FONTES BARROS JR` / `Antonio Fontes Barros`), so the
/// rule is: same first name, and either the same last name or one name entirely
/// contained in the other.
///
/// Deliberately stricter than "no surname in common": it declines `JOHN SMITH`
/// against `John Jones` even though the policy join says they are one person,
/// because a wrong phone here is a message sent to a stranger. It also declines
/// a nickname the CRM spells out (`BOB SMITH` / `Robert Smith`), which is the
/// cost of not guessing.
export function clientNamesAgree(carrierName: string | null, clientName: string): boolean {
  if (!carrierName) return false

  const carrier = nameTokens(carrierName)
  const client = nameTokens(clientName)
  if (carrier.length === 0 || client.length === 0) return false
  if (carrier[0] !== client[0]) return false
  if (carrier[carrier.length - 1] === client[client.length - 1]) return true

  const carrierSet = new Set(carrier)
  const clientSet = new Set(client)
  return carrier.every((token) => clientSet.has(token))
    || client.every((token) => carrierSet.has(token))
}

export function phoneDigits(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  return digits === '' ? null : digits
}

/// The two sides of the phone comparison are never spelled alike:
/// `AgentMessagingChannel.normalizedPhoneE164` is `+15551234567` and the grid
/// prints `(555) 123-4567`. Comparing raw digits would match none of the 376
/// known collisions and the safeguard would quietly do nothing.
///
/// So one number matches the other when either carries the country code the
/// other omits: equal digits, or one a suffix of the other from the tenth digit
/// on. Stripping a leading `1` instead would be a US-only rule, and would
/// mangle a São Paulo mobile — `+5511987654321` against `(11) 98765-4321` —
/// which is exactly the case the guard must not miss.
export function samePhoneNumber(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = phoneDigits(left)
  const b = phoneDigits(right)
  if (!a || !b) return false
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 10 && longer.endsWith(shorter)
}

function blank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === ''
}

function trimmed(value: string | null): string | null {
  const text = value?.trim()
  return text ? text : null
}

/// Turns service rows into contact writes for clients the CRM already has.
///
/// `events` is expected newest-first (as `toClientServiceEvents` returns them):
/// the first row that offers a value for a gap wins, so a client who called
/// twice contributes the more recent number.
///
/// The caller must scope every input to one agent. Nothing here sees an agent
/// id and so nothing here can enforce it.
export function planClientContactBackfill(input: {
  events: readonly ClientServiceEvent[]
  policies: readonly ContactBackfillPolicy[]
  clients: readonly ContactBackfillClient[]
  agentPhones: readonly (string | null)[]
}): ClientContactBackfillPlan {
  const plan: ClientContactBackfillPlan = {
    contacts: [],
    skipped: { unmatchedPolicy: 0, nameMismatch: 0, agentOwnPhone: 0 },
  }

  // A policy number that resolves to two different clients is not a join key,
  // it is a collision. Dropping it keeps the failure at "one client stays
  // without a phone", the same direction `portfolio-identity` fails in.
  const clientIdByPolicy = new Map<string, string | null>()
  for (const policy of input.policies) {
    const key = normalizeCarrierPolicyNumber(policy.policyNumber)
    if (!key) continue
    const seen = clientIdByPolicy.get(key)
    if (seen === undefined) {
      clientIdByPolicy.set(key, policy.clientId)
    } else if (seen !== policy.clientId) {
      clientIdByPolicy.set(key, null)
    }
  }

  const clientById = new Map(input.clients.map((client) => [client.id, client]))
  const agentPhones = input.agentPhones.filter((phone) => phoneDigits(phone) !== null)

  // One entry per client, so a person with five service rows produces one write.
  const gaps = new Map<string, PlannedClientContact>()

  for (const event of input.events) {
    const key = normalizeCarrierPolicyNumber(event.policyNumber)
    const clientId = key ? clientIdByPolicy.get(key) : undefined
    if (!clientId) {
      if (event.email || event.phone) plan.skipped.unmatchedPolicy += 1
      continue
    }

    const client = clientById.get(clientId)
    if (!client) {
      plan.skipped.unmatchedPolicy += 1
      continue
    }
    if (!clientNamesAgree(event.customerName, client.name)) {
      plan.skipped.nameMismatch += 1
      continue
    }

    const queued = gaps.get(clientId)
    const email = blank(client.email) && !queued?.email ? trimmed(event.email) : null

    let phone: string | null = null
    if (blank(client.phone) && !queued?.phone) {
      const candidate = trimmed(event.phone)
      // The grid logs who the call was with, and 376 rows carry the agent's own
      // line. Writing that into `Client.phone` would point every KBOT birthday
      // message at the agent.
      if (agentPhones.some((agentPhone) => samePhoneNumber(agentPhone, candidate))) {
        plan.skipped.agentOwnPhone += 1
      } else {
        phone = candidate
      }
    }

    if (!email && !phone) continue
    if (queued) {
      queued.email = queued.email ?? email
      queued.phone = queued.phone ?? phone
      continue
    }
    const entry: PlannedClientContact = { clientId, email, phone }
    gaps.set(clientId, entry)
    plan.contacts.push(entry)
  }

  return plan
}
