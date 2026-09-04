import { describe, expect, it, vi } from 'vitest'
import {
  advanceCaseCrmToSystemStage,
  archiveCrmStage,
  crmSystemStageForApplicationStatus,
  crmSystemStageForPolicyStatus,
  legacyCaseStateForCrmSystemKey,
  moveCaseToCrmStage,
  reorderCrmStages,
  findPipelineForAgent,
  getPipelineForAgent,
} from './pipeline'

describe('CRM and technical workflow consistency', () => {
  it('raises the legacy technical floor without regressing advanced application state', () => {
    expect(legacyCaseStateForCrmSystemKey('LEAD', 'APPLICATION')).toEqual({ stage: 'APPLICATION_STARTED', status: 'OPEN' })
    expect(legacyCaseStateForCrmSystemKey('UNDERWRITING', 'FOLLOW_UP')).toEqual({ stage: 'UNDERWRITING', status: 'OPEN' })
    expect(legacyCaseStateForCrmSystemKey('PLACED', 'LOST')).toEqual({ stage: 'PLACED', status: 'CLOSED' })
    expect(legacyCaseStateForCrmSystemKey('ISSUED', null)).toEqual({ stage: 'ISSUED', status: 'OPEN' })
  })

  it('maps carrier application states to stable CRM semantics', () => {
    expect(crmSystemStageForApplicationStatus('STARTED')).toBe('APPLICATION')
    expect(crmSystemStageForApplicationStatus('UNDERWRITING')).toBe('APPLICATION')
    expect(crmSystemStageForApplicationStatus('ISSUED')).toBe('POLICY_ISSUED')
    expect(crmSystemStageForApplicationStatus('DECLINED')).toBe('LOST')
    expect(crmSystemStageForPolicyStatus('PENDING')).toBe('POLICY_ISSUED')
    expect(crmSystemStageForPolicyStatus('INFORCE')).toBe('ACTIVE_CLIENT')
    expect(crmSystemStageForPolicyStatus('CANCELLED')).toBe('LOST')
  })

  it('does not overwrite a custom CRM stage during an automatic technical advance', async () => {
    const tx = {
      insuranceCase: {
        findFirst: vi.fn(async () => ({
          id: 'case', assignedAgentId: 'agent', crmStage: { id: 'custom', name: 'Minha etapa', systemKey: null },
        })),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'case', assignedAgentId: 'agent', crmStage: { id: 'custom', name: 'Minha etapa', systemKey: null },
        })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async () => ({ id: 'case' })),
      },
      crmStage: {
        findFirst: vi.fn(async () => ({ id: 'application', name: 'Aplicação', systemKey: 'APPLICATION' })),
        count: vi.fn(async () => 1),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      crmPipeline: {
        findUnique: vi.fn(async () => ({ id: 'pipeline' })),
        upsert: vi.fn(async () => ({ id: 'pipeline' })),
      },
      caseTimelineEvent: { create: vi.fn(async () => ({ id: 'event' })) },
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = String(query)
        return sql.includes('CrmPipeline') ? [{ id: 'pipeline' }] : [{ stage: 'DISCOVERY', status: 'OPEN' }]
      }),
    }

    const result = await advanceCaseCrmToSystemStage(tx as never, { caseId: 'case', systemKey: 'APPLICATION' })
    expect(result.moved).toBe(false)
    expect(tx.insuranceCase.update).toHaveBeenCalledWith({
      where: { id: 'case' }, data: { stage: 'APPLICATION_STARTED', status: 'OPEN' },
    })
    expect(tx.insuranceCase.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: { crmStageId: 'application' } }))
    expect(tx.caseTimelineEvent.create).not.toHaveBeenCalled()
  })

  it('reads an existing pipeline without initializing stages or backfilling cases', async () => {
    const findUnique = vi.fn(async () => ({
      id: 'pipeline-1',
      agentId: 'agent-1',
      stages: [{
        id: 'stage-1', name: 'Novo Lead', position: 0, systemKey: 'NEW_LEAD', active: true,
        _count: { cases: 2 },
      }],
    }))
    const db = {
      crmPipeline: { findUnique, upsert: vi.fn() },
      crmStage: { count: vi.fn(), createMany: vi.fn(), findFirst: vi.fn() },
      insuranceCase: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    }

    await expect(findPipelineForAgent('agent-1', db as never)).resolves.toMatchObject({
      id: 'pipeline-1', agentId: 'agent-1', stages: [{
        id: 'stage-1', name: 'Novo Lead', position: 0, systemKey: 'NEW_LEAD', active: true, caseCount: 2,
      }],
    })

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.crmPipeline.upsert).not.toHaveBeenCalled()
    expect(db.crmStage.createMany).not.toHaveBeenCalled()
    expect(db.insuranceCase.updateMany).not.toHaveBeenCalled()
  })

  it('returns null for a missing pipeline without creating it', async () => {
    const db = {
      crmPipeline: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
      crmStage: { count: vi.fn(), createMany: vi.fn(), findFirst: vi.fn() },
      insuranceCase: { updateMany: vi.fn() },
      $transaction: vi.fn(),
    }

    await expect(findPipelineForAgent('agent-1', db as never)).resolves.toBeNull()

    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.crmPipeline.upsert).not.toHaveBeenCalled()
    expect(db.crmStage.createMany).not.toHaveBeenCalled()
    expect(db.insuranceCase.updateMany).not.toHaveBeenCalled()
  })

  it('keeps normal pipeline reads lazily initializing a missing account', async () => {
    const stage = {
      id: 'stage-1', name: 'Novo Lead', position: 0, systemKey: 'NEW_LEAD', active: true,
      _count: { cases: 0 },
    }
    const transaction = {
      crmPipeline: { upsert: vi.fn(async () => ({ id: 'pipeline-1' })) },
      crmStage: {
        count: vi.fn(async () => 0),
        createMany: vi.fn(async () => ({ count: 14 })),
        findFirst: vi.fn(async () => ({ id: 'stage-1' })),
      },
      insuranceCase: { updateMany: vi.fn(async () => ({ count: 0 })) },
    }
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'pipeline-1', agentId: 'agent-1', stages: [stage] })
    const db = {
      crmPipeline: { findUnique },
      crmStage: transaction.crmStage,
      insuranceCase: transaction.insuranceCase,
      $transaction: vi.fn(async (operation) => operation(transaction)),
    }

    await expect(getPipelineForAgent('agent-1', db as never)).resolves.toMatchObject({ id: 'pipeline-1' })

    expect(db.$transaction).toHaveBeenCalledOnce()
    expect(transaction.crmPipeline.upsert).toHaveBeenCalledOnce()
    expect(transaction.crmStage.createMany).toHaveBeenCalledOnce()
    expect(transaction.insuranceCase.updateMany).toHaveBeenCalledOnce()
  })
})

