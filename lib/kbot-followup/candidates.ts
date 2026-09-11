import 'server-only'
import { phoneIssue } from './contact-quality'
import { prisma } from '@/lib/prisma'
import { getAgentAccessForAgent } from '@/lib/agent-access'
import { toClientServiceEvent } from '@/lib/national-life/client-intelligence'
import { CANONICAL_NATIONAL_LIFE_SYNC } from '@/lib/national-life/sync-engine'
import { evaluateSendGate } from '@/lib/kbot-messaging/send-gate'
import { ACTIVE_JOB_STATES, AWAITING_APPROVAL, SENT_JOB_STATES, COOLDOWN_MS, fingerprint, normalizePhone, reasonFromStatus, type Candidate } from './domain'

export async function getFollowupCandidates(agentId: string, now = new Date()): Promise<Candidate[]> {
  const access = await getAgentAccessForAgent(agentId)
  if (!access.isActive) return []
  const canPolicies = access.enabledModules === null || access.enabledModules.includes('POLICIES')
  const canCrm = access.enabledModules === null || access.enabledModules.includes('CRM')
  const [policies, requirements, events, preferences, jobs, proposed] = await Promise.all([
    canPolicies ? prisma.policy.findMany({ where: { agentId, client: { assignedAgentId: agentId } },
      select: { id: true, clientId: true, policyNumber: true, status: true, sourceStatus: true, sourceUpdatedAt: true,
        client: { select: { name: true, phone: true } } } }) : [],
    canCrm ? prisma.applicationRequirement.findMany({ where: { status: 'OPEN', application: { insuranceCase: {
      assignedAgentId: agentId, status: 'OPEN', OR: [{ clientId: null, prospect: { assignedAgentId: agentId } }, { client: { assignedAgentId: agentId } }],
    } } }, include: { application: { include: { insuranceCase: { include: { client: true, prospect: true } } } } } }) : [],
    canPolicies ? prisma.nationalLifeReportRow.findMany({ where: { agentId, gridKey: 'CLIENT_INTELLIGENCE',
      deploymentScope: CANONICAL_NATIONAL_LIFE_SYNC.deploymentScope,
      fetchedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, select: { id: true, raw: true, fetchedAt: true } }) : [],
    prisma.kBotContactPreference.findMany({ where: { agentId } }),
    prisma.kBotFollowupJob.findMany({ where: { agentId, OR: [
      { status: { in: ACTIVE_JOB_STATES } },
      { status: { in: SENT_JOB_STATES }, updatedAt: { gte: new Date(now.getTime() - COOLDOWN_MS) } },
    ] }, select: { phone: true } }),
    // Proposals waiting in the approval queue, which are deliberately outside
    // ACTIVE_JOB_STATES so an unapproved birthday cannot silence a follow-up
    // the agent wants to send by hand. Lapse is the case where that same
    // freedom would hurt: the proposal and the entry below are the same message
    // about the same event, so offering both would let the agent send it by
    // hand, approve it in the queue, and watch the second die as RECENT_CONTACT
    // with nothing on screen explaining why.
    prisma.kBotFollowupJob.findMany({
      where: { agentId, status: AWAITING_APPROVAL },
      select: { phone: true, candidateId: true },
    }),
  ])
  const byPolicy = new Map(policies.map(p => [p.policyNumber, p]))
  const preferenceBySubject = new Map(preferences.map(p => [p.subjectKey, p]))
  const contactedPhones = new Set(jobs.map(j => j.phone))
  // Keyed by candidate id: the proposal carries the id of the very candidate it
  // was raised from, so this matches the one entry it duplicates rather than
  // silencing everything that shares a phone.
  const proposedCandidateIds = new Set(proposed.map(j => j.candidateId))
  const rows: Candidate[] = []
  function add(input: Omit<Candidate, 'fingerprint' | 'blockedReason'>, contact: { contactPhone: string | null; contactHref: string }) {
    // A phone repair must not discard a preference saved before a phone existed.
    const prefs = [preferenceBySubject.get(input.subjectKey), input.phone ? preferenceBySubject.get(input.phone) : undefined]
      .filter(p => p !== undefined)
    const stale = now.getTime() - new Date(input.sourceAt).getTime() > 72 * 3_600_000
    // Opt-out, snooze and recency are the shared gate's call, so this list and a
    // birthday greeting cap each other. The job query above already filtered by
    // the window, so a phone in that set is recent by construction. Quiet hours
    // are not enforced: this list is what a human is about to choose from.
    const gate = evaluateSendGate({
      phone: input.phone, preferences: prefs, now, enforceQuietHours: false,
      recentJobs: input.phone && contactedPhones.has(input.phone) ? [{ sentAt: now }] : [],
    })
    // Reported ahead of the gate's reasons: "it is already waiting for you" is
    // an instruction the agent can act on, where "recent contact" would send
    // them looking for a message that has not gone out yet.
    const blockedReason = proposedCandidateIds.has(input.id) ? 'ALREADY_PROPOSED'
      : gate.reason ?? (!input.phone ? 'PHONE_REQUIRED' : stale ? 'SYNC_REQUIRED' : null)
    rows.push({ ...input, fingerprint: fingerprint(input), blockedReason, ...contact, phoneIssue: phoneIssue(contact.contactPhone) })
  }
  for (const p of policies) {
    const reason = reasonFromStatus(p.status, p.sourceStatus)
    if (reason) add({ id: `policy:${p.id}`, subjectKey: `client:${p.clientId}`, customerName: p.client.name,
      phone: normalizePhone(p.client.phone), reason, sourceHref: `/agent/policies/${p.id}`,
      sourceAt: (p.sourceUpdatedAt ?? new Date(0)).toISOString() }, { contactPhone: p.client.phone, contactHref: `/agent/clients/${p.clientId}` })
  }
  for (const row of events) {
    const e = toClientServiceEvent(row)
    const p = e.policyNumber ? byPolicy.get(e.policyNumber) : null
    if (!p || !e.occurredAt || e.occurredAt > now || e.occurredAt.getTime() < now.getTime() - 30 * 86_400_000) continue
    if (!['EftFailure', 'Planned Premium Overdue (Life - IUL/UL)', 'Pending Lapse Warning', 'Lapse Letter'].includes(e.reason ?? '')) continue
    if (['CANCELED', 'LAPSED'].includes(p.status)) continue
    // A more recent normal in-force snapshot supersedes an older event warning.
    if (p.sourceUpdatedAt && p.sourceUpdatedAt >= e.occurredAt && p.status === 'INFORCE' && !reasonFromStatus(p.status, p.sourceStatus)) continue
    add({ id: `event:${row.id}`, subjectKey: `client:${p.clientId}`, customerName: p.client.name,
      phone: normalizePhone(p.client.phone) ?? normalizePhone(e.phone), reason: /Lapse/.test(e.reason!) ? 'LAPSE_WARNING' : 'PAYMENT',
      sourceHref: `/agent/policies/${p.id}`, sourceAt: row.fetchedAt.toISOString() }, { contactPhone: p.client.phone, contactHref: `/agent/clients/${p.clientId}` })
  }
  for (const r of requirements) {
    const c = r.application.insuranceCase
    add({ id: `requirement:${r.id}`, subjectKey: c.clientId ? `client:${c.clientId}` : `case:${c.id}`,
      customerName: c.client?.name ?? `${c.prospect.firstName} ${c.prospect.lastName}`,
      phone: normalizePhone(c.client?.phone ?? c.prospect.phone), reason: 'REQUIREMENT',
      sourceHref: `/agent/cases/${c.id}`, sourceAt: (r.sourceUpdatedAt ?? r.updatedAt).toISOString() }, { contactPhone: c.client?.phone ?? c.prospect.phone, contactHref: c.clientId ? `/agent/clients/${c.clientId}` : `/agent/cases/${c.id}` })
  }
  const rank = { LAPSED: 0, LAPSE_WARNING: 1, PAYMENT: 2, REQUIREMENT: 3 }
  rows.sort((a, b) => rank[a.reason] - rank[b.reason] || a.id.localeCompare(b.id))
  const seen = new Set<string>()
  const subjectsByPhone = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!row.phone) continue
    const subjects = subjectsByPhone.get(row.phone) ?? new Set<string>()
    subjects.add(row.subjectKey)
    subjectsByPhone.set(row.phone, subjects)
  }
  for (const row of rows) {
    if (row.blockedReason !== 'OPTED_OUT' && row.phone && subjectsByPhone.get(row.phone)!.size > 1) { row.blockedReason = 'CONTACT_AMBIGUOUS'; row.phoneIssue = 'SHARED' }
  }
  return rows.filter(row => { const key = row.phone ?? row.subjectKey; if (seen.has(key)) return false; seen.add(key); return true })
}
