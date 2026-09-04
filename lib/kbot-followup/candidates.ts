import 'server-only'
import { phoneIssue } from './contact-quality'
import { prisma } from '@/lib/prisma'
import { getAgentAccessForAgent } from '@/lib/agent-access'
import { toClientServiceEvent } from '@/lib/national-life/client-intelligence'
import { CANONICAL_NATIONAL_LIFE_SYNC } from '@/lib/national-life/sync-engine'
import { ACTIVE_JOB_STATES, SENT_JOB_STATES, COOLDOWN_MS, fingerprint, normalizePhone, reasonFromStatus, type Candidate } from './domain'

export async function getFollowupCandidates(agentId: string, now = new Date()): Promise<Candidate[]> {
  const access = await getAgentAccessForAgent(agentId)
  if (!access.isActive) return []
  const canPolicies = access.enabledModules === null || access.enabledModules.includes('POLICIES')
  const canCrm = access.enabledModules === null || access.enabledModules.includes('CRM')
  const [policies, requirements, events, preferences, jobs] = await Promise.all([
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
  ])
  const byPolicy = new Map(policies.map(p => [p.policyNumber, p]))
  const preferenceBySubject = new Map(preferences.map(p => [p.subjectKey, p]))
  const contactedPhones = new Set(jobs.map(j => j.phone))
  const rows: Candidate[] = []
  function add(input: Omit<Candidate, 'fingerprint' | 'blockedReason'>, contact: { contactPhone: string | null; contactHref: string }) {
    // A phone repair must not discard a preference saved before a phone existed.
    const prefs = [preferenceBySubject.get(input.subjectKey), input.phone ? preferenceBySubject.get(input.phone) : undefined]
    const stale = now.getTime() - new Date(input.sourceAt).getTime() > 72 * 3_600_000
    const blockedReason = prefs.some(p => p?.optedOut) ? 'OPTED_OUT' : prefs.some(p => p?.snoozedUntil && p.snoozedUntil > now) ? 'SNOOZED'
      : prefs.some(p => p?.lastManualAt && now.getTime() - p.lastManualAt.getTime() < COOLDOWN_MS) ? 'RECENT_CONTACT'
      : input.phone && contactedPhones.has(input.phone) ? 'RECENT_CONTACT'
      : !input.phone ? 'PHONE_REQUIRED' : stale ? 'SYNC_REQUIRED' : null
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
