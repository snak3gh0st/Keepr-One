import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ send: vi.fn(), messages: vi.fn(), providerStatus: vi.fn() }))

vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({
    datasourceUrl: process.env.KBOT_TEST_DATABASE_URL ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled',
  }) }
})
vi.mock('@/lib/kbot-followup/transport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/kbot-followup/transport')>(),
  messagingTransport: async () => ({
    identity: 'acct:inbox:phone',
    conversation: async () => '10',
    verifyConversation: async () => {},
    send: state.send,
    messages: state.messages,
    providerStatus: state.providerStatus,
  }),
}))

import { prisma } from '@/lib/prisma'
import { approveScheduledMessages, discardScheduledMessages } from './approval'
import { processNextScheduledMessage } from './scheduled-worker'
import { LAPSE_RECENCY_MS } from './lapse-triggers'
import { enqueueScheduledMessagesForAgent, runScheduledMessagePass } from './scheduled-queue'

const url = process.env.KBOT_TEST_DATABASE_URL
const enabled = !!url

const agentId = `sched-test-${randomUUID()}`
const userId = `sched-test-${randomUUID()}`
const clientId = `sched-test-${randomUUID()}`
// 17:00Z is 13:00 in New York: inside the send window for a 305 number, so the
// hour only decides the test that is about the hour.
const now = new Date('2026-03-11T17:00:00Z')
const phone = '+13055550142'

async function reset() {
  await prisma.kBotCreditAllocation.deleteMany({ where: { job: { agentId } } })
  await prisma.kBotFollowupJob.deleteMany({ where: { agentId } })
  await prisma.kBotCreditGrant.deleteMany({ where: { agentId } })
  await prisma.kBotContactPreference.deleteMany({ where: { agentId } })
  await prisma.kBotContactConsentEvent.deleteMany({ where: { agentId } })
  await prisma.kBotMessageTemplate.deleteMany({ where: { agentId } })
}

async function template(overrides: { enabled?: boolean; autoSend?: boolean; body?: string } = {}) {
  await prisma.kBotMessageTemplate.create({ data: {
    agentId,
    category: 'BIRTHDAY',
    language: 'PT',
    body: overrides.body ?? 'Feliz aniversário, {{primeiro_nome}}! Abraço, {{agente}}.',
    enabled: overrides.enabled ?? true,
    autoSend: overrides.autoSend ?? false,
  } })
}

