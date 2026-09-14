import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  agent: vi.fn(), template: vi.fn(), client: vi.fn(), policy: vi.fn(),
  jobFindFirst: vi.fn(), jobCreate: vi.fn(), jobUpdate: vi.fn(), pref: vi.fn(),
  grantFindMany: vi.fn(), grantUpsert: vi.fn(), grantUpdate: vi.fn(),
  allocationCreate: vi.fn(), allocationFindMany: vi.fn(), allocationUpdate: vi.fn(),
  generate: vi.fn(),
}))

const tx = {
  $executeRaw: vi.fn(),
  kBotFollowupJob: { findFirst: mocks.jobFindFirst, create: mocks.jobCreate, update: mocks.jobUpdate },
  kBotContactPreference: { findMany: mocks.pref },
  kBotCreditGrant: { findMany: mocks.grantFindMany, upsert: mocks.grantUpsert, update: mocks.grantUpdate },
  kBotCreditAllocation: { create: mocks.allocationCreate, findMany: mocks.allocationFindMany, update: mocks.allocationUpdate },
}

vi.mock('@/lib/prisma', () => ({ prisma: {
  agent: { findUnique: mocks.agent },
  kBotMessageTemplate: { findMany: mocks.template },
  client: { findMany: mocks.client },
  policy: { findMany: mocks.policy },
  // The reads the pass makes before asking the model anything are the same
  // reads the transaction makes, so they answer from the same mocks.
  kBotFollowupJob: { findFirst: mocks.jobFindFirst },
  kBotContactPreference: { findMany: mocks.pref },
  kBotCreditGrant: { findMany: mocks.grantFindMany },
  $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
} }))
vi.mock('./scheduled-generation', () => ({ generateScheduledMessage: mocks.generate }))

import { enqueueScheduledMessagesForAgent } from './scheduled-queue'
import { LAPSE_RECENCY_MS } from './lapse-triggers'

// 17:00Z is 13:00 in New York — inside the send window, so the hour never
// decides a test unless the test is about the hour.
const now = new Date('2026-03-11T17:00:00Z')
const phone = '+13055550142'
/// The agent's own text. Most cases below are about the gate and the
/// reservation, not about who wrote the message, so they carry a body and stay
/// on the path where the model is never asked.
const body = 'Oi {{primeiro_nome}}, aqui é {{agente}}.'
/// O padrão agora é desligado: sem esta data, o gate recusaria toda a
/// suíte com NOT_ENABLED. Os testes abaixo são sobre outra coisa, então o
/// contato já chega ligado pelo agente.
const enabledAt = new Date('2026-01-01T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false, name: 'Paulo' } })
  mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body }])
  mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
  mocks.policy.mockResolvedValue([])
  mocks.jobFindFirst.mockResolvedValue(null)
  // What `create` hands back is the row the settlement then charges against.
  mocks.jobCreate.mockResolvedValue({ id: 'job1', agentId: 'a1', grantId: 'g1', creditState: 'RESERVED', reservedTokens: 192 })
  mocks.allocationFindMany.mockResolvedValue([{ id: 'al1', grantId: 'g1', reservedTokens: 192 }])
  mocks.generate.mockResolvedValue({ ok: true, text: 'Ana, tudo de bom hoje!', attempted: true,
    model: 'test-model', inputTokens: 120, outputTokens: 30 })
  mocks.pref.mockResolvedValue([{ subjectKey: phone, kbotEnabledAt: enabledAt }])
  mocks.grantFindMany.mockResolvedValue([{ id: 'g1', allowance: 1000, reserved: 0, spent: 0 }])
})

