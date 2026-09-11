/// Which policies just fell out of force, and what the proposal for one is called.
///
/// Pure like the date engine next door: no Prisma, no clock of its own. The
/// caller hands in the book and the instant, so the two questions that decide
/// whether a lapse message is right — *is this policy actually lapsed* and *is
/// the lapse still recent enough to act on* — are answered by code a test can
/// drive across a reinstatement in one line.
///
/// Deliberately not a second classifier. `reasonFromStatus` already owns the
/// vocabulary the follow-up list speaks, and this asks it the same question the
/// manual screen asks, so the two can never disagree about what "lapsed" means.
import { reasonFromStatus } from '@/lib/kbot-followup/domain'
import { triggerZoneForPhone, type ProposalCandidate, type TriggerClient } from './scheduled-triggers'

/// How long after a lapse the message still has an action behind it.
///
/// Two reasons for 30 days, and they agree. Substantively: carrier
/// reinstatement grace on these products runs about a month, so past it the
/// message stops being "we can still fix this" and becomes a reminder that
/// something was lost — worse than silence. Locally: `candidates.ts` already
/// reads carrier events with a `30 * 86_400_000` horizon, and a policy that
/// lapsed two years ago must not surface here just because a pass finally ran.
export const LAPSE_RECENCY_MS = 30 * 86_400_000

/// The policy fields a lapse decision is made from.
///
/// `status` and `sourceStatus` travel together because the classifier needs
/// both: the carrier's own string carries states the mapped enum has no room
/// for. Null `statusChangedAt` means nobody knows when it happened.
export type LapsePolicy = {
  id: string
  clientId: string
  status: string
  sourceStatus: string | null
  statusChangedAt: Date | null
}

export type LapseTriggerInput = {
  clients: readonly TriggerClient[]
  policies: readonly LapsePolicy[]
  now: Date
}

/// Every policy whose lapse is recent enough to propose a message about.
///
/// Says nothing about whether a message may be sent — that is the send gate's
/// job, and the caller's. This only answers "did this lapse, and lately".
export function lapseCandidatesForPass(input: LapseTriggerInput): ProposalCandidate[] {
  const clientsById = new Map(input.clients.map((client) => [client.id, client]))
  const candidates: ProposalCandidate[] = []
  const floor = input.now.getTime() - LAPSE_RECENCY_MS

  for (const policy of input.policies) {
    // Only an entry *into* lapse. `LAPSE_WARNING` is a policy still in force
    // being warned, which is a different message and — the reason it cannot be
    // keyed here at all — is derived from the carrier's status string rather
    // than from a status change, so it has no event instant to anchor to.
    if (reasonFromStatus(policy.status, policy.sourceStatus) !== 'LAPSED') continue
    // No instant, no proposal. This is one rule covering two holes: without it
    // the key would read `lapse:p1:undefined` — the same key for every lapse
    // this policy ever has — and recency would have nothing to measure. A
    // policy imported already lapsed is exactly this case: `import-service`
    // writes null on create for a LAPSED row, because the date it fell out of
    // force happened before this system ever saw it.
    if (!policy.statusChangedAt) continue
    const changedAt = policy.statusChangedAt.getTime()
    // A carrier date in the future is bad data, not a lapse that has not
    // happened yet; treating it as recent would propose a message about an
    // event nobody can point at.
    if (changedAt > input.now.getTime() || changedAt < floor) continue

    const client = clientsById.get(policy.clientId)
    if (!client) continue
    // No number, no message. Not a block worth reporting: there is nowhere to
    // send it, and the manual list already surfaces a missing phone.
    if (!client.phone) continue

    candidates.push({
      category: 'LAPSE_RECOVERY',
      clientId: client.id,
      customerName: client.name,
      phone: client.phone,
      // Keyed to the event, not to the calendar. A policy can lapse, be
      // reinstated and lapse again inside one year, and a key naming the year —
      // the shape the birthday path uses — would silently swallow the second
      // lapse: the unique index would see the row from the first and treat the
      // new one as a replay. The instant of the status change is the event's
      // own identity: the same lapse yields the same key on every pass, a new
      // lapse writes a new instant and so earns a new proposal.
      requestKey: `lapse:${policy.id}:${policy.statusChangedAt.toISOString()}`,
      // Exactly the id `getFollowupCandidates` gives this policy's row. The
      // manual screen matches its `ALREADY_PROPOSED` badge on this string, so a
      // different shape here would leave the agent offered the same message
      // twice — once to send by hand, once to approve.
      candidateId: `policy:${policy.id}`,
      subjectKey: `client:${policy.clientId}`,
      sourceHref: `/agent/policies/${policy.id}`,
      timeZone: triggerZoneForPhone(client.phone),
    })
  }

  // Stable order so a pass is reproducible and a report reads the same twice.
  return candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId))
}
