import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), template: vi.fn(), client: vi.fn(), policy: vi.fn(),
  jobFindFirst: vi.fn(), jobCreate: vi.fn(), pref: vi.fn(),
  grantFindMany: vi.fn(), grantUpsert: vi.fn(), grantUpdate: vi.fn(), allocationCreate: vi.fn(),
}))

const tx = {
  $executeRaw: vi.fn(),
  kBotFollowupJob: { findFirst: mocks.jobFindFirst, create: mocks.jobCreate },
  kBotContactPreference: { findMany: mocks.pref },
  kBotCreditGrant: { findMany: mocks.grantFindMany, upsert: mocks.grantUpsert, update: mocks.grantUpdate },
  kBotCreditAllocation: { create: mocks.allocationCreate },
}

vi.mock('@/lib/prisma', () => ({ prisma: {
  agent: { findUnique: mocks.agent },
  kBotMessageTemplate: { findMany: mocks.template },
  client: { findMany: mocks.client },
  policy: { findMany: mocks.policy },
  $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
} }))

import { enqueueScheduledMessagesForAgent } from './scheduled-queue'
import { LAPSE_RECENCY_MS } from './lapse-triggers'

// 17:00Z is 13:00 in New York — inside the send window, so the hour never
// decides a test unless the test is about the hour.
const now = new Date('2026-03-11T17:00:00Z')
const phone = '+13055550142'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false } })
  mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT' }])
  mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
  mocks.policy.mockResolvedValue([])
  mocks.jobFindFirst.mockResolvedValue(null)
  mocks.jobCreate.mockResolvedValue({ id: 'job1' })
  mocks.pref.mockResolvedValue([])
  mocks.grantFindMany.mockResolvedValue([{ id: 'g1', allowance: 1000, reserved: 0, spent: 0 }])
})

describe('enqueueScheduledMessagesForAgent', () => {
  it('queues a birthday under its own category and a key naming the year', async () => {
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result).toMatchObject({ queued: 1, skipped: [] })
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      agentId: 'a1', category: 'BIRTHDAY', requestKey: 'birthday:c1:2026', candidateId: 'birthday:c1',
      phone, customerName: 'Ana', language: 'PT', reason: 'BIRTHDAY',
    }) }))
  })

  it('writes nothing when the agent has no enabled template for the language', async () => {
    // There is no house default. A message going out over someone's name is
    // text they approved or it does not go out.
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'EN' }])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.queued).toBe(0)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'TEMPLATE_MISSING', category: 'BIRTHDAY' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('writes nothing for a category with no template at all', async () => {
    mocks.template.mockResolvedValue([])
    mocks.policy.mockResolvedValue([{ id: 'p1', clientId: 'c1', effectiveDate: new Date('2021-03-11T00:00:00Z') }])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.queued).toBe(0)
    expect(result.skipped.map((s) => s.reason)).toEqual(['TEMPLATE_MISSING', 'TEMPLATE_MISSING'])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('does not queue the same year twice', async () => {
    // The second pass of the day finds this year's job and reports it rather
    // than sending a second greeting.
    mocks.jobFindFirst.mockResolvedValueOnce({ id: 'existing' })
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.queued).toBe(0)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'ALREADY_QUEUED' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
    expect(mocks.jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requestKey: 'birthday:c1:2026', candidateId: 'birthday:c1' }),
    }))
  })

  it('lets the shared gate stop a birthday, and says which rule stopped it', async () => {
    for (const [preference, expected] of [
      [{ optedOut: true }, 'OPTED_OUT'],
      [{ snoozedUntil: new Date(now.getTime() + 10_000) }, 'SNOOZED'],
      [{ lastManualAt: now }, 'RECENT_CONTACT'],
    ] as const) {
      vi.clearAllMocks()
      mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false } })
      mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT' }])
      mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
      mocks.policy.mockResolvedValue([])
      mocks.jobFindFirst.mockResolvedValue(null)
      mocks.pref.mockResolvedValue([{ subjectKey: phone, ...preference }])
      const result = await enqueueScheduledMessagesForAgent('a1', now)
      expect(result.skipped).toEqual([expect.objectContaining({ reason: expected })])
      expect(mocks.jobCreate).not.toHaveBeenCalled()
    }
  })

  it('counts a follow-up of another category against the birthday', async () => {
    // The lapse warning and the greeting reach the same phone. This is the
    // check that makes the two features see each other.
    mocks.jobFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'lapse-job' })
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'RECENT_CONTACT' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('still queues at an hour it may not send in, because the date comes once', async () => {
    // 06:00 in California, from a number whose area code says California. The
    // birthday candidate exists only today: refusing here would drop the
    // greeting for good, since tomorrow there is nothing to enqueue. The hour
    // is enforced at dispatch, where a refusal puts the job back on the queue.
    mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone: '+14155550142', dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
    const result = await enqueueScheduledMessagesForAgent('a1', new Date('2026-03-11T13:00:00Z'))
    expect(result.skipped).toEqual([])
    expect(mocks.jobCreate).toHaveBeenCalled()
  })

  it('does not queue what it cannot pay for', async () => {
    mocks.grantFindMany.mockResolvedValue([{ id: 'g1', allowance: 100, reserved: 0, spent: 0 }])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'INSUFFICIENT_CREDITS' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('reserves against a grant the same way the manual path does', async () => {
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'g1' }, data: { reserved: { increment: 192 } },
    }))
    expect(mocks.allocationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: { jobId: 'job1', grantId: 'g1', reservedTokens: 192 },
    }))
  })

  it('ignores a client whose number cannot be dialled', async () => {
    mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone: '(407) 555-0100', dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
    expect(await enqueueScheduledMessagesForAgent('a1', now)).toMatchObject({ queued: 0, skipped: [] })
  })

  it('does no work at all for an inactive or banned agent', async () => {
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'SUSPENDED', user: { language: 'PT', banned: false } })
    expect(await enqueueScheduledMessagesForAgent('a1', now)).toEqual({ queued: 0, skipped: [] })
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: true } })
    expect(await enqueueScheduledMessagesForAgent('a1', now)).toEqual({ queued: 0, skipped: [] })
    expect(mocks.client).not.toHaveBeenCalled()
  })
})

