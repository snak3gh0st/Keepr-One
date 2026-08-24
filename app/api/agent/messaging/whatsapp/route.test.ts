import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  getCurrentAgent: vi.fn(),
  accountFindUnique: vi.fn(),
  channelUpsert: vi.fn(),
  createInstance: vi.fn(),
  fetchQrCode: vi.fn(),
  connectionState: vi.fn(),
  connectionIdentity: vi.fn(),
  enforcePrivateChatSettings: vi.fn(),
  linkToInbox: vi.fn(),
}))

vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/messaging/whatsapp-config', () => ({
  whatsappConfigFromEnv: vi.fn(() => ({ baseUrl: 'http://evolution:8080', apiKey: 'key' })),
}))
vi.mock('@/lib/messaging/whatsapp-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messaging/whatsapp-client')>()
  return {
    ...actual,
    createWhatsappClient: vi.fn(() => ({
      createInstance: mocks.createInstance,
      fetchQrCode: mocks.fetchQrCode,
      connectionState: mocks.connectionState,
      connectionIdentity: mocks.connectionIdentity,
      enforcePrivateChatSettings: mocks.enforcePrivateChatSettings,
      linkToInbox: mocks.linkToInbox,
    })),
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentMessagingAccount: { findUnique: mocks.accountFindUnique },
    agentMessagingChannel: { upsert: mocks.channelUpsert },
  },
}))

import { POST } from './route'

function request() {
  return new Request('https://app.keeprone.com/api/agent/messaging/whatsapp', {
    method: 'POST',
    headers: { origin: 'https://app.keeprone.com', host: 'app.keeprone.com' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.accountFindUnique.mockResolvedValue({
    externalAccountId: '15',
    externalUserToken: 'user-token',
  })
  mocks.createInstance.mockResolvedValue(undefined)
  mocks.linkToInbox.mockResolvedValue(undefined)
  mocks.enforcePrivateChatSettings.mockResolvedValue(undefined)
  mocks.fetchQrCode.mockResolvedValue(null)
  mocks.connectionState.mockResolvedValue('open')
  mocks.connectionIdentity.mockResolvedValue({
    externalPhoneNumberId: '15617260051@s.whatsapp.net',
    normalizedPhoneE164: '+15617260051',
  })
  mocks.channelUpsert.mockResolvedValue({})
})

describe('agent WhatsApp ownership boundary', () => {
  it('rejects cross-origin provisioning before reading the agent', async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('bad origin') })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
  })

  it('persists the exact provider phone identity only after Chatwoot linking succeeds', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: 'open',
      status: 'CONNECTED',
      phone: '+15617260051',
    })
    expect(mocks.linkToInbox).toHaveBeenCalledBefore(mocks.connectionIdentity)
    expect(mocks.channelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'agent-1' },
      create: expect.objectContaining({
        agentId: 'agent-1',
        normalizedPhoneE164: '+15617260051',
        externalPhoneNumberId: '15617260051@s.whatsapp.net',
        status: 'CONNECTED',
      }),
    }))
  })

  it('reports Chatwoot linking failures instead of presenting the channel as connected', async () => {
    mocks.linkToInbox.mockRejectedValueOnce(new Error('WHATSAPP_REQUEST_FAILED'))

    const response = await POST(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'CONNECT_FAILED' })
    expect(mocks.connectionState).not.toHaveBeenCalled()
    expect(mocks.channelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: 'FAILED', lastErrorCode: 'CONNECT_FAILED' }),
      update: expect.objectContaining({ status: 'DEGRADED', lastErrorCode: 'CONNECT_FAILED' }),
    }))
  })

  it('rejects a phone identity already owned by another agent', async () => {
    mocks.channelUpsert.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      'duplicate phone',
      { code: 'P2002', clientVersion: '6.19.3', meta: { target: ['normalizedPhoneE164'] } },
    ))
    mocks.channelUpsert.mockResolvedValueOnce({})

    const response = await POST(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'PHONE_ALREADY_CONNECTED' })
  })
})
