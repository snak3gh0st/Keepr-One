import { describe, expect, it, vi } from 'vitest'
import { prismaIngestDeps } from './portfolio-ingest-prisma'
import type { PlannedPolicy } from './portfolio-plan'

type UpdateManyArgs = {
  where: { sourceProvider: string; sourceExternalId: string; agentId: string }
  data: Record<string, unknown>
}

type CreateArgs = { data: Record<string, unknown> }

function policyDeps(input: {
  updateCounts?: number[]
  createError?: unknown
} = {}) {
  const counts = [...(input.updateCounts ?? [1])]
  const updateMany = vi.fn(async (args: UpdateManyArgs) => {
    void args
    return { count: counts.shift() ?? 0 }
  })
  const create = vi.fn(async (args: CreateArgs) => {
    void args
    if (input.createError) throw input.createError
    return {}
  })

  return {
    updateMany,
    create,
    deps: prismaIngestDeps({ policy: { updateMany, create } } as never),
  }
}

const planned: PlannedPolicy & { agentId: string; clientId: string } = {
  agentId: 'a1',
  clientId: 'c1',
  sourceProvider: 'NATIONAL_LIFE',
  sourceExternalId: 'LS1',
  policyNumber: 'LS1',
  carrier: 'National Life Group',
  product: 'IUL',
  status: 'INFORCE',
  sourceStatus: 'Active',
  statusChangedAt: new Date('2026-08-15T00:00:00.000Z'),
  faceAmount: null,
  premium: 1200,
  effectiveDate: null,
  clientRef: { kind: 'EXISTING', clientId: 'c1' },
}

