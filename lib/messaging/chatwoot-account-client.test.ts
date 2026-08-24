import { describe, expect, it } from 'vitest'
import { createChatwootAccountClient } from './chatwoot-account-client'
import type { ChatwootHttp } from './chatwoot-client'

function recorder(responses: unknown[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let index = 0
  const http: ChatwootHttp = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => responses[index++] ?? {} }
  }
  return { calls, client: createChatwootAccountClient({ baseUrl: 'https://chat.example.com', http }) }
}

describe('Chatwoot account client', () => {
  it('normalizes WhatsApp, Evolution API and email inboxes', async () => {
    const { client } = recorder([{ payload: [
      { id: 1, name: 'WhatsApp Cloud', channel_type: 'Channel::Whatsapp', phone_number: '+14075550123', provider: 'whatsapp_cloud' },
      { id: 2, name: 'WhatsApp', channel_type: 'Channel::Api', callback_webhook_url: 'http://evolution:8080/chatwoot/webhook/agent-a1' },
      { id: 3, name: 'Minha caixa', channel_type: 'Channel::Email', medium: 'email', email_address: 'agent@example.com' },
    ] }])

    await expect(client.listInboxes({ accountId: '7', token: 'user-token' })).resolves.toMatchObject([
      { id: '1', kind: 'WHATSAPP' },
      { id: '2', kind: 'WHATSAPP' },
      { id: '3', kind: 'EMAIL', address: 'agent@example.com' },
    ])
  })

  it('normalizes conversations without exposing assignment fields', async () => {
    const { client, calls } = recorder([{ data: { meta: { all_count: 1 }, payload: [{
      id: 128,
      inbox_id: 2,
      status: 'open',
      unread_count: 4,
      last_activity_at: 100,
      meta: { sender: { id: 9, name: 'Alessandro', phone_number: '+14074322127' } },
      messages: [{ id: 2475, content: 'Olá', message_type: 0, created_at: 100, status: 'sent' }],
      assignee: { id: 999, name: 'must not escape' },
    }] } }])

    const result = await client.listConversations({ accountId: '7', token: 'user-token' })

    expect(result).toEqual({
      total: 1,
      conversations: [expect.objectContaining({
        id: '128', inboxId: '2', unreadCount: 4,
        contact: expect.objectContaining({ name: 'Alessandro' }),
        lastMessage: expect.objectContaining({ content: 'Olá', direction: 'INCOMING' }),
      })],
    })
    expect(JSON.stringify(result)).not.toContain('must not escape')
    expect(calls[0]?.url).toContain('assignee_type=all')
  })

  it('sends an outgoing public text through the scoped account API', async () => {
    const { client, calls } = recorder([{ id: 90, content: 'Tudo certo', message_type: 1, status: 'sent', created_at: 123 }])

    const message = await client.sendMessage({ accountId: '7', token: 'user-token', conversationId: '128', content: 'Tudo certo' })

    expect(message).toMatchObject({ content: 'Tudo certo', direction: 'OUTGOING', status: 'SENT' })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      content: 'Tudo certo', message_type: 'outgoing', private: false, content_type: 'text',
    })
    expect((calls[0]?.init.headers as Record<string, string>).api_access_token).toBe('user-token')
  })
})
