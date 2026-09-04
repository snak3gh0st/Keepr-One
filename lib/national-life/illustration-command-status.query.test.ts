import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: { nationalLifeConnectorCommand: { findMany: mocks.findMany } },
}))

import { getIllustrationCommandStatuses } from './illustration-command-status'

describe('getIllustrationCommandStatuses', () => {
  it('reads only the current page IDs instead of capping a global command history', async () => {
    mocks.findMany.mockResolvedValue([
      {
        state: 'FAILED',
        deviceId: null,
        target: { kind: 'ILLUSTRATION', id: 'illustration-101' },
        safeErrorCode: 'FORESIGHT_REPORT_TIMEOUT',
        expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ])

    const result = await getIllustrationCommandStatuses('agent-1', ['illustration-101'])

    expect(result.get('illustration-101')).toEqual({
      state: 'FAILED',
      safeErrorCode: 'FORESIGHT_REPORT_TIMEOUT',
    })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agentId: 'agent-1',
        AND: expect.arrayContaining([
          { target: { path: ['kind'], equals: 'ILLUSTRATION' } },
          { OR: [{ target: { path: ['id'], equals: 'illustration-101' } }] },
        ]),
      }),
    }))
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty('take')
  })
})
