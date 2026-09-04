import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ policies: vi.fn(), requirements: vi.fn(), access: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { policy: { findMany: mocks.policies }, applicationRequirement: { findMany: mocks.requirements } } }))
vi.mock('@/lib/agent-access', () => ({ getAgentAccessForAgent: mocks.access }))
import { classifyOutcome, getFollowupOutcomes } from './outcomes'
const now = new Date('2026-09-04T16:00:00Z')
const job = { id: 'j1', candidateId: 'policy:p1', sourceHref: '/agent/policies/p1', reason: 'LAPSED', status: 'DELIVERED', createdAt: new Date('2026-09-04T12:00:00Z'), updatedAt: new Date('2026-09-04T13:00:00Z') }
const policy = { id: 'p1', status: 'INFORCE', sourceStatus: 'In Force', sourceUpdatedAt: new Date('2026-09-04T15:00:00Z'), sourceProvider: 'NATIONAL_LIFE' }
const evidence = { ...policy, kind: 'policy' as const, provider: policy.sourceProvider, href: '/agent/policies/p1' }
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ isActive: true, enabledModules: null }); mocks.policies.mockResolvedValue([policy]); mocks.requirements.mockResolvedValue([]) })
describe('evidence-based follow-up outcomes', () => {
  it('requires a newer carrier observation, not just a delivered message', () => {
    expect(classifyOutcome(job, evidence, now).state).toBe('RESOLVED')
    expect(classifyOutcome(job, { ...evidence, sourceUpdatedAt: job.updatedAt }, now).state).toBe('AWAITING_UPDATE')
    expect(classifyOutcome(job, { ...evidence, sourceUpdatedAt: new Date('2027-01-01') }, now).state).toBe('AWAITING_UPDATE')
    expect(classifyOutcome(job, undefined, now).state).toBe('REVIEW_REQUIRED')
  })
  it('never calls cancellation, unknown raw status or manual data a recovery', () => {
    expect(classifyOutcome(job, { ...evidence, status: 'CANCELED' }, now).state).toBe('REVIEW_REQUIRED')
    expect(classifyOutcome(job, { ...evidence, sourceStatus: null }, now).state).toBe('REVIEW_REQUIRED')
    expect(classifyOutcome(job, { ...evidence, provider: null }, now).state).toBe('REVIEW_REQUIRED')
    expect(classifyOutcome(job, { ...evidence, sourceStatus: 'Pending Lapse' }, now).state).toBe('PENDING')
  })
  it('does not infer a paid bill or carrier acceptance from editable requirement status', () => {
    expect(classifyOutcome({ ...job, reason: 'PAYMENT' }, evidence, now).state).toBe('REVIEW_REQUIRED')
    expect(classifyOutcome({ ...job, reason: 'REQUIREMENT' }, { ...evidence, kind: 'requirement', status: 'RECEIVED' }, now).state).toBe('REVIEW_REQUIRED')
  })
  it('scopes evidence to the agent and client and deduplicates repeated contacts', async () => {
    const result = await getFollowupOutcomes('owner', [job, { ...job, id: 'j2', candidateId: 'event:e2' }], now)
    expect(mocks.policies).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1'] }, agentId: 'owner', client: { assignedAgentId: 'owner' } } }))
    expect(result.results).toEqual({ delivered: 2, tracked: 1, resolved: 1, pending: 0, unverified: 0 })
  })
  it('does not expose inaccessible records or count unsent jobs', async () => {
    mocks.access.mockResolvedValue({ isActive: true, enabledModules: ['CRM'] })
    const result = await getFollowupOutcomes('owner', [job, { ...job, id: 'pending', status: 'PENDING' }], now)
    expect(mocks.policies).not.toHaveBeenCalled()
    expect(result.byJob.j1.sourceHref).toBeNull()
    expect(result.byJob.pending).toBeUndefined()
    expect(result.results.resolved).toBe(0)
  })
  it('ignores unsafe or unrelated source links without querying them', async () => {
    const result = await getFollowupOutcomes('owner', [{ ...job, sourceHref: 'https://other.test/p1' }], now)
    expect(mocks.policies).not.toHaveBeenCalled()
    expect(result.byJob.j1.sourceHref).toBeNull()
  })
})
