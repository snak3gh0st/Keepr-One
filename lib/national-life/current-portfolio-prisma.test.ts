import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCurrentNationalLifePortfolio } from './current-portfolio-prisma'
import { resetDerivationCache } from './derivation-cache'

type Page = { sequence: number; recordCount: number; observedAt: Date; records: unknown[] }

describe('loadCurrentNationalLifePortfolio', () => {
  beforeEach(() => {
    // The derived snapshot is memoized per completion id, so each case starts
    // from a cold cache rather than inheriting the previous one's rows.
    resetDerivationCache()
  })

  function db() {
    const pagesByRun: Record<string, Page[]> = {
      'run-1': [{
        sequence: 0,
        recordCount: 3,
        observedAt: new Date('2026-09-03'),
        records: [
          { 'Policy #': 'p1', Status: 'Active', 'Agent #': '123', 'Anticipated Annual Premium': 1200 },
          { 'Policy #': 'p2', Status: 'Pending Lapse', 'Agent #': '456', 'Anticipated Annual Premium': 800 },
          { 'Policy #': 'p3', Status: 'Active', 'Anticipated Annual Premium': 600 },
        ],
      }],
    }
    const findFirst = vi.fn().mockResolvedValue({ id: 'completion-1', runId: 'run-1',
      expectedRecordCount: 3, receivedRecordCount: 3, finalSequence: 0, truncated: false })
    const pageFindMany = vi.fn(async ({ where }: { where: { runId: string } }) =>
      pagesByRun[where.runId] ?? [])
    const prisma = {
      policy: { findMany: vi.fn().mockResolvedValue([{ agentId: 'a1', policyNumber: 'p1', clientId: 'c1',
        status: 'INFORCE', sourceStatus: 'Active', premium: null, sourceUpdatedAt: null }]) },
      agent: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
      nationalLifeConnectorStageCompletion: { findFirst },
      nationalLifeRawGridPage: { findMany: pageFindMany },
    }
    return { prisma, findFirst, pageFindMany, pagesByRun }
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
    expect(prisma.nationalLifeRawGridPage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: 'run-1', gridKey: 'INFORCE_CLIENTS' },
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
    const pagesByRun: Record<string, Page[]> = {}
    const completion = (runId: string, policyNumber: string, agentNumber: string | null) => {
      pagesByRun[runId] = [{
        sequence: 0,
        recordCount: 1,
        observedAt: new Date('2026-09-03'),
        records: [{ 'Policy #': policyNumber, Status: 'Active', ...(agentNumber ? { 'Agent #': agentNumber } : {}) }],
      }]
      return {
        id: `completion-${runId}`,
        runId,
        expectedRecordCount: 1,
        receivedRecordCount: 1,
        finalSequence: 0,
        truncated: false,
      }
    }
    const findFirst = vi.fn(async ({ where }: { where: { run: { agentId: string } } }) =>
      where.run.agentId === 'a1'
        ? completion('run-a1', 'owned-despite-foreign-number', '999')
        : completion('run-other', 'foreign-agent-policy', '123'),
    )
    const prisma = {
      policy: { findMany: vi.fn().mockResolvedValue([]) },
      agent: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
      nationalLifeConnectorStageCompletion: { findFirst },
      nationalLifeRawGridPage: {
        findMany: vi.fn(async ({ where }: { where: { runId: string } }) => pagesByRun[where.runId] ?? []),
      },
    }

    const result = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])

    expect(result.rows.map((row) => row.policyNumber)).toEqual(['owned-despite-foreign-number'])
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ run: { agentId: 'a1', deploymentScope: 'LOCAL_CONNECTOR' } }),
    }))
  })

  it('reuses the derived snapshot while the completion is unchanged', async () => {
    const { prisma, pageFindMany } = db()
    const first = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])
    const second = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])

    expect(pageFindMany).toHaveBeenCalledTimes(1)
    expect(second.rows).toEqual(first.rows)
    // Stored policies are still read on every call, so CRM edits stay visible
    // immediately — only the immutable carrier snapshot is memoized.
    expect(prisma.policy.findMany).toHaveBeenCalledTimes(2)
  })

  it('re-derives when a newer completion lands', async () => {
    const { prisma, findFirst, pageFindMany, pagesByRun } = db()
    await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])

    pagesByRun['run-2'] = [{
      sequence: 0,
      recordCount: 1,
      observedAt: new Date('2026-09-10'),
      records: [{ 'Policy #': 'p9', Status: 'Active', 'Anticipated Annual Premium': 4200 }],
    }]
    findFirst.mockResolvedValue({ id: 'completion-2', runId: 'run-2', expectedRecordCount: 1,
      receivedRecordCount: 1, finalSequence: 0, truncated: false })

    const after = await loadCurrentNationalLifePortfolio(prisma as never, ['a1'])
    expect(pageFindMany).toHaveBeenCalledTimes(2)
    expect(after.rows).toHaveLength(1)
    expect(after.rows[0]).toMatchObject({ premium: 4200, sourceRecordId: 'a1:policy:p9' })
  })
})
