import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  sameOrigin: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))
vi.mock('@/lib/prisma', () => ({ prisma: { notification: { updateMany: mocks.updateMany } } }))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'user-1', role: 'AGENT' } })
  mocks.updateMany.mockResolvedValue({ count: 4 })
})

describe('mark all notifications read', () => {
  it('marks only unread notifications for the signed-in user', async () => {
    const response = await POST(new Request('https://app.keepr.one/api/agent/notifications/read-all', {
      method: 'POST', headers: { origin: 'https://app.keepr.one', host: 'app.keepr.one' },
    }))
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { recipientUserId: 'user-1', readAt: null },
      data: { readAt: expect.any(Date) },
    })
    await expect(response.json()).resolves.toEqual({
      updatedCount: 4,
      readAt: expect.any(String),
    })
  })
})
