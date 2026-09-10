import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(), queryRaw: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn(), agent: vi.fn(),
  template: vi.fn(), pref: vi.fn(), allocation: vi.fn(), grantUpdate: vi.fn(), send: vi.fn(), messages: vi.fn(),
}))

const tx = {
  $queryRaw: mocks.queryRaw,
  $executeRaw: vi.fn(),
  kBotFollowupJob: { update: mocks.update, findUniqueOrThrow: mocks.findUniqueOrThrow },
  kBotContactPreference: { findMany: mocks.pref },
  kBotCreditAllocation: { findMany: mocks.allocation },
  kBotCreditGrant: { update: mocks.grantUpdate },
}

vi.mock('@/lib/prisma', () => ({ prisma: {
  kBotFollowupJob: { updateMany: mocks.updateMany, findUniqueOrThrow: mocks.findUniqueOrThrow },
  agent: { findUnique: mocks.agent },
  kBotMessageTemplate: { findUnique: mocks.template },
  $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
} }))
vi.mock('@/lib/kbot-followup/transport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/kbot-followup/transport')>(),
  messagingTransport: async () => ({
    identity: 'acct:inbox:phone', conversation: async () => '10', verifyConversation: async () => {},
    send: mocks.send, messages: mocks.messages,
  }),
}))

import { processNextScheduledMessage, releaseExpiredScheduledLeases, renderTemplate } from './scheduled-worker'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.updateMany.mockResolvedValue({ count: 0 })
  mocks.queryRaw.mockResolvedValue([])
  // No agent behind the job: the claim still has to happen and the job still
  // has to be settled, which is the path these tests walk.
  mocks.agent.mockResolvedValue(null)
  mocks.findUniqueOrThrow.mockResolvedValue({ id: 'job1', agentId: 'a1', status: 'PREPARING', creditState: 'RESERVED', grantId: null })
})

describe('renderTemplate', () => {
  it('puts the client name into the agent own text and changes nothing else', () => {
    expect(renderTemplate('Feliz aniversário, {{name}}!', { customerName: 'Ana' })).toBe('Feliz aniversário, Ana!')
    expect(renderTemplate('Oi {{ NAME }}, tudo bem?', { customerName: 'Ana' })).toBe('Oi Ana, tudo bem?')
  })

  it('leaves a template with no placeholder exactly as the agent wrote it', () => {
    // The template is the message. Nothing here composes prose the agent has
    // not read, so an unrecognised placeholder is left alone rather than guessed.
    expect(renderTemplate('Feliz aniversário!', { customerName: 'Ana' })).toBe('Feliz aniversário!')
    expect(renderTemplate('Oi {{sobrenome}}', { customerName: 'Ana' })).toBe('Oi {{sobrenome}}')
  })
})

describe('scheduled queue claiming', () => {
  it('claims nothing when the queue is empty', async () => {
    expect(await processNextScheduledMessage()).toEqual({ outcome: 'IDLE' })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('steps over jobs a drain pass already deferred', async () => {
    // A job put back for quiet hours is still the oldest PENDING row. Without
    // this exclusion the drain loop would re-claim it every turn and never
    // reach anything behind it.
    mocks.queryRaw.mockResolvedValue([])
    await processNextScheduledMessage(['job1', 'job2'])
    expect(mocks.queryRaw.mock.calls[0][0].join('?')).toContain('NOT ("id" = ANY(')
    // Tagged template: the interpolated values follow the strings array.
    expect(mocks.queryRaw.mock.calls[0][2]).toEqual(['job1', 'job2'])
  })

  it('claims with SKIP LOCKED so two workers take two different rows', async () => {
    mocks.queryRaw.mockResolvedValue([{ id: 'job1' }])
    mocks.update.mockResolvedValue({ id: 'job1', agentId: 'a1', category: 'BIRTHDAY', language: 'PT',
      phone: '+13055550142', customerName: 'Ana' })
    await processNextScheduledMessage()
    const sql = mocks.queryRaw.mock.calls[0][0].join('?')
    expect(sql).toContain('FOR UPDATE SKIP LOCKED')
    expect(sql).toContain(`"status" = 'PENDING'`)
    // Only scheduled categories: the manual generator owns the FOLLOWUP rows.
    expect(sql).toContain('"category" = ANY(')
    // The claim takes a lease, so a worker that dies does not hold the row.
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job1' },
      data: expect.objectContaining({ status: 'PREPARING', leaseExpiresAt: expect.any(Date) }),
    }))
  })
})