// The two policy reads happen in one `Promise.all`, in this order: in-force
// first (annual review), lapsed second. Naming it once here keeps every case
// below from having to remember which `mockResolvedValueOnce` is which.
const lapsePolicies = (rows: Array<Record<string, unknown>>) => {
  mocks.policy.mockResolvedValueOnce([]).mockResolvedValueOnce(rows)
}
const lapsed = { id: 'p1', clientId: 'c1', status: 'LAPSED', sourceStatus: 'Lapsed',
  statusChangedAt: new Date('2026-03-01T00:00:00Z') }

describe('enqueueScheduledMessagesForAgent, lapse recovery', () => {
  beforeEach(() => {
    // No birthday today, so nothing but the lapse can produce a candidate.
    mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: null }])
    mocks.template.mockResolvedValue([{ category: 'LAPSE_RECOVERY', language: 'PT' }])
  })

  it('proposes a lapse under a key naming the event, waiting for the agent', async () => {
    lapsePolicies([lapsed])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result).toMatchObject({ queued: 1, skipped: [] })
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      agentId: 'a1', category: 'LAPSE_RECOVERY',
      requestKey: 'lapse:p1:2026-03-01T00:00:00.000Z', candidateId: 'policy:p1',
      subjectKey: 'client:c1', phone, customerName: 'Ana', language: 'PT',
      sourceHref: '/agent/policies/p1',
      // The owner's rule: nothing leaves on its own.
      status: 'AWAITING_APPROVAL',
    }) }))
  })

  it('reads the lapse book only inside the recency window', async () => {
    lapsePolicies([])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.policy).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: 'a1', status: 'LAPSED',
        statusChangedAt: { gte: new Date(now.getTime() - LAPSE_RECENCY_MS), lte: now } }),
    }))
  })

  it('leaves PENDING only when the agent turned the category on', async () => {
    mocks.template.mockResolvedValue([{ category: 'LAPSE_RECOVERY', language: 'PT', autoSend: true }])
    lapsePolicies([lapsed])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDING' }),
    }))
  })

  it('writes nothing without an enabled lapse template', async () => {
    // There is no house text for a lapse either.
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT' }])
    lapsePolicies([lapsed])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.queued).toBe(0)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'TEMPLATE_MISSING', category: 'LAPSE_RECOVERY' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('does not propose the same lapse twice', async () => {
    mocks.jobFindFirst.mockResolvedValueOnce({ id: 'existing' })
    lapsePolicies([lapsed])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'ALREADY_QUEUED', category: 'LAPSE_RECOVERY' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('passes a lapse through the same gate and the same reservation', async () => {
    mocks.pref.mockResolvedValue([{ subjectKey: phone, optedOut: true }])
    lapsePolicies([lapsed])
    expect((await enqueueScheduledMessagesForAgent('a1', now)).skipped)
      .toEqual([expect.objectContaining({ reason: 'OPTED_OUT' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false } })
    mocks.template.mockResolvedValue([{ category: 'LAPSE_RECOVERY', language: 'PT' }])
    mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: null }])
    mocks.jobFindFirst.mockResolvedValue(null)
    mocks.jobCreate.mockResolvedValue({ id: 'job1' })
    mocks.pref.mockResolvedValue([])
    mocks.grantFindMany.mockResolvedValue([{ id: 'g1', allowance: 1000, reserved: 0, spent: 0 }])
    lapsePolicies([lapsed])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'g1' }, data: { reserved: { increment: 192 } },
    }))
  })

  it('looks for agents by every proposal category, not only the dated ones', async () => {
    // An agent whose only enabled template is lapse recovery must still be
    // visited by the pass, or the feature does not exist for them.
    mocks.template.mockResolvedValue([])
    lapsePolicies([])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.template).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ category: { in: ['BIRTHDAY', 'ANNUAL_REVIEW', 'LAPSE_RECOVERY'] } }),
    }))
  })
})
