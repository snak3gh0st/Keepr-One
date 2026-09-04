import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ candidates: [] as Array<Record<string, unknown>>, send: vi.fn(), messages: vi.fn(), providerStatus: vi.fn(), generation: vi.fn() }))
vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: process.env.KBOT_TEST_DATABASE_URL ?? 'postgresql://disabled:disabled@127.0.0.1:1/disabled' }) }
})
vi.mock('./candidates', () => ({ getFollowupCandidates: async () => state.candidates }))
vi.mock('./generation', async orig => ({ ...await orig<typeof import('./generation')>(), generateFollowup: state.generation }))
vi.mock('./transport', async importOriginal => ({ ...await importOriginal<typeof import('./transport')>(),
  messagingTransport: async () => ({ identity: 'acct:inbox:phone', conversation: async () => '10', verifyConversation: async () => {}, send: state.send, messages: state.messages, providerStatus: state.providerStatus }),
}))
import { prisma } from '@/lib/prisma'
import { startFollowups, cancelBatch } from './service'
import { creditBalance, lockAgent, settleGeneration, settleJob } from './credits'
import { processNextFollowup, reconcileFollowups, maintainFollowups } from './worker'
import { GenerationFailure } from './generation'
const url = process.env.KBOT_TEST_DATABASE_URL
const enabled = !!url && new URL(url).hostname === '127.0.0.1' && new URL(url).pathname === '/followup_test'
const agentId = `kbot-test-${randomUUID()}`
const userId = `kbot-test-${randomUUID()}`
const reset = async () => {
  await prisma.kBotCreditAllocation.deleteMany({ where: { job: { agentId } } })
  await prisma.kBotFollowupJob.deleteMany({ where: { agentId } })
  await prisma.kBotCreditGrant.deleteMany({ where: { agentId } })
  await prisma.kBotContactPreference.deleteMany({ where: { agentId } })
  await prisma.notification.deleteMany({ where: { recipientUserId: userId } })
}
const input = (ids = ['one'], key = randomUUID()) => ({ requestKey: key, language: 'PT' as const,
  candidates: ids.map(id => ({ id, fingerprint: id.padEnd(64, '0') })) })