describe('sending a scheduled message', () => {
  // 17:00Z is 13:00 in New York, inside the send window for a 305 number.
  const now = new Date('2026-03-11T17:00:00Z')
  const job = {
    id: 'job1', agentId: 'a1', category: 'BIRTHDAY', language: 'PT', phone: '+13055550142',
    customerName: 'Ana', status: 'PREPARING', creditState: 'RESERVED', grantId: 'g1',
    leaseExpiresAt: new Date(now.getTime() + 60_000),
  }

  beforeEach(() => {
    vi.setSystemTime(now)
    mocks.queryRaw.mockResolvedValue([{ id: 'job1' }])
    mocks.update.mockResolvedValue(job)
    mocks.findUniqueOrThrow.mockResolvedValue(job)
    mocks.agent.mockResolvedValue({ id: 'a1', status: 'ACTIVE', user: { banned: false } })
    mocks.template.mockResolvedValue({ enabled: true, body: 'Feliz aniversário, {{name}}!' })
    mocks.pref.mockResolvedValue([])
    mocks.messages.mockResolvedValue([])
    mocks.allocation.mockResolvedValue([{ grantId: 'g1', reservedTokens: 192 }])
    mocks.send.mockResolvedValue({ id: '99', sourceId: null, status: null })
  })
  afterEach(() => { vi.useRealTimers() })

  it('sends the agent template text, with the name filled in', async () => {
    expect(await processNextScheduledMessage()).toEqual({ outcome: 'WORKED', id: 'job1' })
    expect(mocks.send).toHaveBeenCalledWith('10', 'Feliz aniversário, Ana!', 'job1', '+13055550142')
  })

  it('hands the reservation back at dispatch, because no model was called', async () => {
    // An ACCEPTED job is never settled, so a reservation still held here would
    // never come back — the agent's monthly grant would drain one greeting at
    // a time until real follow-ups started failing for lack of credit.
    await processNextScheduledMessage()
    expect(mocks.grantUpdate).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { reserved: { decrement: 192 } } })
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'job1' }, data: { creditState: 'RELEASED' } })
  })

  it('never sends without an enabled template, even one queued while it existed', async () => {
    mocks.template.mockResolvedValue({ enabled: false, body: 'Feliz aniversário!' })
    await processNextScheduledMessage()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('defers rather than sends when the hour turned while the job waited', async () => {
    // 06:00 in California: queued inside the window, held up in a backlog, and
    // it must not go out anyway.
    const pacificJob = { ...job, phone: '+14155550142' }
    mocks.update.mockResolvedValue(pacificJob)
    mocks.findUniqueOrThrow.mockResolvedValue(pacificJob)
    vi.setSystemTime(new Date('2026-03-11T13:00:00Z'))
    expect(await processNextScheduledMessage()).toEqual({ outcome: 'DEFERRED', id: 'job1' })
    expect(mocks.send).not.toHaveBeenCalled()
    // Back on the queue, not failed: it is a "not yet", not a "never".
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'job1' }, data: { status: 'PENDING', leaseExpiresAt: null } })
  })
})

describe('releaseExpiredScheduledLeases', () => {
  it('returns a dead worker job to the queue rather than failing it', async () => {
    // Nothing was generated and no provider was called, so there is nothing to
    // give up on — unlike the manual path, which fails an expired lease.
    mocks.updateMany.mockResolvedValue({ count: 2 })
    const now = new Date('2026-03-11T17:00:00Z')
    expect(await releaseExpiredScheduledLeases(now)).toBe(2)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { status: 'PREPARING', category: { in: ['BIRTHDAY', 'ANNUAL_REVIEW'] }, leaseExpiresAt: { lt: now } },
      data: { status: 'PENDING', leaseExpiresAt: null },
    })
  })
})
