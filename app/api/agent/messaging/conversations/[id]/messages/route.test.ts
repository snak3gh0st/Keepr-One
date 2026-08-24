import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getContext: vi.fn(),
  listMessages: vi.fn(),
  sendMessage: vi.fn(),
  sameOrigin: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/messaging/agent-chatwoot-context', () => ({
  AgentMessagingUnavailableError: class AgentMessagingUnavailableError extends Error {},
  getAgentChatwootContext: mocks.getContext,
}))

import { GET, POST } from './route'

const routeContext = { params: Promise.resolve({ id: '128' }) }

function request(method = 'GET', body?: unknown) {
  return new Request('https://app.example.com/api/agent/messaging/conversations/128/messages', {
    method,
    headers: { origin: 'https://app.example.com', host: 'app.example.com', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('agent conversation messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
    mocks.getContext.mockResolvedValue({
      accountId: '15', token: 'agent-token',
      chatwoot: { listMessages: mocks.listMessages, sendMessage: mocks.sendMessage },
    })
    mocks.listMessages.mockResolvedValue([{ id: '1', content: 'Olá' }])
    mocks.sendMessage.mockResolvedValue({ id: '2', content: 'Resposta', direction: 'OUTGOING' })
  })

  it('reads through the current agent scoped account', async () => {
    const response = await GET(request(), routeContext)
    expect(response.status).toBe(200)
    expect(mocks.getContext).toHaveBeenCalledWith('agent-1')
    expect(mocks.listMessages).toHaveBeenCalledWith(expect.objectContaining({ conversationId: '128', accountId: '15' }))
  })

  it('rejects a cross-origin reply before reading agent context', async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('cross origin') })
    const response = await POST(request('POST', { content: 'Resposta' }), routeContext)
    expect(response.status).toBe(403)
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
  })

  it('sends only a validated text reply', async () => {
    const response = await POST(request('POST', { content: ' Resposta ' }), routeContext)
    expect(response.status).toBe(201)
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      accountId: '15', token: 'agent-token', conversationId: '128', content: 'Resposta',
    })
  })
})
