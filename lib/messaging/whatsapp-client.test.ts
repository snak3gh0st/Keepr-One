import { describe, expect, it } from 'vitest'
import {
  createWhatsappClient,
  WhatsappRequestError,
  type WhatsappHttp,
} from './whatsapp-client'

function recorder(responses: unknown[], ok = true) {
  const calls: { url: string; init: RequestInit }[] = []
  let i = 0
  const http: WhatsappHttp = async (url, init) => {
    calls.push({ url, init })
    const body = responses[i] ?? {}
    i += 1
    return { ok, status: ok ? 200 : 500, json: async () => body }
  }
  return { http, calls }
}

const config = (http: WhatsappHttp) => ({ baseUrl: 'http://evo:8080', apiKey: 'k', http })

describe('createWhatsappClient', () => {
  it('names the instance after the agent so two agents never share a session', async () => {
    const { http, calls } = recorder([{ instance: { instanceName: 'agent-a1' } }])
    await createWhatsappClient(config(http)).createInstance({ agentId: 'a1' })

    expect(calls[0]?.url).toBe('http://evo:8080/instance/create')
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      instanceName: 'agent-a1',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    })
  })

  it('authenticates every call with the api key', async () => {
    const { http, calls } = recorder([{}])
    await createWhatsappClient(config(http)).createInstance({ agentId: 'a1' })

    expect((calls[0]?.init.headers as Record<string, string>).apikey).toBe('k')
  })

  it('returns the qr code when the carrier has emitted one', async () => {
    const { http } = recorder([{ base64: 'data:image/png;base64,AAA', code: '2@abc' }])
    const qr = await createWhatsappClient(config(http)).fetchQrCode({ agentId: 'a1' })

    expect(qr).toEqual({ image: 'data:image/png;base64,AAA' })
  })

  it('reports "not ready" rather than inventing a qr that does not exist', async () => {
    // Evolution answers `{count: 0}` while the session is still starting. Treating
    // that as a failure would tell the agent it broke when it is merely early.
    const { http } = recorder([{ count: 0 }])
    const qr = await createWhatsappClient(config(http)).fetchQrCode({ agentId: 'a1' })

    expect(qr).toBeNull()
  })

  it('reads the connection state', async () => {
    const { http } = recorder([{ instance: { state: 'open' } }])
    const state = await createWhatsappClient(config(http)).connectionState({ agentId: 'a1' })

    expect(state).toBe('open')
  })

  it('fails closed when the provider response has no connection state', async () => {
    const { http } = recorder([{ instance: {} }])
    const state = await createWhatsappClient(config(http)).connectionState({ agentId: 'a1' })

    expect(state).toBe('unknown')
  })

  it('logs out the agent session without deleting its reconnectable instance', async () => {
    const { http, calls } = recorder([{ status: 'SUCCESS' }])

    await createWhatsappClient(config(http)).logoutInstance({ agentId: 'a1' })

    expect(calls[0]?.url).toBe('http://evo:8080/instance/logout/agent-a1')
    expect(calls[0]?.init.method).toBe('DELETE')
  })

  it('reads and normalizes the exact connected phone identity', async () => {
    const { http, calls } = recorder([[{
      name: 'agent-a1',
      connectionStatus: 'open',
      ownerJid: '15617260051@s.whatsapp.net',
    }]])
    const identity = await createWhatsappClient(config(http)).connectionIdentity({ agentId: 'a1' })

    expect(calls[0]?.url).toBe('http://evo:8080/instance/fetchInstances?instanceName=agent-a1')
    expect(identity).toEqual({
      externalPhoneNumberId: '15617260051@s.whatsapp.net',
      normalizedPhoneE164: '+15617260051',
    })
  })

  it('returns the exact provider reference when sending a background text', async () => {
    const { http, calls } = recorder([{
      key: { id: 'WA-123', fromMe: true, remoteJid: '14075550100@s.whatsapp.net' },
      status: 'PENDING',
    }])

    const receipt = await createWhatsappClient(config(http)).sendText({
      agentId: 'a1',
      phone: '+14075550100',
      text: 'Olá, Ana!',
    })

    expect(calls[0]?.url).toBe('http://evo:8080/message/sendText/agent-a1')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ number: '14075550100', text: 'Olá, Ana!' })
    expect(receipt).toEqual({ providerMessageId: 'WA-123', status: null })
  })

  it('reads delivery progress only for the exact provider message and recipient', async () => {
    const { http, calls } = recorder([{
      messages: {
        total: 1,
        pages: 1,
        currentPage: 1,
        records: [{
          key: { id: 'WA-123', fromMe: true, remoteJid: '14075550100@s.whatsapp.net' },
          status: 'PENDING',
          MessageUpdate: [{ status: 'SERVER_ACK' }, { status: 'DELIVERY_ACK' }],
        }],
      },
    }])

    const status = await createWhatsappClient(config(http)).messageStatus({
      agentId: 'a1',
      phone: '+14075550100',
      providerMessageId: 'WA-123',
    })

    expect(calls[0]?.url).toBe('http://evo:8080/chat/findMessages/agent-a1')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      where: { key: { id: 'WA-123', fromMe: true, remoteJid: '14075550100@s.whatsapp.net' } },
      limit: 1,
    })
    expect(status).toBe('DELIVERED')
  })

  it('does not mistake a group owner id for a phone identity', async () => {
    const { http } = recorder([[{ ownerJid: '12345@g.us' }]])

    await expect(
      createWhatsappClient(config(http)).connectionIdentity({ agentId: 'a1' }),
    ).resolves.toBeNull()
  })

  it('excludes group chats and full history from the agent inbox', async () => {
    const { http, calls } = recorder([{}])

    await createWhatsappClient(config(http)).enforcePrivateChatSettings({ agentId: 'a1' })

    expect(calls[0]?.url).toBe('http://evo:8080/settings/set/agent-a1')
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      groupsIgnore: true,
      syncFullHistory: false,
    })
  })

  it('configures one private Chatwoot inbox without history import', async () => {
    const { http, calls } = recorder([{}])
    await createWhatsappClient(config(http)).linkToInbox({
      agentId: 'a1',
      chatwootAccountId: '15',
      chatwootUserToken: 'user-token',
      chatwootUrl: 'https://chat.example.com',
    })

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      accountId: '15',
      token: 'user-token',
      url: 'https://chat.example.com',
      importContacts: false,
      importMessages: false,
      autoCreate: true,
    })
  })

  it('raises a typed error when the provider refuses', async () => {
    const { http } = recorder([{}], false)

    await expect(
      createWhatsappClient(config(http)).createInstance({ agentId: 'a1' }),
    ).rejects.toEqual(new WhatsappRequestError(500))
  })
})
