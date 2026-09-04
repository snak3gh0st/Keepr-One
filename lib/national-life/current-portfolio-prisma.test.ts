import { describe, expect, it, vi } from 'vitest'
import { loadCurrentNationalLifePortfolio } from './current-portfolio-prisma'

describe('loadCurrentNationalLifePortfolio', () => {
  function db() {
    const findFirst = vi.fn().mockResolvedValue({ expectedRecordCount: 3, receivedRecordCount: 3,
      finalSequence: 0, truncated: false, run: { rawGridPages: [{ sequence: 0, recordCount: 3,
        observedAt: new Date('2026-09-03'), records: [
          { 'Policy #': 'p1', Status: 'Active', 'Agent #': '123', 'Anticipated Annual Premium': 1200 },
          { 'Policy #': 'p2', Status: 'Pending Lapse', 'Agent #': '456', 'Anticipated Annual Premium': 800 },
          { 'Policy #': 'p3', Status: 'Active', 'Anticipated Annual Premium': 600 },
        ],
      }] } })
    const prisma = {
      policy: { findMany: vi.fn().mockResolvedValue([{ agentId: 'a1', policyNumber: 'p1', clientId: 'c1',
        status: 'INFORCE', sourceStatus: 'Active', premium: null, sourceUpdatedAt: null }]) },
      agent: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
      nationalLifeConnectorStageCompletion: { findFirst },
    }
    return { prisma, findFirst }
  }
  it('reads completed immutable pages in the authorized partition despite carrier number differences', async () => {
    const { prisma, findFirst } = db()
    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])
    expect(result.verified).toBe(true)
    expect(result.storedPolicies).toBe(1)
    expect(result.rows).toHaveLength(3)
    expect(result.rows[0]).toMatchObject({ clientId: 'c1', premium: 1200, sourceRecordId: 'a1:policy:p1' })
    expect(result.rows[1]).toMatchObject({ clientId: null, premium: 800, sourceRecordId: 'a1:policy:p2' })
    expect(result.rows[2]).toMatchObject({ clientId: null, premium: 600, sourceRecordId: 'a1:policy:p3' })
    expect(prisma.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: { in: ['a1'] }, sourceProvider: 'NATIONAL_LIFE' },
    }))
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { gridKey: 'INFORCE_CLIENTS', truncated: false, run: { agentId: 'a1', deploymentScope: 'LOCAL_CONNECTOR' } },
      orderBy: { completedAt: 'desc' },
    }))
  })
  it('does not apply a producer filter when the agent has a configured NPN', async () => {
    const { prisma } = db()
    prisma.agent.findMany.mockResolvedValue([{ id: 'a1', npn: '123' }])

    expect((await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])).rows).toHaveLength(3)
    expect(prisma.agent.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1'] } },
      select: { id: true },
    })
  })
  it('preserves agent-qualified carrier identities for source-only rows from separate partitions', async () => {
    const { prisma } = db()
    prisma.policy.findMany.mockResolvedValue([])
    prisma.agent.findMany.mockResolvedValue([{ id: 'a1', npn: null }, { id: 'a2', npn: null }])

    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1', 'a2'])

    expect(result.rows.filter((row) => row.policyNumber === 'p1').map((row) => row.sourceRecordId))
      .toEqual(['a1:policy:p1', 'a2:policy:p1'])
  })
  it('labels the CRM-only fallback unverified when no completed export exists', async () => {
    const { prisma, findFirst } = db()
    findFirst.mockResolvedValue(null)
    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])
    expect(result.verified).toBe(false)
    expect(result.rows[0].premium).toBeNull()
  })
  it('does not read a completed page from another agent partition', async () => {
    const completion = (policyNumber: string, agentNumber: string | null) => ({
      expectedRecordCount: 1,
      receivedRecordCount: 1,
      finalSequence: 0,
      truncated: false,
      run: { rawGridPages: [{
        sequence: 0,
        recordCount: 1,
        observedAt: new Date('2026-09-03'),
        records: [{ 'Policy #': policyNumber, Status: 'Active', ...(agentNumber ? { 'Agent #': agentNumber } : {}) }],
      }] },
    })
    const findFirst = vi.fn(async ({ where }: { where: { run: { agentId: string } } }) =>
      where.run.agentId === 'a1'
        ? completion('owned-despite-foreign-number', '999')
        : completion('foreign-agent-policy', '123'),
    )
    const prisma = {
      policy: { findMany: vi.fn().mockResolvedValue([]) },
      agent: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
      nationalLifeConnectorStageCompletion: { findFirst },
    }

    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])

    expect(result.rows.map((row) => row.policyNumber)).toEqual(['owned-despite-foreign-number'])
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ run: { agentId: 'a1', deploymentScope: 'LOCAL_CONNECTOR' } }),
    }))
  })
})