describe.skipIf(!enabled)('follow-up PostgreSQL accounting and dispatch', () => {
  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, name: 'Teste', email: `${userId}@example.invalid`, role: 'AGENT' } })
    await prisma.agent.create({ data: { id: agentId, userId, rank: 'AGENT' } })
    vi.stubEnv('KBOT_FOLLOWUP_ENABLED', 'true'); vi.stubEnv('KBOT_FOLLOWUP_AI_ENABLED', 'true'); vi.stubEnv('OPENAI_API_KEY', 'test-never-sent')
  })
  beforeEach(async () => {
    await reset(); vi.clearAllMocks()
    vi.stubEnv('KBOT_FOLLOWUP_FREE_TOKENS', '1000')
    state.candidates = ['one', 'two'].map((id, i) => ({ id, fingerprint: id.padEnd(64, '0'), customerName: `Cliente ${i}`, phone: `+1407555010${i}`,
      subjectKey: `client:${id}`, blockedReason: null, reason: 'LAPSE_WARNING', sourceHref: '/agent/policies/test', sourceAt: new Date().toISOString() }))
    state.generation.mockResolvedValue({ content: 'Olá, Cliente. Podemos conversar?', model: 'test', inputTokens: 123, outputTokens: 11 })
    state.messages.mockResolvedValue([]); state.providerStatus.mockResolvedValue(null); state.send.mockResolvedValue({ id: '99', sourceId: null, status: null })
  })
  afterAll(async () => {
    await reset(); await prisma.agent.delete({ where: { id: agentId } }); await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect(); vi.unstubAllEnvs()
  })
  it('concurrent clicks cannot overdraw or generate a second job', async () => {
    vi.stubEnv('KBOT_FOLLOWUP_FREE_TOKENS', '192')
    const results = await Promise.allSettled([startFollowups(agentId, input()), startFollowups(agentId, input(['two']))])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.kBotFollowupJob.count({ where: { agentId } })).toBe(1)
    expect(await creditBalance(agentId)).toEqual({ available: 0, reserved: 192, spent: 0 })
  })
  it('replaying the same authorization reserves only once', async () => {
    const request = input()
    const first = await startFollowups(agentId, request)
    expect(await startFollowups(agentId, request)).toEqual(first)
    expect((await creditBalance(agentId)).reserved).toBe(192)
  })
  it('charges actual tokens and releases unused reservation before delivery', async () => {
    await startFollowups(agentId, input())
    await processNextFollowup()
    expect(await creditBalance(agentId)).toEqual({ available: 866, reserved: 0, spent: 134 })
    expect((await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })).status).toBe('ACCEPTED')
    expect(state.send).toHaveBeenCalledTimes(1)
  })
  it('does not resend after a timeout following dispatch', async () => {
    state.send.mockRejectedValue(new Error('timeout'))
    await startFollowups(agentId, input()); await processNextFollowup(); await processNextFollowup()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    expect(job.status).toBe('UNKNOWN'); expect(state.send).toHaveBeenCalledTimes(1)
    expect((await creditBalance(agentId)).spent).toBe(134)
  })
  it('cancels queued work and returns its full reservation exactly once', async () => {
    const { batchId } = await startFollowups(agentId, input())
    await cancelBatch(agentId, batchId); await cancelBatch(agentId, batchId)
    expect(await creditBalance(agentId)).toEqual({ available: 1000, reserved: 0, spent: 0 })
    expect(await processNextFollowup()).toBe(false)
  })
  it('can reserve from two small grants without stranding credits', async () => {
    vi.stubEnv('KBOT_FOLLOWUP_FREE_TOKENS', '100')
    await prisma.kBotCreditGrant.create({ data: { agentId, sourceKey: `paid:${randomUUID()}`, allowance: 100, expiresAt: new Date(Date.now() + 86_400_000) } })
    await startFollowups(agentId, input())
    expect((await creditBalance(agentId)).reserved).toBe(192)
    await processNextFollowup()
    expect((await creditBalance(agentId)).spent).toBe(134)
    expect((await creditBalance(agentId)).available).toBe(66)
  })
  it('provider failure never reverses tokens already used for generation', async () => {
    await startFollowups(agentId, input()); await processNextFollowup()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { updatedAt: new Date(Date.now() - 60_000) } })
    state.messages.mockResolvedValue([{ id: 99, status: 'failed' }])
    await reconcileFollowups()
    expect((await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('FAILED')
    expect((await creditBalance(agentId)).spent).toBe(134)
  })
  it('settlement is idempotent under the same agent lock', async () => {
    await startFollowups(agentId, input())
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    for (let n = 0; n < 2; n++) await prisma.$transaction(async tx => {
      await lockAgent(tx, agentId)
      const current = await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })
      await settleGeneration(tx, current, 123, 11)
    })
    await prisma.$transaction(async tx => {
      await lockAgent(tx, agentId)
      await settleJob(tx, await tx.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } }), 'FAILED')
    })
    expect((await creditBalance(agentId)).spent).toBe(134)
  })
  it('cancellation during generation bills actual tokens but prevents dispatch', async () => {
    const { batchId } = await startFollowups(agentId, input())
    state.generation.mockImplementation(async () => {
      await cancelBatch(agentId, batchId)
      return { content: 'Olá.', model: 'test', inputTokens: 123, outputTokens: 11 }
    })
    await processNextFollowup()
    expect(state.send).not.toHaveBeenCalled()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    expect(job.status).toBe('CANCELLED')
    expect((await creditBalance(agentId)).spent).toBe(134)
  })
  it('a recent manual message prevents AI generation altogether', async () => {
    await startFollowups(agentId, input())
    state.messages.mockResolvedValue([{ id: 5, message_type: 1, status: 'sent', created_at: Date.now() / 1000 }])
    await processNextFollowup()
    expect(state.generation).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled()
    expect((await creditBalance(agentId)).reserved).toBe(0)
  })
  it('a changed signal after generation prevents sending but records consumed tokens', async () => {
    await startFollowups(agentId, input())
    state.generation.mockImplementation(async () => { state.candidates = []; return { content: 'Olá.', model: 'test', inputTokens: 123, outputTokens: 11 } })
    await processNextFollowup()
    expect(state.send).not.toHaveBeenCalled()
    expect((await creditBalance(agentId)).spent).toBe(134)
  })
  it('continues from sent to delivered and read without charging or sending again', async () => {
    await startFollowups(agentId, input()); await processNextFollowup()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    for (const status of ['sent', 'delivered', 'read']) {
      await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { updatedAt: new Date(Date.now() - 60_000) } })
      state.messages.mockResolvedValue([{ id: 99, source_id: 'wa-message-99', status }])
      await reconcileFollowups()
      expect((await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(status.toUpperCase())
    }
    expect(state.send).toHaveBeenCalledTimes(1)
    expect((await creditBalance(agentId)).spent).toBe(134)
  })
  it('reconciles an exact provider receipt when Chatwoot has no source id', async () => {
    state.send.mockResolvedValue({ id: null, sourceId: 'WA-99', status: null })
    await startFollowups(agentId, input()); await processNextFollowup()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { updatedAt: new Date(Date.now() - 60_000) } })
    state.providerStatus.mockResolvedValue('DELIVERED')

    await reconcileFollowups()

    expect(await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: 'DELIVERED', providerMessageId: 'WA-99',
    })
    expect(state.send).toHaveBeenCalledTimes(1)
  })
  it('rotates a stale job when the provider repeats the same receipt', async () => {
    state.send.mockResolvedValue({ id: null, sourceId: 'WA-99', status: null })
    await startFollowups(agentId, input()); await processNextFollowup()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    const stale = new Date(Date.now() - 60_000)
    await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'SENT', updatedAt: stale } })
    state.providerStatus.mockResolvedValue('SENT')

    await reconcileFollowups()

    expect((await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })).updatedAt.getTime()).toBeGreaterThan(stale.getTime())
  })
  it('a stale reconciliation pass cannot erase a confirmed delivery', async () => {
    await startFollowups(agentId, input()); await processNextFollowup()
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { updatedAt: new Date(Date.now() - 60_000) } })
    state.messages.mockImplementation(async () => {
      await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'DELIVERED' } })
      return []
    })
    await reconcileFollowups()
    expect((await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('DELIVERED')
  })
  it('preserves an incoming opt-out beyond the provider history window', async () => {
    await startFollowups(agentId, input())
    state.messages.mockResolvedValue([{ id: 5, message_type: 0, content: 'STOP' }])
    await processNextFollowup()
    expect(state.generation).not.toHaveBeenCalled(); expect(state.send).not.toHaveBeenCalled()
    expect(await prisma.kBotContactPreference.findUnique({ where: { agentId_subjectKey: { agentId, subjectKey: '+14075550100' } } })).toMatchObject({ optedOut: true })
    state.messages.mockResolvedValue([])
    await expect(startFollowups(agentId, input())).rejects.toThrow('CONTACT_UNAVAILABLE')
  })
  it('invalid model output still settles known usage and cannot dispatch', async () => {
    await startFollowups(agentId, input())
    state.generation.mockRejectedValue(new GenerationFailure({ model: 'test', inputTokens: 123, outputTokens: 11 }))
    await processNextFollowup()
    expect(state.send).not.toHaveBeenCalled()
    expect(await creditBalance(agentId)).toEqual({ available: 866, reserved: 0, spent: 134 })
  })
  it('expired preparation releases the reservation and reports the failure', async () => {
    await startFollowups(agentId, input())
    const job = await prisma.kBotFollowupJob.findFirstOrThrow({ where: { agentId } })
    await prisma.kBotFollowupJob.update({ where: { id: job.id }, data: { status: 'PREPARING', leaseExpiresAt: new Date(Date.now() - 1_000) } })
    await maintainFollowups()
    expect((await prisma.kBotFollowupJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('FAILED')
    expect(await creditBalance(agentId)).toEqual({ available: 1000, reserved: 0, spent: 0 })
    const notification = await prisma.notification.findFirstOrThrow({ where: { recipientUserId: userId } })
    expect(notification.message).toContain('1 não enviadas')
  })
})
