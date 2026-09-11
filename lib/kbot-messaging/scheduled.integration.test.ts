import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ send: vi.fn(), messages: vi.fn() }))

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
    providerStatus: async () => null,
  }),
}))

import { prisma } from '@/lib/prisma'
import { approveScheduledMessages, discardScheduledMessages } from './approval'
import { enqueueScheduledMessagesForAgent } from './scheduled-queue'
import { processNextScheduledMessage } from './scheduled-worker'

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
