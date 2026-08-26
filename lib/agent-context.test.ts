import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findAgent: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/prisma', () => ({
  prisma: { agent: { findUnique: mocks.findAgent } },
}))

import { getCurrentAgent } from './agent-context'

describe('getCurrentAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ user: { id: 'user-1', role: 'AGENT' } })
  })

  it('fails closed when the signed-in agent is inactive', async () => {
    mocks.findAgent.mockResolvedValue({
      id: 'agent-1',
      userId: 'user-1',
      parentAgentId: null,
      rank: 'Agent',
      npn: '100',
      phone: '+1 407 555 0101',
      status: 'INACTIVE',
      createdAt: new Date(),
    })

    await expect(getCurrentAgent()).rejects.toThrow(
      'Signed-in agent account is inactive',
    )
    expect(mocks.findAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ phone: true }),
      }),
    )
  })
})
