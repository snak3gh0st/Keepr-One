import { describe, expect, it, vi } from 'vitest'
import { loadCurrentNationalLifePortfolio } from './current-portfolio-prisma'

describe('loadCurrentNationalLifePortfolio', () => {
  function db(npn: string | null = null) {
    const findFirst = vi.fn().mockResolvedValue({ expectedRecordCount: 2, receivedRecordCount: 2,
      finalSequence: 0, truncated: false, run: { rawGridPages: [{ sequence: 0, recordCount: 2,
        observedAt: new Date('2026-09-03'), records: [
          { 'Policy #': 'p1', Status: 'Active', 'Agent #': '123', 'Anticipated Annual Premium': 1200 },
          { 'Policy #': 'p2', Status: 'Pending Lapse', 'Agent #': '456', 'Anticipated Annual Premium': 800 },
        ],
      }] } })
    const prisma = {
      policy: { findMany: vi.fn().mockResolvedValue([{ agentId: 'a1', policyNumber: 'p1', clientId: 'c1',
        status: 'INFORCE', sourceStatus: 'Active', premium: null, sourceUpdatedAt: null }]) },
      agent: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', npn }]) },
      nationalLifeConnectorStageCompletion: { findFirst },
    }
    return { prisma, findFirst }
  }
  it('reads completed immutable pages in the authorized partition even without NPN', async () => {
    const { prisma, findFirst } = db()
    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])
    expect(result.verified).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ clientId: 'c1', premium: 1200 })
    expect(result.rows[1]).toMatchObject({ clientId: null, premium: 800 })
    expect(prisma.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: { in: ['a1'] }, sourceProvider: 'NATIONAL_LIFE' },
    }))
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { gridKey: 'INFORCE_CLIENTS', truncated: false, run: { agentId: 'a1', deploymentScope: 'LOCAL_CONNECTOR' } },
      orderBy: { completedAt: 'desc' },
    }))
  })
  it('keeps the additional producer filter when NPN is supplied', async () => {
    const { prisma } = db('123')
    expect((await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])).rows).toHaveLength(1)
  })
  it('labels the CRM-only fallback unverified when no completed export exists', async () => {
    const { prisma, findFirst } = db()
    findFirst.mockResolvedValue(null)
    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])
    expect(result.verified).toBe(false)
    expect(result.rows[0].premium).toBeNull()
  })
})