describe('prismaIngestDeps', () => {
  it('does not let an older replay overwrite a policy from a newer verified snapshot', async () => {
    const timestamp = new Date('2026-09-04T10:00:00Z')
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const create = vi.fn()
    const findFirst = vi.fn().mockResolvedValue({ id: 'newer-policy' })
    const deps = prismaIngestDeps({ policy: { updateMany, create, findFirst } } as never)
    await deps.upsertPolicy({ ...planned, sourceObservedAt: timestamp })
    expect(updateMany.mock.calls[0][0].where).toMatchObject({
      agentId: 'a1', OR: [{ sourceUpdatedAt: null }, { sourceUpdatedAt: { lte: timestamp } }],
    })
    expect(updateMany.mock.calls[0][0].data.sourceUpdatedAt).toEqual(timestamp)
    expect(create).not.toHaveBeenCalled()
  })

  it.each([null, '123456'])('loads only the authenticated completed raw pages despite NPN metadata %s', async (npn) => {
    const findFirst = vi.fn().mockResolvedValue({
      expectedRecordCount: 2,
      receivedRecordCount: 2,
      finalSequence: 0,
      truncated: false,
      run: { rawGridPages: [{
        sequence: 0,
        recordCount: 2,
        observedAt: new Date('2026-09-04T10:00:00.000Z'),
        records: [
          { PolicyNumber: 'A-OWNED', AgentNumber: 'other-producer', PolicyStatus: 'Active' },
          { PolicyNumber: 'A-BLANK', AgentNumber: '', PolicyStatus: 'Active' },
        ],
      }] },
    })
    const normalizedFindMany = vi.fn()
    const findUnique = vi.fn().mockResolvedValue({ status: 'ACTIVE', npn })
    const deps = prismaIngestDeps({
      agent: { findUnique },
      nationalLifeConnectorStageCompletion: { findFirst },
      nationalLifeInforcePolicy: { findMany: normalizedFindMany },
    } as never)

    expect(await deps.loadInforceRows({ agentId: 'a1', deviceId: 'device-a', runId: 'run-a' }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ policyNumber: 'A-OWNED', agentNumber: 'other-producer' }),
        expect.objectContaining({ policyNumber: 'A-BLANK', agentNumber: null }),
      ]))
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deviceId: 'device-a',
        runId: 'run-a',
        gridKey: 'INFORCE_CLIENTS',
        run: expect.objectContaining({
          id: 'run-a',
          agentId: 'a1',
          connectorDeviceId: 'device-a',
          deploymentScope: 'LOCAL_CONNECTOR',
        }),
      }),
    }))
    expect(findFirst.mock.calls[0]?.[0].where.run).not.toHaveProperty('agentNumber')
    expect(normalizedFindMany).not.toHaveBeenCalled()
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'a1' }, select: { status: true } })
  })

  it('fails closed when the terminal run proof does not cover every raw page', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      expectedRecordCount: 2,
      receivedRecordCount: 2,
      finalSequence: 1,
      truncated: false,
      // This is the partial page from device/run B. It must not fall back to
      // agent-wide normalized rows written by a different run.
      run: { rawGridPages: [{
        sequence: 0,
        recordCount: 1,
        observedAt: new Date('2026-09-04T10:00:00.000Z'),
        records: [{ PolicyNumber: 'B-PARTIAL' }],
      }] },
    })
    const normalizedFindMany = vi.fn()
    const deps = prismaIngestDeps({
      agent: { findUnique: vi.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      nationalLifeConnectorStageCompletion: { findFirst },
      nationalLifeInforcePolicy: { findMany: normalizedFindMany },
    } as never)

    await expect(deps.loadInforceRows({ agentId: 'a1', deviceId: 'device-b', runId: 'run-b' }))
      .resolves.toBeNull()
    expect(normalizedFindMany).not.toHaveBeenCalled()
  })

  it.each([null, { status: 'INACTIVE', npn: '123456' }])('rejects missing/inactive agents', async (agent) => {
    const findFirst = vi.fn()
    const deps = prismaIngestDeps({ agent: { findUnique: vi.fn().mockResolvedValue(agent) },
      nationalLifeConnectorStageCompletion: { findFirst } } as never)
    expect(await deps.loadInforceRows({ agentId: 'a1', deviceId: 'device-a', runId: 'run-a' })).toBeNull()
    expect(findFirst).not.toHaveBeenCalled()
  })
  it('updates a carrier policy only when the global key and agent owner both match', async () => {
    const { deps, updateMany, create } = policyDeps()

    await deps.upsertPolicy(planned)

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceProvider: 'NATIONAL_LIFE',
          sourceExternalId: 'LS1',
          agentId: 'a1',
        },
      }),
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('creates a new carrier policy when no owned row exists', async () => {
    const { deps, create } = policyDeps({ updateCounts: [0] })

    await deps.upsertPolicy(planned)

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: 'a1',
        sourceProvider: 'NATIONAL_LIFE',
        sourceExternalId: 'LS1',
        faceAmount: null,
      }),
    })
  })

  it('does not overwrite a known face amount with null on a later sync', async () => {
    const { deps, updateMany } = policyDeps()

    await deps.upsertPolicy(planned)

    expect(updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('faceAmount')
  })

  it('carries the carrier status string through to an owned row', async () => {
    const { deps, updateMany } = policyDeps()

    await deps.upsertPolicy({ ...planned, sourceStatus: 'Pending Lapse' })

    expect(updateMany.mock.calls[0]?.[0].data.sourceStatus).toBe('Pending Lapse')
  })

  it('persists the carrier status-change date for retention follow-up', async () => {
    const existing = policyDeps()
    const fresh = policyDeps({ updateCounts: [0] })

    await existing.deps.upsertPolicy(planned)
    await fresh.deps.upsertPolicy(planned)

    expect(existing.updateMany.mock.calls[0]?.[0].data.statusChangedAt)
      .toEqual(new Date('2026-08-15T00:00:00.000Z'))
    expect(fresh.create.mock.calls[0]?.[0].data.statusChangedAt)
      .toEqual(new Date('2026-08-15T00:00:00.000Z'))
  })

  it('keeps an unknown carrier premium null instead of inventing zero', async () => {
    const existing = policyDeps()
    const fresh = policyDeps({ updateCounts: [0] })

    await existing.deps.upsertPolicy({ ...planned, premium: null })
    await fresh.deps.upsertPolicy({ ...planned, premium: null })

    expect(existing.updateMany.mock.calls[0]?.[0].data).toHaveProperty('premium', null)
    expect(fresh.create.mock.calls[0]?.[0].data).toHaveProperty('premium', null)
  })

  it('clears a stale modal frequency because the imported premium is already AAP', async () => {
    const existing = policyDeps()
    const fresh = policyDeps({ updateCounts: [0] })

    await existing.deps.upsertPolicy(planned)
    await fresh.deps.upsertPolicy(planned)

    expect(existing.updateMany.mock.calls[0]?.[0].data).toHaveProperty('premiumMode', null)
    expect(fresh.create.mock.calls[0]?.[0].data).toHaveProperty('premiumMode', null)
  })

  it('refuses to mutate a carrier policy that belongs to another agent', async () => {
    const { deps, updateMany } = policyDeps({
      updateCounts: [0, 0],
      createError: { code: 'P2002' },
    })

    await expect(deps.upsertPolicy(planned)).rejects.toThrow('POLICY_OWNERSHIP_CONFLICT')
    expect(updateMany).toHaveBeenCalledTimes(2)
  })

  it('recovers when a concurrent run creates the same policy for the same owner', async () => {
    const { deps, updateMany } = policyDeps({
      updateCounts: [0, 1],
      createError: { code: 'P2002' },
    })

    await expect(deps.upsertPolicy(planned)).resolves.toBeUndefined()
    expect(updateMany).toHaveBeenCalledTimes(2)
  })
})
