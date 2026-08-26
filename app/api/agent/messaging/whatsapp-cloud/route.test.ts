import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgentWithoutOnboarding: vi.fn(),
  ensureAgentInbox: vi.fn(),
  accountFindUnique: vi.fn(),
  channelUpsert: vi.fn(),
  listWhatsappInboxes: vi.fn(),
  assertSameOriginAction: vi.fn(),
  mode: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({
  getCurrentAgentWithoutOnboarding: mocks.getCurrentAgentWithoutOnboarding,
}))
vi.mock('@/lib/messaging/ensure-agent-inbox', () => ({
  ensureAgentInbox: mocks.ensureAgentInbox,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentMessagingAccount: { findUnique: mocks.accountFindUnique },
    agentMessagingChannel: { upsert: mocks.channelUpsert },
  },
}))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.assertSameOriginAction }))
vi.mock('@/lib/messaging/channel-mode', () => ({ whatsappChannelModeFromEnv: mocks.mode }))
vi.mock('@/lib/messaging/chatwoot-config', () => ({
  chatwootConfigFromEnv: vi.fn(() => ({ baseUrl: 'https://chat.example.com', platformToken: 'platform' })),
}))
vi.mock('@/lib/messaging/chatwoot-client', () => ({
  createChatwootClient: vi.fn(() => ({ listWhatsappInboxes: mocks.listWhatsappInboxes })),
}))

import { POST } from './route'

function request() {
  return new Request('https://app.example.com/api/agent/messaging/whatsapp-cloud', {
    method: 'POST',
    headers: { origin: 'https://app.example.com', host: 'app.example.com' },
  })
}

describe('POST /api/agent/messaging/whatsapp-cloud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mode.mockReturnValue('META_CLOUD')
    mocks.getCurrentAgentWithoutOnboarding.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
    mocks.ensureAgentInbox.mockResolvedValue({ created: false })
    mocks.accountFindUnique.mockResolvedValue({ externalAccountId: '15', externalUserToken: 'user-token' })
    mocks.channelUpsert.mockResolvedValue({})
  })

  it('is unavailable unless the deployment selected the official transport', async () => {
    mocks.mode.mockReturnValue('EVOLUTION')
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'OFFICIAL_CHANNEL_DISABLED' })
  })

  it('persists one official inbox and its unique normalized phone', async () => {
    mocks.listWhatsappInboxes.mockResolvedValue([{
      id: '9', name: 'Meu WhatsApp', phoneNumber: '(407) 555-0123', provider: 'whatsapp_cloud',
    }])

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'CONNECTED', phone: '+4075550123' })
    expect(mocks.ensureAgentInbox).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    })
    expect(mocks.channelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        provider: 'META_CLOUD',
        normalizedPhoneE164: '+4075550123',
        externalInboxId: '15:9',
      }),
    }))
  })

  it('does not accept an Evolution or API inbox as official Meta Cloud', async () => {
    mocks.listWhatsappInboxes.mockResolvedValue([{
      id: '9', name: 'Legacy', phoneNumber: '+14075550123', provider: 'evolution',
    }])
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'WHATSAPP_INBOX_NOT_CONNECTED' })
    expect(mocks.channelUpsert).not.toHaveBeenCalled()
  })

  it('rejects more than one WhatsApp number in an agent account', async () => {
    mocks.listWhatsappInboxes.mockResolvedValue([
      { id: '9', name: 'One', phoneNumber: '+14075550123', provider: 'whatsapp_cloud' },
      { id: '10', name: 'Two', phoneNumber: '+14075550124', provider: 'whatsapp_cloud' },
    ])
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'MULTIPLE_WHATSAPP_INBOXES' })
  })
})
