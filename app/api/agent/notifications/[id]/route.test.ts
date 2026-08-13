import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  sameOrigin: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/prisma', () => ({
  prisma: { notification: { updateMany: mocks.updateMany, findFirst: mocks.findFirst } },
}))

import { PATCH } from './route'

function request() {
  return new Request('https://app.keepr.one/api/agent/notifications/n-1', {
    method: 'PATCH',
    headers: { origin: 'https://app.keepr.one', host: 'app.keepr.one' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'user-1', role: 'AGENT' } })
  mocks.updateMany.mockResolvedValue({ count: 1 })
})

describe('mark one notification read', () => {
  it('updates atomically only inside the signed-in User.id inbox', async () => {
    const response = await PATCH(request(), { params: Promise.resolve({ id: 'n-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'n-1', recipientUserId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('returns the same 404 for another user and a missing notification', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    mocks.findFirst.mockResolvedValue(null)
    const response = await PATCH(request(), { params: Promise.resolve({ id: 'n-other' }) })
    expect(response.status).toBe(404)
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: 'n-other', recipientUserId: 'user-1' },
      select: { id: true, readAt: true },
    })
  })

  it('blocks a cross-origin mutation before session or storage', async () => {
    mocks.sameOrigin.mockImplementation(() => { throw new Error('bad origin') })
    const response = await PATCH(request(), { params: Promise.resolve({ id: 'n-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.requireRole).not.toHaveBeenCalled()
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
