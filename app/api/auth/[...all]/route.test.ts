import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: {} }))
vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: vi.fn(() => ({ GET: mocks.get, POST: mocks.post })),
}))

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue(new Response('get-ok'))
  mocks.post.mockResolvedValue(new Response('post-ok'))
})

describe('Better Auth HTTP boundary', () => {
  it.each(['GET', 'POST'] as const)('keeps stock admin endpoints private over %s', async (method) => {
    const request = new Request('https://app.keeprone.com/api/auth/admin/ban-user', { method })
    const response = method === 'GET' ? await GET(request) : await POST(request)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mocks.get).not.toHaveBeenCalled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('continues forwarding regular Better Auth endpoints', async () => {
    const request = new Request('https://app.keeprone.com/api/auth/get-session')
    const response = await GET(request)

    expect(await response.text()).toBe('get-ok')
    expect(mocks.get).toHaveBeenCalledWith(request)
  })
})
