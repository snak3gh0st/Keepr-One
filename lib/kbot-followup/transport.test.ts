import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ channel: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { agentMessagingChannel: { findUnique: mocks.channel } } }))
vi.mock('@/lib/agent-access', () => ({ getAgentAccessForAgent: async () => ({ isActive: true, enabledModules: null }) }))
vi.mock('@/lib/messaging/agent-chatwoot-context', () => ({ getAgentChatwootContext: async () => ({ accountId: '17', token: 'test-token',
  chatwoot: { listInboxes: async () => [{ id: '8', kind: 'WHATSAPP' }] },
}) }))
vi.mock('@/lib/messaging/chatwoot-config', () => ({ chatwootConfigFromEnv: () => ({ baseUrl: 'https://mock.invalid' }) }))
vi.mock('@/lib/messaging/whatsapp-config', () => ({ whatsappConfigFromEnv: () => ({ baseUrl: 'https://mock.invalid', apiKey: 'test' }) }))
vi.mock('@/lib/messaging/whatsapp-client', () => ({ createWhatsappClient: () => ({ connectionState: async () => 'open', connectionIdentity: async () => ({ normalizedPhoneE164: '+14075550001' }) }) }))
import { messagingTransport } from './transport'
beforeEach(() => { mocks.channel.mockResolvedValue({ status: 'CONNECTED', provider: 'EVOLUTION', normalizedPhoneE164: '+14075550001', externalInboxId: '8' }) })
afterEach(() => { vi.unstubAllGlobals() })
describe('scoped provider contract', () => {
  it('opens an exact matched contact without sending a message', async () => {
    const fetch = vi.fn(async (url: string) => Response.json(url.includes('/contacts/search')
      ? { payload: [{ id: 3, phone_number: '+14075550100', blocked: false }] }
      : { payload: [{ id: 10, inbox_id: 8 }] }))
    vi.stubGlobal('fetch', fetch)
    const t = await messagingTransport('agent', false)
    expect(await t.conversation('+14075550100', 'Ana')).toBe('10')
    expect(fetch.mock.calls.every(([url]) => url.includes('/accounts/17/'))).toBe(true)
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/messages'))).toBe(false)
  })
  it('fails closed for an ambiguous or blocked contact', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ payload: [{ id: 3, phone_number: '+14075550100', blocked: true }] })))
    await expect((await messagingTransport('agent', false)).conversation('+14075550100', 'Ana')).rejects.toThrow('OPTED_OUT')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ payload: [{ id: 3, phone_number: '+14075550100' }, { id: 4, phone_number: '+14075550100' }] })))
    await expect((await messagingTransport('agent', false)).conversation('+14075550100', 'Ana')).rejects.toThrow('CONTACT_AMBIGUOUS')
  })
  it('creates contact/conversation only within the selected inbox', async () => {
    const fetch = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/search')) return Response.json({ payload: [] })
      if (url.endsWith('/contacts')) return Response.json({ payload: { contact: { id: 3, phone_number: '+14075550100', contact_inboxes: [{ source_id: 'source', inbox: { id: 8 } }] } } })
      if (options?.method === 'POST') return Response.json({ id: 10 })
      return Response.json({ payload: [] })
    })
    vi.stubGlobal('fetch', fetch)
    expect(await (await messagingTransport('agent', false)).conversation('+14075550100', 'Ana')).toBe('10')
    const body = JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)
    expect(body).toMatchObject({ inbox_id: 8, contact_id: 3, source_id: 'source' })
    expect(body).not.toHaveProperty('message')
  })
  it('blocks free-text automation for Meta Cloud while allowing manual access', async () => {
    mocks.channel.mockResolvedValue({ status: 'CONNECTED', provider: 'META_CLOUD', normalizedPhoneE164: '+14075550001', externalInboxId: '8' })
    await expect(messagingTransport('agent')).rejects.toThrow('TEMPLATE_REQUIRED')
    await expect(messagingTransport('agent', false)).resolves.toHaveProperty('conversation')
  })
  it('rejects a conversation whose phone or inbox changed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ inbox_id: 99, meta: { sender: { phone_number: '+14075550100' } } })))
    await expect((await messagingTransport('agent', false)).verifyConversation('10', '+14075550100')).rejects.toThrow('CONTACT_CHANGED')
  })
})