/// The scheduled path against a real PostgreSQL: the advisory locks, the
/// `FOR UPDATE SKIP LOCKED` claim and the credit ledger only behave like
/// themselves against a real server, and until this existed the whole path had
/// never executed anywhere.
describe.skipIf(!enabled)('scheduled messages end to end', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, name: 'Paulo Loureiro', email: `${userId}@example.invalid`, role: 'AGENT', language: 'PT' } })
    await prisma.agent.create({ data: { id: agentId, userId, rank: 'AGENT', status: 'ACTIVE' } })
    await prisma.client.create({ data: { id: clientId, name: 'Ana Ribeiro', phone, assignedAgentId: agentId, dateOfBirth: new Date('1980-03-11T00:00:00Z') } })
  })
  beforeEach(async () => {
    await reset()
    vi.clearAllMocks()
    state.messages.mockResolvedValue([])
    state.send.mockResolvedValue({ id: '99', sourceId: null, status: null })
  })
  afterAll(async () => {
    await reset()
    await prisma.client.delete({ where: { id: clientId } })
    await prisma.agent.delete({ where: { id: agentId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it('waits for the agent, then sends exactly the text the screen showed', async () => {
    await template()
    expect(await enqueueScheduledMessagesForAgent(agentId, now)).toMatchObject({ queued: 1 })

    const proposal = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    expect(proposal).toMatchObject({ status: 'AWAITING_APPROVAL', category: 'BIRTHDAY', subjectKey: `client:${clientId}` })

    // Nothing may leave while it waits.
    expect(await processNextScheduledMessage()).toEqual({ outcome: 'IDLE' })
    expect(state.send).not.toHaveBeenCalled()

    expect(await approveScheduledMessages(agentId, [proposal.id], now)).toEqual({ released: 1 })
    vi.setSystemTime(now)
    expect(await processNextScheduledMessage()).toEqual({ outcome: 'SENT', id: proposal.id })
    vi.useRealTimers()

    expect(state.send).toHaveBeenCalledWith('10', 'Feliz aniversário, Ana! Abraço, Paulo Loureiro.', proposal.id, phone)
  })

  it('sends without asking only when the agent turned that on', async () => {
    await template({ autoSend: true })
    await enqueueScheduledMessagesForAgent(agentId, now)
    expect(await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })).toMatchObject({ status: 'PENDING' })
  })

  it('gives the reservation back when the agent discards a proposal', async () => {
    await template()
    await enqueueScheduledMessagesForAgent(agentId, now)
    const proposal = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    const held = await prisma.kBotCreditGrant.findFirstOrThrow({ where: { agentId } })
    expect(held.reserved).toBe(192)

    expect(await discardScheduledMessages(agentId, [proposal.id])).toEqual({ released: 1 })
    expect(await prisma.kBotCreditGrant.findFirstOrThrow({ where: { agentId } })).toMatchObject({ reserved: 0 })
    expect(await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } }))
      .toMatchObject({ status: 'CANCELLED', errorCode: 'DISCARDED_BY_AGENT', creditState: 'RELEASED' })
  })

  it('does not raise the same birthday twice in a year', async () => {
    await template()
    await enqueueScheduledMessagesForAgent(agentId, now)
    // A second pass the same day finds this year's job rather than greeting twice.
    expect(await enqueueScheduledMessagesForAgent(agentId, now)).toMatchObject({ queued: 0 })
    expect(await prisma.kBotFollowupJob.count({ where: { agentId } })).toBe(1)
  })

  it('records a WhatsApp stop request in the consent log, with the words used', async () => {
    await template({ autoSend: true })
    await enqueueScheduledMessagesForAgent(agentId, now)
    state.messages.mockResolvedValue([{ message_type: 0, content: 'PARE' }])

    vi.setSystemTime(now)
    expect(await processNextScheduledMessage()).toEqual({
      outcome: 'SETTLED',
      id: (await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })).id,
    })
    vi.useRealTimers()

    expect(state.send).not.toHaveBeenCalled()
    expect(await prisma.kBotContactPreference.findUniqueOrThrow({
      where: { agentId_subjectKey: { agentId, subjectKey: phone } },
    })).toMatchObject({ optedOut: true })
    expect(await prisma.kBotContactConsentEvent.findFirstOrThrow({ where: { agentId } }))
      .toMatchObject({ action: 'OPT_OUT', source: 'WHATSAPP_REPLY', evidence: 'PARE' })
  })

  it('refuses to enqueue for someone who asked to stop', async () => {
    await template()
    await prisma.kBotContactPreference.create({ data: { agentId, subjectKey: phone, optedOut: true } })
    expect(await enqueueScheduledMessagesForAgent(agentId, now)).toMatchObject({
      queued: 0,
      skipped: [expect.objectContaining({ reason: 'OPTED_OUT' })],
    })
  })
})

