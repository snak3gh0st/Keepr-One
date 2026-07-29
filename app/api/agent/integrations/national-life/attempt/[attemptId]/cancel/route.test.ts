import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/national-life/interactive-connection-service', () => ({
  cancelConnectionAttempt: mocks.cancel,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
})

describe('National Life keepalive cancellation route', () => {
  it('cancels only the route attempt owned by the current agent and returns 204', async () => {
    const request = new Request('https://app.keepr.one/api/cancel', {
      method: 'POST',
      headers: {
        origin: 'https://app.keepr.one',
        host: 'app.keepr.one',
        'x-forwarded-proto': 'https',
      },
    })
    const response = await POST(request, {
      params: Promise.resolve({ attemptId: 'attempt-1' }),
    })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.cancel).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
      attemptId: 'attempt-1',
    })
  })

  it('rejects cross-origin cancellation before mutating', async () => {
    const request = new Request('https://app.keepr.one/api/cancel', {
      method: 'POST',
      headers: {
        origin: 'https://evil.test',
        host: 'app.keepr.one',
        'x-forwarded-proto': 'https',
      },
    })
    const response = await POST(request, {
      params: Promise.resolve({ attemptId: 'attempt-1' }),
    })
    expect(response.status).toBe(403)
    expect(mocks.cancel).not.toHaveBeenCalled()
  })
})
