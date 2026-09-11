import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  headers: vi.fn(),
  assertSameOriginAction: vi.fn(),
  revalidatePath: vi.fn(),
  send: vi.fn(),
  sendToClient: vi.fn(),
  requestUpdateMany: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.assertSameOriginAction }))
vi.mock('@/lib/kbot-illustration/delivery', () => ({ sendIllustrationRequest: mocks.send }))
vi.mock('@/lib/kbot-illustration/transport', () => ({ sendIllustrationToClient: mocks.sendToClient }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({ language: 'EN', copy: (_pt: string, en: string) => en }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { kBotIllustrationRequest: { updateMany: mocks.requestUpdateMany } },
}))

import { discardReadyIllustration, sendReadyIllustration } from './ready-to-send-actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(new Headers({ origin: 'https://app.keepr.one', host: 'app.keepr.one' }))
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.assertSameOriginAction.mockImplementation(() => {})
  mocks.send.mockResolvedValue({ ok: true })
  mocks.requestUpdateMany.mockResolvedValue({ count: 1 })
})

describe('sending a ready quote', () => {
  it('sends as the logged-in agent, never as an id from the screen', async () => {
    await expect(sendReadyIllustration({ requestId: 'req-1' })).resolves.toEqual({ ok: true })
    expect(mocks.send).toHaveBeenCalledWith(
      { agentId: 'agent-1', requestId: 'req-1' },
      mocks.sendToClient,
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/agent/illustrations')
  })

  it('refuses an agent id smuggled in the payload rather than trusting it', async () => {
    const result = await sendReadyIllustration({ requestId: 'req-1', agentId: 'agent-2' })
    expect(result.ok).toBe(false)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('refuses when the request did not come from the app itself', async () => {
    mocks.assertSameOriginAction.mockImplementation(() => { throw new Error('CROSS_ORIGIN') })
    const result = await sendReadyIllustration({ requestId: 'req-1' })
    expect(result.ok).toBe(false)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('says the client asked not to be contacted, without calling it a failure', async () => {
    mocks.send.mockResolvedValue({ ok: false, reason: 'OPTED_OUT' })
    const result = await sendReadyIllustration({ requestId: 'req-1' })
    expect(result).toEqual({
      ok: false,
      reason: 'OPTED_OUT',
      message: expect.stringContaining('asked not to be contacted'),
    })
    // The row is closed either way, so the screen has to be refreshed.
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/agent/illustrations')
  })

  it.each([
    ['NOT_READY_TO_SEND', 'already gone out'],
    ['CLIENT_UNREACHABLE', 'no WhatsApp number'],
    ['ILLUSTRATION_MISSING', 'no longer in Keeprone'],
    ['TRANSPORT_FAILED', 'did not accept the message'],
  ])('explains %s in words, not in a code', async (reason, fragment) => {
    mocks.send.mockResolvedValue({ ok: false, reason })
    const result = await sendReadyIllustration({ requestId: 'req-1' })
    expect(result).toMatchObject({ ok: false, reason })
    expect(result.ok === false && result.message).toContain(fragment)
    expect(result.ok === false && result.message).not.toContain(reason)
  })
})

describe('discarding a ready quote', () => {
  it('closes only a waiting request belonging to this agent', async () => {
    await expect(discardReadyIllustration({ requestId: 'req-1' })).resolves.toEqual({ ok: true })
    expect(mocks.requestUpdateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', agentId: 'agent-1', status: 'READY_TO_SEND' },
      data: { status: 'DISCARDED', closedAt: expect.any(Date) },
    })
  })

  it('does not claim to have discarded something that was already sent', async () => {
    mocks.requestUpdateMany.mockResolvedValue({ count: 0 })
    const result = await discardReadyIllustration({ requestId: 'req-1' })
    expect(result).toMatchObject({ ok: false, reason: 'NOT_READY_TO_SEND' })
  })
})
