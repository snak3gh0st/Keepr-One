import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { WhatsappRequestError } from '@/lib/messaging/whatsapp-client'

const mocks = vi.hoisted(() => ({
  sameOrigin: vi.fn(),
  getCurrentAgentWithoutOnboarding: vi.fn(),
  ensureAgentInbox: vi.fn(),
  accountFindUnique: vi.fn(),
  channelFindUnique: vi.fn(),
  channelUpsert: vi.fn(),
  createInstance: vi.fn(),
  fetchQrCode: vi.fn(),
  connectionState: vi.fn(),
  connectionIdentity: vi.fn(),
  logoutInstance: vi.fn(),
  enforcePrivateChatSettings: vi.fn(),
  linkToInbox: vi.fn(),
}))

vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/agent-context', () => ({
  getCurrentAgentWithoutOnboarding: mocks.getCurrentAgentWithoutOnboarding,
}))
vi.mock('@/lib/messaging/ensure-agent-inbox', () => ({
  ensureAgentInbox: mocks.ensureAgentInbox,
}))
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
      logoutInstance: mocks.logoutInstance,
      enforcePrivateChatSettings: mocks.enforcePrivateChatSettings,
      linkToInbox: mocks.linkToInbox,
    })),
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agentMessagingAccount: { findUnique: mocks.accountFindUnique },
    agentMessagingChannel: {
      findUnique: mocks.channelFindUnique,
      upsert: mocks.channelUpsert,
    },
  },
}))

import { DELETE, GET, POST } from './route'

function request() {
  return new Request('https://app.keeprone.com/api/agent/messaging/whatsapp', {
    method: 'POST',
    headers: { origin: 'https://app.keeprone.com', host: 'app.keeprone.com' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgentWithoutOnboarding.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.ensureAgentInbox.mockResolvedValue({ created: false })
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
  mocks.logoutInstance.mockResolvedValue(undefined)
  mocks.channelFindUnique.mockResolvedValue({
    provider: 'EVOLUTION',
    status: 'CONNECTED',
    normalizedPhoneE164: '+15617260051',
    evolutionInstanceName: 'agent-agent-1',
  })
  mocks.channelUpsert.mockResolvedValue({})
})

describe('agent WhatsApp ownership boundary', () => {
  it('rejects cross-origin provisioning before reading the agent', async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('bad origin') })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(mocks.getCurrentAgentWithoutOnboarding).not.toHaveBeenCalled()
    expect(mocks.ensureAgentInbox).not.toHaveBeenCalled()
  })

  it('persists the exact provider phone identity only after Chatwoot linking succeeds', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: 'open',
      status: 'CONNECTED',
      phone: '+15617260051',
    })
    expect(mocks.ensureAgentInbox).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
    })
    expect(mocks.linkToInbox).toHaveBeenCalledBefore(mocks.connectionIdentity)
    expect(mocks.channelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId_kind: { agentId: 'agent-1', kind: 'WHATSAPP' } },
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

  it('releases a stale phone identity while waiting for a new QR connection', async () => {
    mocks.connectionState.mockResolvedValueOnce('close')

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(mocks.channelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'WAITING_FOR_USER',
        normalizedPhoneE164: null,
        externalPhoneNumberId: null,
      }),
    }))
  })

  it('reports the live connected session even when the local channel record is missing', async () => {
    mocks.channelFindUnique.mockResolvedValueOnce(null)

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: 'open',
      status: 'CONNECTED',
      phone: '+15617260051',
      recorded: false,
    })
  })

  it('does not expose a stale provider identity after the session is closed', async () => {
    mocks.connectionState.mockResolvedValueOnce('close')

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      state: 'close',
      status: 'DISCONNECTED',
      phone: null,
    })
  })

  it('presents a first-time agent with no Evolution instance as ready to connect', async () => {
    mocks.connectionState.mockRejectedValueOnce(new WhatsappRequestError(404))

    const response = await GET()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: 'close',
      status: 'DISCONNECTED',
      phone: null,
      recorded: false,
    })
  })

  it('treats the Evolution 2.3.7 logout error as success only after live state is closed', async () => {
    mocks.logoutInstance.mockRejectedValueOnce(new WhatsappRequestError(500))
    mocks.connectionState.mockResolvedValueOnce('close')

    const response = await DELETE(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: 'close',
      status: 'DISCONNECTED',
    })
    expect(mocks.channelUpsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        status: 'DISCONNECTED',
        normalizedPhoneE164: null,
        externalPhoneNumberId: null,
        verifiedAt: null,
      }),
    }))
  })

  it('does not mark the channel disconnected while the provider remains open', async () => {
    mocks.connectionState.mockResolvedValueOnce('open')

    const response = await DELETE(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'DISCONNECT_FAILED' })
    expect(mocks.channelUpsert).not.toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'DISCONNECTED' }),
    }))
  })
})
