import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  getCurrentAgentWithoutOnboarding: vi.fn(),
  ensureAgentInbox: vi.fn(),
  accountFindUnique: vi.fn(),
  createSsoUrl: vi.fn(),
}))

vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/agent-context', () => ({
  getCurrentAgentWithoutOnboarding: mocks.getCurrentAgentWithoutOnboarding,
}))
vi.mock('@/lib/messaging/ensure-agent-inbox', () => ({
  ensureAgentInbox: mocks.ensureAgentInbox,
}))
vi.mock('@/lib/prisma', () => ({ prisma: { agentMessagingAccount: { findUnique: mocks.accountFindUnique } } }))
vi.mock('@/lib/messaging/chatwoot-config', () => ({
  chatwootConfigFromEnv: vi.fn(() => ({ baseUrl: 'https://chat.example.com', platformToken: 'platform' })),
}))
vi.mock('@/lib/messaging/chatwoot-client', () => ({
  createChatwootClient: vi.fn(() => ({ createSsoUrl: mocks.createSsoUrl })),
}))

import { POST } from './route'

function request() {
  return new Request('https://app.example.com/api/agent/messaging/setup-session', {
    method: 'POST', headers: { origin: 'https://app.example.com', host: 'app.example.com' },
  })
}

describe('POST /api/agent/messaging/setup-session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentAgentWithoutOnboarding.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
    mocks.ensureAgentInbox.mockResolvedValue({ created: false })
    mocks.accountFindUnique.mockResolvedValue({ externalUserId: '12' })
    mocks.createSsoUrl.mockResolvedValue('https://chat.example.com/login?token=short-lived')
  })

  it('mints the setup login only on a same-origin authenticated action', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ url: 'https://chat.example.com/login?token=short-lived' })
    expect(mocks.ensureAgentInbox).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    })
    expect(mocks.createSsoUrl).toHaveBeenCalledWith({ userId: '12' })
  })

  it('rejects cross-origin requests before reading the agent', async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('cross origin') })
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(mocks.getCurrentAgentWithoutOnboarding).not.toHaveBeenCalled()
    expect(mocks.ensureAgentInbox).not.toHaveBeenCalled()
  })
})