describe('enqueueScheduledMessagesForAgent', () => {
  it('refuses a number two clients of the same agent share', async () => {
    // A household on one line: a lapse notice naming one of them lands on the
    // other's phone. The manual screen already refuses this; nothing in the
    // proposal path did.
    mocks.client.mockResolvedValue([
      { id: 'c1', name: 'Ana', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') },
      { id: 'c2', name: 'João', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') },
    ])
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.queued).toBe(0)
    expect(result.skipped.map((entry) => entry.reason)).toEqual(['CONTACT_AMBIGUOUS', 'CONTACT_AMBIGUOUS'])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

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
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'EN', body }])
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
      mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false, name: 'Paulo' } })
      mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body }])
      mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
      mocks.policy.mockResolvedValue([])
      mocks.jobFindFirst.mockResolvedValue(null)
      mocks.pref.mockResolvedValue([{ subjectKey: phone, kbotEnabledAt: enabledAt, ...preference }])
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
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'SUSPENDED', user: { language: 'PT', banned: false, name: 'Paulo' } })
    expect(await enqueueScheduledMessagesForAgent('a1', now)).toEqual({ queued: 0, skipped: [] })
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: true, name: 'Paulo' } })
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
    mocks.template.mockResolvedValue([{ category: 'LAPSE_RECOVERY', language: 'PT', body }])
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
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body }])
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
    mocks.pref.mockResolvedValue([{ subjectKey: phone, kbotEnabledAt: enabledAt, optedOut: true }])
    lapsePolicies([lapsed])
    expect((await enqueueScheduledMessagesForAgent('a1', now)).skipped)
      .toEqual([expect.objectContaining({ reason: 'OPTED_OUT' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()

    vi.clearAllMocks()
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false, name: 'Paulo' } })
    mocks.template.mockResolvedValue([{ category: 'LAPSE_RECOVERY', language: 'PT', body }])
    mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: null }])
    mocks.jobFindFirst.mockResolvedValue(null)
    // What `create` hands back is the row the settlement then charges against.
  mocks.jobCreate.mockResolvedValue({ id: 'job1', agentId: 'a1', grantId: 'g1', creditState: 'RESERVED', reservedTokens: 192 })
  mocks.allocationFindMany.mockResolvedValue([{ id: 'al1', grantId: 'g1', reservedTokens: 192 }])
  mocks.generate.mockResolvedValue({ ok: true, text: 'Ana, tudo de bom hoje!', attempted: true,
    model: 'test-model', inputTokens: 120, outputTokens: 30 })
    mocks.pref.mockResolvedValue([{ subjectKey: phone, kbotEnabledAt: enabledAt }])
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