describe.skipIf(!enabled)('lapse recovery proposals end to end', () => {
  const agentId = `kbot-lapse-${randomUUID()}`
  const userId = `kbot-lapse-${randomUUID()}`
  const clientId = `kbot-lapse-${randomUUID()}`
  const policyId = `kbot-lapse-${randomUUID()}`
  // 305 is Miami, so the zone is America/New_York; 17:00Z is 13:00 there, inside
  // the send window. The hour is checked again at dispatch against the wall
  // clock, so the clock is frozen here rather than left to decide the test.
  const phone = '+13055550142'
  /// Frozen, but anchored to the real date rather than to a fixed one.
  ///
  /// `vi.setSystemTime` fakes `Date` inside this process; it does not reach
  /// Prisma's query engine, which stamps `@updatedAt` from its own clock. So any
  /// row the pass touches — a SENT job that reconciliation moves to DELIVERED,
  /// for one — comes back carrying real time no matter what date the test
  /// claims. Frozen months away from real time, those stamps landed inside the
  /// weekly recency window and the second lapse was skipped as RECENT_CONTACT:
  /// a flake that only appeared when reconciliation happened to fire, which is
  /// why adding any unrelated test file could surface it.
  ///
  /// Anchored here, a re-stamp lands within a day of where the test already
  /// believes "now" is, and so falls outside every window measured from it.
  /// The hour stays 17:00Z because it is 13:00 in America/New_York, which is
  /// what keeps these passes clear of quiet hours.
  const today = new Date()
  const now = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 17, 0, 0))
  // Same distances from `now` the fixed dates had, both well inside LAPSE_RECENCY_MS.
  const firstLapse = new Date(now.getTime() - (10 * 86_400_000 + 17 * 3_600_000))
  const secondLapse = new Date(now.getTime() - (86_400_000 + 5 * 3_600_000))

  const body = 'Olá {{primeiro_nome}}, sua apólice está em lapso. Posso ajudar a reativar?'
  const expectedText = 'Olá Ana, sua apólice está em lapso. Posso ajudar a reativar?'

  const reset = async () => {
    await prisma.kBotCreditAllocation.deleteMany({ where: { job: { agentId } } })
    await prisma.kBotFollowupJob.deleteMany({ where: { agentId } })
    await prisma.kBotCreditGrant.deleteMany({ where: { agentId } })
    await prisma.kBotContactPreference.deleteMany({ where: { agentId } })
    await prisma.kBotMessageTemplate.deleteMany({ where: { agentId } })
    await prisma.policy.deleteMany({ where: { agentId } })
  }

  const template = (over: { enabled?: boolean; autoSend?: boolean } = {}) =>
    prisma.kBotMessageTemplate.create({ data: {
      agentId, category: 'LAPSE_RECOVERY', language: 'PT', body,
      enabled: over.enabled ?? true, autoSend: over.autoSend ?? false,
    } })

  const lapse = (statusChangedAt: Date | null) => prisma.policy.upsert({
    where: { id: policyId },
    update: { status: 'LAPSED', statusChangedAt },
    create: { id: policyId, clientId, agentId, carrier: 'National Life', product: 'FlexLife',
      policyNumber: `LAPSE-${policyId}`, status: 'LAPSED', sourceStatus: 'Lapsed', statusChangedAt },
  })

  const jobs = () => prisma.kBotFollowupJob.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } })

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, name: 'Paulo', email: `${userId}@example.invalid`, role: 'AGENT', language: 'PT' } })
    await prisma.agent.create({ data: { id: agentId, userId, rank: 'AGENT' } })
    await prisma.client.create({ data: { id: clientId, name: 'Ana Ribeiro', phone, assignedAgentId: agentId } })
  })
  beforeEach(async () => {
    await reset()
    vi.clearAllMocks()
    // Only Date is faked: real timers still drive the Postgres driver.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    vi.stubEnv('KBOT_FOLLOWUP_FREE_TOKENS', '1000')
    state.messages.mockResolvedValue([])
    state.providerStatus.mockResolvedValue(null)
    state.send.mockResolvedValue({ id: '99', sourceId: null, status: null })
  })
  afterEach(() => { vi.useRealTimers() })
  afterAll(async () => {
    await reset()
    await prisma.client.delete({ where: { id: clientId } })
    await prisma.agent.delete({ where: { id: agentId } })
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
    vi.unstubAllEnvs()
  })

  it('raises a lapse proposal that waits for the agent', async () => {
    await template()
    await lapse(firstLapse)
    const report = await runScheduledMessagePass(now)
    expect(report).toMatchObject({ queued: 1, sent: 0 })
    const [job, ...rest] = await jobs()
    expect(rest).toEqual([])
    expect(job).toMatchObject({
      category: 'LAPSE_RECOVERY',
      // The owner's rule, enforced by the row itself: a proposal, not a send.
      status: 'AWAITING_APPROVAL',
      requestKey: `lapse:${policyId}:${firstLapse.toISOString()}`,
      candidateId: `policy:${policyId}`,
      subjectKey: `client:${clientId}`,
      phone,
      language: 'PT',
    })
    // Nothing reached the provider, and the reservation is being held.
    expect(state.send).not.toHaveBeenCalled()
    const grant = await prisma.kBotCreditGrant.findFirstOrThrow({ where: { agentId } })
    expect(grant.reserved).toBe(192)
  })

  it('sends the agent own template text once the agent approves', async () => {
    await template()
    await lapse(firstLapse)
    await runScheduledMessagePass(now)
    const [proposal] = await jobs()
    expect(await approveScheduledMessages(agentId, [proposal!.id], now)).toEqual({ released: 1 })

    const report = await runScheduledMessagePass(now)
    expect(report.sent).toBe(1)
    expect(state.send).toHaveBeenCalledTimes(1)
    // The text is the agent's, filled with the client's own first name — there
    // is no house default anywhere in this path.
    expect(state.send).toHaveBeenCalledWith('10', expectedText, proposal!.id, phone)
    expect((await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: proposal!.id } })).content).toBe(expectedText)
  })

  it('proposes nothing when the agent has no enabled lapse template', async () => {
    await template({ enabled: false })
    await lapse(firstLapse)
    expect(await runScheduledMessagePass(now)).toMatchObject({ queued: 0 })
    expect(await jobs()).toEqual([])
  })

  it('does not propose the same lapse twice', async () => {
    await template()
    await lapse(firstLapse)
    await runScheduledMessagePass(now)
    const second = await runScheduledMessagePass(now)
    expect(second.queued).toBe(0)
    expect(second.skipped).toEqual([expect.objectContaining({ candidateId: `policy:${policyId}`, reason: 'ALREADY_QUEUED' })])
    expect(await jobs()).toHaveLength(1)
  })

  it('proposes again when the same policy lapses a second time', async () => {
    await template()
    await lapse(firstLapse)
    // A provider that confirms on the spot, so the first message settles as
    // SENT. Left unconfirmed it would sit in ACCEPTED forever, and ACCEPTED is
    // an active state — the shared window would then block every later message
    // to this number and the test would be measuring that instead of the key.
    state.send.mockResolvedValue({ id: '99', sourceId: '99', status: 'SENT' })
    await runScheduledMessagePass(now)
    const [first] = await jobs()
    // Approved, sent, and the client came back — then fell out of force again.
    await approveScheduledMessages(agentId, [first!.id], now)
    await runScheduledMessagePass(now)
    expect(state.send).toHaveBeenCalledTimes(1)

    await lapse(secondLapse)
    // A week on, so the shared weekly window is not what decides this.
    const later = new Date(now.getTime() + 8 * 86_400_000)
    // `updatedAt` is stamped by Prisma's query engine off the real system
    // clock, which the fake timer above does not reach — so the sent job would
    // look like it went out seconds ago no matter what date the test claims,
    // and the weekly window, not the request key, would decide the assertion.
    // Moved by hand to where the frozen clock says it belongs.
    await prisma.kBotFollowupJob.updateMany({ where: { id: first!.id }, data: { updatedAt: now } })
    vi.setSystemTime(later)
    const report = await runScheduledMessagePass(later)
    expect(report.queued).toBe(1)
    const all = await jobs()
    expect(all).toHaveLength(2)
    expect(all.map((job) => job.requestKey)).toEqual([
      `lapse:${policyId}:${firstLapse.toISOString()}`,
      `lapse:${policyId}:${secondLapse.toISOString()}`,
    ])
    // Same candidate both times: the manual screen matches its ALREADY_PROPOSED
    // badge on this id, and it must keep matching across a second lapse.
    expect(new Set(all.map((job) => job.candidateId))).toEqual(new Set([`policy:${policyId}`]))
    expect(all[1]!.status).toBe('AWAITING_APPROVAL')
  })

  it('leaves a lapse older than the window alone', async () => {
    await template()
    await lapse(new Date(now.getTime() - LAPSE_RECENCY_MS - 86_400_000))
    expect(await runScheduledMessagePass(now)).toMatchObject({ queued: 0 })
    expect(await jobs()).toEqual([])
  })

  it('leaves a lapse with no known date alone', async () => {
    await template()
    await lapse(null)
    expect(await runScheduledMessagePass(now)).toMatchObject({ queued: 0 })
    expect(await jobs()).toEqual([])
  })
})