describe('dynamic CRM pipeline mutations', () => {
  it('locks the pipeline and rejects a stale reorder instead of dropping a concurrent stage', async () => {
    const tx = {
      crmPipeline: { findUnique: vi.fn(async () => ({ id: 'pipeline' })) },
      crmStage: {
        findMany: vi.fn(async () => [{ id: 'one' }, { id: 'two' }, { id: 'concurrent' }]),
        update: vi.fn(async () => ({ id: 'stage' })),
      },
      $queryRaw: vi.fn(async () => [{ id: 'pipeline' }]),
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(reorderCrmStages({ agentId: 'agent', orderedStageIds: ['two', 'one'] }, db as never))
      .rejects.toMatchObject({ code: 'INVALID_STAGE_ORDER' })
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.crmStage.update).not.toHaveBeenCalled()
  })

  it('archives a semantic stage only after atomically transferring its meaning and leads', async () => {
    const writes: Array<{ id?: string; data: Record<string, unknown> }> = []
    const tx = {
      crmStage: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'source'
            ? { id: 'source', name: 'Follow-up', position: 1, systemKey: 'FOLLOW_UP', _count: { cases: 3 } }
            : { id: 'target', name: 'Contato', systemKey: null },
        ),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          writes.push({ id: where.id, data }); return { id: where.id }
        }),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { writes.push({ data }); return { count: 1 } }),
        count: vi.fn(async () => 14),
        findMany: vi.fn(async () => [
          { id: 'target' },
          { id: 'stage-2' },
        ]),
      },
      insuranceCase: {
        findMany: vi.fn(async () => [{ id: 'case-1' }, { id: 'case-2' }, { id: 'case-3' }]),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id })),
        update: vi.fn(async () => ({ id: 'case' })),
      },
      caseTimelineEvent: { createMany: vi.fn(async () => ({ count: 3 })) },
      crmPipeline: { findUnique: vi.fn(async () => ({ id: 'pipeline' })) },
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = String(query)
        return sql.includes('CrmPipeline') ? [{ id: 'pipeline' }] : [{ stage: 'LEAD', status: 'OPEN' }]
      }),
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    await expect(archiveCrmStage({ agentId: 'agent', stageId: 'source', transferToStageId: 'target' }, db as never)).resolves.toEqual({
      archivedStageId: 'source', transferredCases: 3, transferToStageId: 'target',
    })
    expect(tx.insuranceCase.update).toHaveBeenCalledTimes(3)
    expect(tx.insuranceCase.update).toHaveBeenCalledWith({ where: { id: 'case-1' }, data: { crmStageId: 'target' } })
    expect(tx.caseTimelineEvent.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ caseId: 'case-1', type: 'CRM_STAGE_CHANGED', metadata: expect.objectContaining({ reason: 'CRM_STAGE_ARCHIVED' }) }),
        expect.objectContaining({ caseId: 'case-2' }),
        expect.objectContaining({ caseId: 'case-3' }),
      ]),
    })
    expect(writes.slice(0, 2)).toEqual([
      { id: 'source', data: { systemKey: null } },
      { id: 'target', data: { systemKey: 'FOLLOW_UP' } },
    ])
  })

  it('moves only a case in the explicit agent scope and records one timeline event', async () => {
    const timelineCreate = vi.fn(async () => ({ id: 'event' }))
    const tx = {
      insuranceCase: {
        findFirst: vi.fn(async () => ({ id: 'case', assignedAgentId: 'agent', crmStage: { id: 'old', name: 'Novo Lead', systemKey: 'NEW_LEAD' } })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        update: vi.fn(async () => ({ id: 'case' })),
      },
      crmStage: {
        findFirst: vi.fn(async ({ where }: { where: { id?: string } }) =>
          where.id ? { id: 'new', name: 'Qualificado', systemKey: 'QUALIFIED' } : { id: 'initial' },
        ),
        count: vi.fn(async () => 1),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      crmPipeline: {
        findUnique: vi.fn(async () => ({ id: 'pipeline' })),
        upsert: vi.fn(async () => ({ id: 'pipeline' })),
      },
      caseTimelineEvent: { create: timelineCreate },
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = String(query)
        return sql.includes('CrmPipeline') ? [{ id: 'pipeline' }] : [{ stage: 'LEAD', status: 'OPEN' }]
      }),
    }
    const db = { $transaction: async (run: (value: typeof tx) => unknown) => run(tx) }

    const result = await moveCaseToCrmStage({ caseId: 'case', crmStageId: 'new', actorUserId: 'user', scopeAgentIds: ['agent'] }, db as never)
    expect(result).toMatchObject({ caseId: 'case', moved: true, toStage: { id: 'new' } })
    expect(tx.insuranceCase.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'case', assignedAgentId: { in: ['agent'] } },
    }))
    expect(timelineCreate).toHaveBeenCalledOnce()
    expect(tx.insuranceCase.update).toHaveBeenCalledWith({
      where: { id: 'case' }, data: { stage: 'DESIGN', status: 'OPEN' },
    })
  })
})
