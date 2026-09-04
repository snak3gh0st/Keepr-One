import 'server-only'
import { prisma } from '@/lib/prisma'
import { getAgentAccessForAgent } from '@/lib/agent-access'
import { SENT_JOB_STATES, reasonFromStatus } from './domain'
import type { FollowupOutcome, FollowupResults } from './outcome-types'

type Job = { id: string; candidateId: string; sourceHref: string; reason: string; status: string; createdAt: Date; updatedAt: Date }
type Evidence = { kind: 'policy' | 'requirement'; status: string; sourceStatus?: string | null; sourceUpdatedAt: Date | null; provider: string | null; href: string }

/** A send receipt or a vanished queue entry is never proof of regularization. */
export function classifyOutcome(job: Pick<Job, 'reason' | 'updatedAt'>, evidence: Evidence | undefined, now = new Date()): FollowupOutcome {
  const review: FollowupOutcome = { state: 'REVIEW_REQUIRED', checkedAt: null, sourceHref: evidence?.href ?? null }
  if (!evidence || evidence.provider !== 'NATIONAL_LIFE') return review
  const at = evidence.sourceUpdatedAt
  if (!at || !Number.isFinite(at.getTime()) || at > now || at <= job.updatedAt) return { ...review, state: 'AWAITING_UPDATE' }
  const base = { checkedAt: at.toISOString(), sourceHref: evidence.href }
  // Requirement status can be edited manually; this table has no immutable carrier status receipt.
  if (evidence.kind === 'requirement') return { ...base, state: 'REVIEW_REQUIRED' }
  // A normal policy status alone cannot establish payment of a particular bill.
  if (!['LAPSED', 'LAPSE_WARNING'].includes(job.reason)) return { ...base, state: 'REVIEW_REQUIRED' }
  if (reasonFromStatus(evidence.status, evidence.sourceStatus ?? null)) return { ...base, state: 'PENDING' }
  if (evidence.status === 'INFORCE' && /^(in[ _-]*force|active)$/i.test(evidence.sourceStatus?.trim() ?? '')) return { ...base, state: 'RESOLVED' }
  // Cancellation, missing raw status, manual edits and unrecognized statuses do not count as recovery.
  return { ...base, state: 'REVIEW_REQUIRED' }
}

export async function getFollowupOutcomes(agentId: string, jobs: Job[], now = new Date()) {
  const access = await getAgentAccessForAgent(agentId)
  const byJob: Record<string, FollowupOutcome> = {}
  const results: FollowupResults = { delivered: 0, tracked: 0, resolved: 0, pending: 0, unverified: 0 }
  if (!access.isActive) return { byJob, results }
  const sent = jobs.filter(j => SENT_JOB_STATES.includes(j.status)).slice(0, 100)
  const policyId = (j: Job) => j.reason !== 'REQUIREMENT' ? /^\/agent\/policies\/([\w-]+)$/.exec(j.sourceHref)?.[1] : undefined
  const requirementId = (j: Job) => /^requirement:([\w-]+)$/.exec(j.candidateId)?.[1]
  const policyIds = [...new Set(sent.map(policyId).filter((id): id is string => !!id))]
  const requirementIds = [...new Set(sent.map(requirementId).filter((id): id is string => !!id))]
  const can = (module: 'POLICIES' | 'CRM') => access.enabledModules === null || access.enabledModules.includes(module)
  const [policies, requirements] = await Promise.all([
    can('POLICIES') && policyIds.length ? prisma.policy.findMany({
      where: { id: { in: policyIds }, agentId, client: { assignedAgentId: agentId } },
      select: { id: true, status: true, sourceStatus: true, sourceUpdatedAt: true, sourceProvider: true },
    }) : [],
    can('CRM') && requirementIds.length ? prisma.applicationRequirement.findMany({
      where: { id: { in: requirementIds }, application: { insuranceCase: { assignedAgentId: agentId,
        OR: [{ clientId: null, prospect: { assignedAgentId: agentId } }, { client: { assignedAgentId: agentId } }],
      } } },
      select: { id: true, status: true, provider: true, sourceUpdatedAt: true, application: { select: { caseId: true } } },
    }) : [],
  ])
  const evidence = new Map<string, Evidence>()
  for (const p of policies) evidence.set(`policy:${p.id}`, { ...p, kind: 'policy', provider: p.sourceProvider, href: `/agent/policies/${p.id}` })
  for (const r of requirements) evidence.set(`requirement:${r.id}`, { ...r, kind: 'requirement', href: `/agent/cases/${r.application.caseId}` })
  const seen = new Set<string>()
  for (const job of [...sent].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const key = job.reason === 'REQUIREMENT' ? `requirement:${requirementId(job) ?? job.id}` : `policy:${policyId(job) ?? job.id}`
    const outcome = classifyOutcome(job, evidence.get(key), now)
    byJob[job.id] = outcome
    if (['DELIVERED', 'READ'].includes(job.status)) results.delivered++
    if (seen.has(key)) continue
    seen.add(key); results.tracked++
    if (outcome.state === 'RESOLVED') results.resolved++
    else if (outcome.state === 'PENDING') results.pending++
    else results.unverified++
  }
  return { byJob, results }
}
