import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  transaction: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    notification: { findMany: mocks.findMany, count: mocks.count },
  },
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'user-exact', role: 'AGENT' } })
  mocks.findMany.mockReturnValue('find-many-query')
  mocks.count.mockReturnValue('count-query')
  mocks.transaction.mockResolvedValue([
    [
      {
        id: 'notification-1', type: 'FOLLOW_UP_DUE', title: 'Follow-up pendente',
        message: 'Faça hoje o follow-up com Ana.', href: '/agent/cases/case-1',
        caseId: 'case-1', followUpId: 'follow-1', readAt: null,
        createdAt: new Date('2026-08-11T14:00:00.000Z'),
      },
    ],
    3,
  ])
})

describe('agent notification inbox', () => {
  it('lists only the exact signed-in user inbox and returns no-store', async () => {
    const response = await GET(
      new Request('https://app.keepr.one/api/agent/notifications?limit=12'),
    )

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { recipientUserId: 'user-exact' },
      take: 12,
    }))
    expect(mocks.count).toHaveBeenCalledWith({
      where: { recipientUserId: 'user-exact', readAt: null },
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      notifications: [expect.objectContaining({
        id: 'notification-1', createdAt: '2026-08-11T14:00:00.000Z', readAt: null,
      })],
      unreadCount: 3,
    })
  })

  it('caps the inbox window and rejects an unauthenticated request', async () => {
    await GET(new Request('https://app.keepr.one/api/agent/notifications?limit=999'))
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }))

    mocks.requireRole.mockRejectedValueOnce(new Error('not authenticated'))
    const response = await GET(new Request('https://app.keepr.one/api/agent/notifications'))
    expect(response.status).toBe(401)
  })
})
