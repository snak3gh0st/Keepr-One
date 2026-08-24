import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  listInboxes: vi.fn(),
  listConversations: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/messaging/agent-chatwoot-context', () => ({
  AgentMessagingUnavailableError: class AgentMessagingUnavailableError extends Error {},
  getAgentChatwootContext: vi.fn(async () => ({
    accountId: '15',
    token: 'agent-token',
    chatwoot: { listInboxes: mocks.listInboxes, listConversations: mocks.listConversations },
  })),
}))

import { GET } from './route'

describe('GET /api/agent/messaging/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
    mocks.listInboxes.mockResolvedValue([{ id: '2', name: 'WhatsApp', kind: 'WHATSAPP' }])
    mocks.listConversations.mockResolvedValue({
      total: 2,
      conversations: [
        { id: '128', inboxId: '2' },
        { id: '999', inboxId: '77' },
      ],
    })
  })

  it('returns only conversations from an inbox in the agent account', async () => {
    const response = await GET(new Request('https://app.example.com/api/agent/messaging/conversations'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.conversations).toEqual([{ id: '128', inboxId: '2' }])
    expect(mocks.getCurrentAgent).toHaveBeenCalledOnce()
    expect(mocks.listConversations).toHaveBeenCalledWith(expect.objectContaining({
      accountId: '15', token: 'agent-token', status: 'all', page: 1,
    }))
  })
})
