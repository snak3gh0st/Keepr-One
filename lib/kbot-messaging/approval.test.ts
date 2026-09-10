import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), settle: vi.fn(), lock: vi.fn(),
  outerFindMany: vi.fn(),
}))

const tx = {
  kBotFollowupJob: { updateMany: mocks.updateMany, findMany: mocks.findMany, findUnique: mocks.findUnique },
}

vi.mock('@/lib/prisma', () => ({ prisma: {
  kBotFollowupJob: { findMany: mocks.outerFindMany },
  $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
} }))
vi.mock('@/lib/kbot-followup/credits', () => ({
  lockAgent: mocks.lock,
  settleJob: mocks.settle,
}))

import { approveScheduledMessages, discardScheduledMessages, expireStaleScheduledProposals } from './approval'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.findMany.mockResolvedValue([])
  mocks.outerFindMany.mockResolvedValue([])
})

describe('approveScheduledMessages', () => {
  it('moves a proposal to the only state the worker claims', async () => {
    expect(await approveScheduledMessages('a1', ['job1'])).toEqual({ released: 1 })
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: 'a1', status: 'AWAITING_APPROVAL' }),
      data: { status: 'PENDING' },
    }))
  })

  it('cannot resurrect a job that already left that state', async () => {
    // A stale screen approving a job that was sent, cancelled or expired must
    // match nothing rather than push it back into the queue.
    mocks.updateMany.mockResolvedValue({ count: 0 })
    expect(await approveScheduledMessages('a1', ['job1'])).toEqual({ released: 0 })
  })

  it('does not touch the database for an empty selection', async () => {
    expect(await approveScheduledMessages('a1', [])).toEqual({ released: 0 })
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })

  it('refuses a proposal that already expired, without waiting for the sweep', async () => {
    // A tab left open overnight must not release a greeting that timed out
    // hours ago just because the sweep has not come round yet.
    await approveScheduledMessages('a1', ['job1'], new Date('2026-03-14T12:00:00Z'))
    expect(mocks.updateMany.mock.calls[0][0].where.createdAt.gte)
      .toEqual(new Date('2026-03-12T12:00:00Z'))
  })

  it('is scoped to the agent who is approving', async () => {
    await approveScheduledMessages('a1', ['job1'])
    expect(mocks.updateMany.mock.calls[0][0].where.agentId).toBe('a1')
    expect(mocks.lock).toHaveBeenCalledWith(tx, 'a1')
  })
})

describe('discardScheduledMessages', () => {
  it('hands the reservation back rather than only changing the status', async () => {
    // The tokens were reserved when the proposal was raised. A plain status
    // update would leave them held against an agent who declined to send.
    const job = { id: 'job1', agentId: 'a1' }
    mocks.findMany.mockResolvedValue([job])
    expect(await discardScheduledMessages('a1', ['job1'])).toEqual({ released: 1 })
    expect(mocks.settle).toHaveBeenCalledWith(tx, job, 'CANCELLED', 'DISCARDED_BY_AGENT')
  })
})

describe('expireStaleScheduledProposals', () => {
  it('gives back the credit of a proposal nobody released', async () => {
    const job = { id: 'job1', agentId: 'a1', status: 'AWAITING_APPROVAL' }
    mocks.outerFindMany.mockResolvedValue([job])
    mocks.findUnique.mockResolvedValue(job)
    expect(await expireStaleScheduledProposals(new Date('2026-03-14T12:00:00Z'))).toBe(1)
    expect(mocks.settle).toHaveBeenCalledWith(tx, job, 'CANCELLED', 'APPROVAL_EXPIRED')
    // Two days, counted from when the proposal was raised.
    expect(mocks.outerFindMany.mock.calls[0][0].where.createdAt.lt)
      .toEqual(new Date('2026-03-12T12:00:00Z'))
  })

  it('leaves alone a proposal approved between the read and the write', async () => {
    mocks.outerFindMany.mockResolvedValue([{ id: 'job1', agentId: 'a1', status: 'AWAITING_APPROVAL' }])
    mocks.findUnique.mockResolvedValue({ id: 'job1', agentId: 'a1', status: 'PENDING' })
    await expireStaleScheduledProposals()
    expect(mocks.settle).not.toHaveBeenCalled()
  })
})