/// A category that is on but has no text yet.
///
/// `body` null is not "off" — it is "on, and the K-Bot writes this one". What
/// waits for the agent has to carry the text before they see it: the promise of
/// the approval screen is that they read the message that will actually leave.
describe('enqueueScheduledMessagesForAgent, a category the K-Bot writes', () => {
  beforeEach(() => {
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body: null }])
  })

  it('writes the message at enqueue, so the agent reads what will be sent', async () => {
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result).toMatchObject({ queued: 1, skipped: [] })
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      category: 'BIRTHDAY', firstName: 'Ana', language: 'PT',
    }))
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'AWAITING_APPROVAL', content: 'Ana, tudo de bom hoje!', model: 'test-model',
    }) }))
  })

  it('registers the call against the platform daily ceiling', async () => {
    // The ceiling in the manual worker counts `generationStartedAt` across the
    // whole table. A generation that never stamped it would be spending the
    // provider budget where the cap cannot see it.
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      generationStartedAt: now,
    }) }))
  })

  it('registers nothing when the model was never asked', async () => {
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body }])
    mocks.generate.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE', attempted: false,
      model: 'test-model', inputTokens: 0, outputTokens: 0 })
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.jobCreate.mock.calls[0][0].data.generationStartedAt).toBeUndefined()
  })

  it('charges the tokens the text cost against the job that carries it', async () => {
    // The model was called at enqueue, so the reservation is spent at enqueue.
    // A generated message nobody is charged for is as much a defect as a
    // double charge.
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'g1' }, data: { reserved: { decrement: 192 }, spent: { increment: 150 } },
    }))
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job1' },
      data: expect.objectContaining({ creditState: 'SPENT', inputTokens: 120, outputTokens: 30 }),
    }))
  })

  it('prefers the agent own text over the model when a body exists', async () => {
    // True of the review and the lapse. The birthday is the exception, below.
    mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: null }])
    mocks.policy.mockResolvedValue([{ id: 'p1', clientId: 'c1', effectiveDate: new Date('2021-03-11T00:00:00Z') }])
    mocks.template.mockResolvedValue([{ category: 'ANNUAL_REVIEW', language: 'PT', body }])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      category: 'ANNUAL_REVIEW', content: 'Oi Ana, aqui é Paulo.',
    }) }))
  })

  it('writes the birthday even when the agent has a template, because the same words every year is the problem', async () => {
    // The whole reason this category is the exception. A template is the floor
    // it can fall back to, never a reason to send the same sentence for the
    // rest of the client's life.
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body }])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ category: 'BIRTHDAY' }))
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      content: 'Ana, tudo de bom hoje!', model: 'test-model',
    }) }))
  })

  it('falls back to the agent template when the model strays, and charges the attempt to the job', async () => {
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body }])
    mocks.generate.mockResolvedValue({ ok: false, reason: 'MENTIONS_BUSINESS', attempted: true,
      model: 'test-model', inputTokens: 120, outputTokens: 30 })
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result).toMatchObject({ queued: 1, skipped: [] })
    const created = mocks.jobCreate.mock.calls[0][0].data
    expect(created.content).toBe('Oi Ana, aqui é Paulo.')
    // The words are the agent's, so the model is not credited with them.
    expect(created.model).toBeUndefined()
    // The request still reached the provider, and there is a job to charge.
    expect(mocks.grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { reserved: { decrement: 192 }, spent: { increment: 150 } },
    }))
  })

  it('charges a refused attempt that has no job to be charged to', async () => {
    // No job is created, on purpose, so the client can be tried again. Without
    // this the next pass would ask, be refused, and pay nothing again — free
    // retries for as long as the candidate lasts.
    mocks.generate.mockResolvedValue({ ok: false, reason: 'CONTAINS_NUMBER', attempted: true,
      model: 'test-model', inputTokens: 120, outputTokens: 30 })
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'MESSAGE_UNAVAILABLE' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
    expect(mocks.grantUpdate).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { spent: { increment: 150 } } })
  })

  it('charges nothing when nothing was asked of anyone', async () => {
    // The model is switched off. No request left this process, so no one owes
    // anything, and the candidate waits for the day it is turned on.
    mocks.generate.mockResolvedValue({ ok: false, reason: 'UNAVAILABLE', attempted: false,
      model: 'test-model', inputTokens: 0, outputTokens: 0 })
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'MESSAGE_UNAVAILABLE' })])
    expect(mocks.grantUpdate).not.toHaveBeenCalled()
  })

  it('skips the category, and never invents a message, when the model is refused', async () => {
    mocks.generate.mockResolvedValue({ ok: false, reason: 'CONTAINS_NUMBER', attempted: true,
      model: 'test-model', inputTokens: 120, outputTokens: 30 })
    const result = await enqueueScheduledMessagesForAgent('a1', now)
    expect(result.queued).toBe(0)
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'MESSAGE_UNAVAILABLE', category: 'BIRTHDAY' })])
    expect(mocks.jobCreate).not.toHaveBeenCalled()
  })

  it('leaves the text to dispatch for a category that sends on its own', async () => {
    // Nobody reads an automatic message before it goes, so there is nothing to
    // gain by writing it early — and writing it early means paying for what
    // the dispatch gate then stops, again on every pass.
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body: null, autoSend: true }])
    await enqueueScheduledMessagesForAgent('a1', now)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.jobCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'PENDING', content: null,
    }) }))
  })

  it('does not pay the model for a candidate the pass is about to refuse', async () => {
    // The gate comes first, exactly as it does at dispatch: a second pass over
    // a birthday already queued, or a contact who opted out, must not cost a
    // model call every time the cron runs.
    for (const arrange of [
      () => mocks.jobFindFirst.mockResolvedValue({ id: 'existing' }),
      () => mocks.pref.mockResolvedValue([{ subjectKey: phone, kbotEnabledAt: enabledAt, optedOut: true }]),
      () => mocks.grantFindMany.mockResolvedValue([{ id: 'g1', allowance: 100, reserved: 0, spent: 0 }]),
    ]) {
      vi.clearAllMocks()
      mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { language: 'PT', banned: false, name: 'Paulo' } })
      mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body: null }])
      mocks.client.mockResolvedValue([{ id: 'c1', name: 'Ana', phone, dateOfBirth: new Date('1980-03-11T00:00:00Z') }])
      mocks.policy.mockResolvedValue([])
      mocks.jobFindFirst.mockResolvedValue(null)
      mocks.pref.mockResolvedValue([{ subjectKey: phone, kbotEnabledAt: enabledAt }])
      mocks.grantFindMany.mockResolvedValue([{ id: 'g1', allowance: 1000, reserved: 0, spent: 0 }])
      arrange()
      const result = await enqueueScheduledMessagesForAgent('a1', now)
      expect(result.queued).toBe(0)
      expect(mocks.generate).not.toHaveBeenCalled()
      expect(mocks.jobCreate).not.toHaveBeenCalled()
    }
  })

  it('charges a provider call when another pass wins before job creation', async () => {
    mocks.template.mockResolvedValue([{ category: 'BIRTHDAY', language: 'PT', body: null }])
    mocks.jobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'job-from-other-pass' })

    const result = await enqueueScheduledMessagesForAgent('a1', now)

    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.jobCreate).not.toHaveBeenCalled()
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'ALREADY_QUEUED' })])
    expect(mocks.grantUpdate).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { spent: { increment: 150 } },
    })
  })
})
