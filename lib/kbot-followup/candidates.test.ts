import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ policy: vi.fn(), requirement: vi.fn(), event: vi.fn(), pref: vi.fn(), job: vi.fn() }))
vi.mock('@/lib/agent-access', () => ({ getAgentAccessForAgent: async () => ({ isActive: true, enabledModules: null }) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  policy: { findMany: mocks.policy }, applicationRequirement: { findMany: mocks.requirement }, nationalLifeReportRow: { findMany: mocks.event },
  kBotContactPreference: { findMany: mocks.pref }, kBotFollowupJob: { findMany: mocks.job },
} }))
import { getFollowupCandidates } from './candidates'
const now = new Date('2026-09-04T12:00:00Z')
const policy = { id: 'p1', clientId: 'c1', policyNumber: '1', status: 'LAPSED', sourceStatus: 'Lapsed', sourceUpdatedAt: now, client: { name: 'Ana', phone: '+14075550100' } }
beforeEach(() => { vi.clearAllMocks(); mocks.policy.mockResolvedValue([policy]); for (const fn of [mocks.requirement, mocks.event, mocks.pref, mocks.job]) fn.mockResolvedValue([]) })
describe('candidate ownership and current facts', () => {
  it('queries own agent and own client only', async () => {
    const rows = await getFollowupCandidates('agent1', now)
    expect(rows).toHaveLength(1)
    expect(mocks.policy).toHaveBeenCalledWith(expect.objectContaining({ where: { agentId: 'agent1', client: { assignedAgentId: 'agent1' } } }))
    expect(rows[0].blockedReason).toBeNull()
  })
  it('preserves preferences stored on the client before a phone correction', async () => {
    for (const [preference, expected] of [
      [{ optedOut: true }, 'OPTED_OUT'],
      [{ snoozedUntil: new Date(now.getTime() + 10000) }, 'SNOOZED'],
      [{ lastManualAt: now }, 'RECENT_CONTACT'],
    ] as const) {
      mocks.pref.mockResolvedValue([{ subjectKey: 'client:c1', ...preference }])
      expect((await getFollowupCandidates('agent1', now))[0].blockedReason).toBe(expected)
    }
  })
  it('groups multiple policies by normalized phone', async () => {
    mocks.policy.mockResolvedValue([policy, { ...policy, id: 'p2', policyNumber: '2' }])
    expect(await getFollowupCandidates('agent1', now)).toHaveLength(1)
  })
  it('keeps stale data visible for manual handling but blocks AI', async () => {
    mocks.policy.mockResolvedValue([{ ...policy, sourceUpdatedAt: new Date('2026-08-01') }])
    expect((await getFollowupCandidates('agent1', now))[0].blockedReason).toBe('SYNC_REQUIRED')
  })
  it('suppresses an obsolete warning after a newer healthy policy snapshot', async () => {
    mocks.policy.mockResolvedValue([{ ...policy, status: 'INFORCE', sourceStatus: 'In Force' }])
    mocks.event.mockResolvedValue([{ id: 'e1', fetchedAt: now, raw: { PolicyNumber: '1', CallReason: 'Pending Lapse Warning', CaseDate: '2026-09-02' } }])
    expect(await getFollowupCandidates('agent1', now)).toEqual([])
  })
  it('prioritizes opt-out over missing credit or stale source', async () => {
    mocks.pref.mockResolvedValue([{ subjectKey: '+14075550100', optedOut: true }])
    expect((await getFollowupCandidates('agent1', now))[0].blockedReason).toBe('OPTED_OUT')
  })
  it('does not hide an opt-out when two clients share a phone', async () => {
    mocks.policy.mockResolvedValue([policy, { ...policy, id: 'p2', clientId: 'c2', policyNumber: '2' }])
    mocks.pref.mockResolvedValue([{ subjectKey: '+14075550100', optedOut: true }])
    expect((await getFollowupCandidates('agent1', now))[0].blockedReason).toBe('OPTED_OUT')
  })
})
