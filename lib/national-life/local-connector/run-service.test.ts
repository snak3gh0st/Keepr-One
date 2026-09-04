import { describe, expect, it, vi } from 'vitest'
import {
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
  LOCAL_CONNECTOR_DEFAULT_GRID_KEYS,
  LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS,
  LOCAL_CONNECTOR_RUN_TTL_MS,
  NATIONAL_LIFE_HISTORICAL_REPORT_GRID_KEYS,
  completeLocalConnectorStage,
  failLocalConnectorStage,
  failLocalConnectorRun,
  expireStaleLocalConnectorRuns,
  ingestLocalConnectorStage,
  startLocalConnectorRun,
} from './run-service'
import { planReadGridStages, planReadPageStages } from './capabilities'
import {
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
  NATIONAL_LIFE_PRIORITY_GRID_KEYS,
} from '../read-coverage'

const now = new Date('2026-08-04T18:00:00.000Z')

function planStageKey(stage: ReturnType<typeof planReadGridStages>[number] | { capability: 'READ_PAGE' | 'READ_EXPORT'; params: { sourceKey: string } }) {
  return stage.capability === 'READ_GRID' ? stage.params.gridKey : stage.params.sourceKey
}

function expectedDefaultStages() {
  return NATIONAL_LIFE_PRIORITY_GRID_KEYS.map((gridKey) =>
    NATIONAL_LIFE_DISCOVERY_PAGE_KEYS.includes(gridKey as (typeof NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)[number])
      ? planReadPageStages([gridKey])[0]!
      : planReadGridStages([gridKey])[0]!,
  )
}

describe('local connector runs', () => {
  it('expires stale local runs during status polling without a device filter', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })

    await expireStaleLocalConnectorRuns(
      { nationalLifeSyncRun: { updateMany } } as never,
      { agentId: 'agent-1', now },
    )

    const request = updateMany.mock.calls[0]![0]
    expect(request.where).toMatchObject({
      agentId: 'agent-1',
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      executionSource: 'LOCAL',
      provider: 'NATIONAL_LIFE',
      state: 'RUNNING',
      updatedAt: { lt: new Date(now.getTime() - LOCAL_CONNECTOR_RUN_TTL_MS) },
    })
    expect(request.where).not.toHaveProperty('connectorDeviceId')
    expect(request.data).toMatchObject({
      state: 'FAILED',
      safeErrorCode: 'LOCAL_CONNECTOR_TIMEOUT',
      completedAt: now,
      updatedAt: now,
    })
  })

  it('creates a local run without browser jobs and reuses an active run', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'run-1' })
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-1',
        state: 'RUNNING',
        plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        completedStages: 1,
        currentGridKey: 'INFORCE_CLIENTS',
      })
    const db = {
      nationalLifeSyncRun: { create, updateMany, findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toEqual({
      runId: 'run-1',
      schemaVersion: 3,
      stages: expectedDefaultStages(),
      duplicate: false,
      completedStages: 0,
      nextStageIndex: 0,
    })
    expect(create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        agentId: 'agent-1',
        connectorDeviceId: 'device-1',
        executionSource: 'LOCAL',
        state: 'RUNNING',
      }),
    )
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain('browserAutomationJob')

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({ runId: 'run-1', duplicate: true, completedStages: 1 })
  })

  it('resumes a recent failed run from its durable completed-stage cursor', async () => {
    const create = vi.fn()
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    const findFirst = vi.fn().mockResolvedValue({
      id: 'run-failed',
      state: 'FAILED',
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS', 'PAID_COMMISSIONS'],
      completedStages: 2,
    })
    const db = {
      nationalLifeSyncRun: {
        create,
        updateMany,
        findFirst,
      },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({
      runId: 'run-failed',
      duplicate: true,
      reopened: true,
      completedStages: 2,
      stages: planReadGridStages(['NEW_BUSINESS', 'INFORCE_CLIENTS', 'PAID_COMMISSIONS']),
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'run-failed', state: 'FAILED' }),
      data: expect.objectContaining({
        state: 'RUNNING',
        authState: 'READY',
        authRequiredAt: null,
        safeErrorCode: null,
        completedAt: null,
        currentGridKey: 'PAID_COMMISSIONS',
      }),
    }))
    expect(create).not.toHaveBeenCalled()
  })

  it('renews an expired login episode without losing the running checkpoint', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findFirst = vi.fn().mockResolvedValue({
      id: 'run-auth-expired',
      state: 'RUNNING',
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS', 'PAID_COMMISSIONS'],
      completedStages: 2,
      currentGridKey: 'PAID_COMMISSIONS',
      authState: 'REQUIRED',
      authRequiredAt: new Date(now.getTime() - 6 * 60_000),
      stageCompletions: [
        { gridKey: 'NEW_BUSINESS' },
        { gridKey: 'INFORCE_CLIENTS' },
      ],
      stageFailures: [],
    })
    const db = {
      nationalLifeSyncRun: { create: vi.fn(), updateMany, findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({
      runId: 'run-auth-expired',
      duplicate: true,
      reopened: true,
      completedStages: 2,
      nextStageIndex: 2,
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'run-auth-expired', state: 'RUNNING' }),
      data: expect.objectContaining({
        authState: 'READY',
        authRequiredAt: null,
        currentGridKey: 'PAID_COMMISSIONS',
      }),
    }))
  })

  it('does not renew a still-valid login episode', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const findFirst = vi.fn().mockResolvedValue({
      id: 'run-auth-current',
      state: 'RUNNING',
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
      completedStages: 1,
      currentGridKey: 'INFORCE_CLIENTS',
      authState: 'REQUIRED',
      authRequiredAt: new Date(now.getTime() - 4 * 60_000),
      stageCompletions: [{ gridKey: 'NEW_BUSINESS' }],
      stageFailures: [],
    })
    const db = {
      nationalLifeSyncRun: { create: vi.fn(), updateMany, findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({
      runId: 'run-auth-current',
      duplicate: true,
      completedStages: 1,
      nextStageIndex: 1,
    })
    expect(updateMany).toHaveBeenCalledTimes(1)
  })

  it('keeps verified failed-run checkpoints reusable for 24 hours', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-new' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst,
      },
    } as never

    await startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now })

    expect(findFirst.mock.calls[1]![0].where.OR[0]).toEqual({
      state: 'FAILED',
      updatedAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
    })
  })

  it('starts a fresh run only when a full refresh is explicitly requested', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'run-full' })
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-failed',
        state: 'FAILED',
        plannedGridKeys: ['NEW_BUSINESS'],
        completedStages: 1,
      })
    const db = {
      nationalLifeSyncRun: {
        create,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst,
      },
    } as never

    await expect(startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { forceRefresh: true },
    )).resolves.toMatchObject({ runId: 'run-full', duplicate: false, completedStages: 0 })
    expect(create).toHaveBeenCalledOnce()
  })

  it('resumes a recent failed run even when its first stage was interrupted', async () => {
    const create = vi.fn()
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    const findFirst = vi.fn().mockResolvedValue({
      id: 'run-interrupted',
      state: 'FAILED',
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
      completedStages: 0,
    })
    const db = {
      nationalLifeSyncRun: {
        create,
        updateMany,
        findFirst,
      },
    } as never

    const resumed = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { exportEnabled: true },
    )
    expect(resumed).toMatchObject({
      runId: 'run-interrupted',
      duplicate: true,
      completedStages: 0,
    })
    expect(updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        state: 'RUNNING',
        currentGridKey: 'NEW_BUSINESS',
      }),
    }))
    expect(create).not.toHaveBeenCalled()
  })

  it('orders failed retries by the greatest verified cursor before recency', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-most-progress',
        state: 'FAILED',
        plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS', 'PAID_COMMISSIONS'],
        completedStages: 2,
      })
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst,
      },
    } as never

    await startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now })

    expect(findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orderBy: [{ completedStages: 'desc' }, { createdAt: 'desc' }],
    }))
  })

  it('retries only failed sources from a partial run and keeps verified sources skipped', async () => {
    const runUpdateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    const failureUpdateMany = vi.fn().mockResolvedValue({ count: 2 })
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: runUpdateMany,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'run-partial',
            state: 'PARTIAL',
            plannedGridKeys: ['NEW_BUSINESS', 'PROJECTED_COMMISSIONS', 'INFORCE_CLIENTS'],
            completedStages: 1,
            currentGridKey: null,
            stageCompletions: [{ gridKey: 'NEW_BUSINESS' }],
            stageFailures: [
              { gridKey: 'PROJECTED_COMMISSIONS' },
              { gridKey: 'INFORCE_CLIENTS' },
            ],
          }),
      },
      nationalLifeConnectorStageFailure: { updateMany: failureUpdateMany },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    await expect(startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
    )).resolves.toMatchObject({
      runId: 'run-partial',
      nextStageIndex: 1,
      completedStages: 1,
    })
    expect(runUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        currentGridKey: 'INFORCE_CLIENTS',
        failedStages: 0,
      }),
    }))
    expect(failureUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: 'run-partial', deviceId: 'device-1', resolvedAt: null },
    }))
  })

  /// Reopening writes `failedStages: 0` for FAILED and PARTIAL alike, but only
  /// PARTIAL resolved the failure rows. A reopened FAILED run therefore reported
  /// zero failures while its unresolved rows still fed `failedKeys` on the next
  /// pass — the counter and the rows disagreeing about the same run.
  it('resolves stage failures when reopening a failed run', async () => {
    const failureUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: runUpdateMany,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'run-failed',
            state: 'FAILED',
            plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
            completedStages: 1,
            currentGridKey: null,
            stageCompletions: [{ gridKey: 'NEW_BUSINESS' }],
            stageFailures: [{ gridKey: 'INFORCE_CLIENTS' }],
          }),
      },
      nationalLifeConnectorStageFailure: { updateMany: failureUpdateMany },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    await startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now })

    expect(runUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failedStages: 0 }),
    }))
    expect(failureUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: 'run-failed', deviceId: 'device-1', resolvedAt: null },
    }))
  })

  it('repairs a stopped earning-detail run by inserting its paid-commission parent', async () => {
    const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const failureUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const oldPlan = [
      'NEW_BUSINESS',
      'RECENTLY_CLOSED',
      'INFORCE_CLIENTS',
      'COMMISSIONS_EARNING_REPORT',
      'CORRESPONDENCE',
    ] as const
    const repairedPlan = [
      'NEW_BUSINESS',
      'RECENTLY_CLOSED',
      'INFORCE_CLIENTS',
      'PAID_COMMISSIONS',
      'COMMISSIONS_EARNING_REPORT',
      'CORRESPONDENCE',
    ] as const
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: runUpdateMany,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'run-missing-parent',
            state: 'FAILED',
            plannedGridKeys: [...oldPlan],
            completedStages: 3,
            currentGridKey: 'COMMISSIONS_EARNING_REPORT',
            stageCompletions: oldPlan.slice(0, 3).map((gridKey) => ({ gridKey })),
            stageFailures: [{ gridKey: 'COMMISSIONS_EARNING_REPORT' }],
          })
          .mockResolvedValueOnce(null),
      },
      nationalLifeConnectorStageFailure: { updateMany: failureUpdateMany },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    await expect(startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: repairedPlan },
    )).resolves.toMatchObject({
      runId: 'run-missing-parent',
      completedStages: 3,
      nextStageIndex: 3,
    })
    expect(runUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({
        state: 'RUNNING',
        plannedGridKeys: repairedPlan,
        totalStages: repairedPlan.length,
        completedStages: 3,
        currentGridKey: 'PAID_COMMISSIONS',
      }),
    }))
  })

  it('reopens an earning-detail retry at paid commissions when its prerequisite is incomplete', async () => {
    const runUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const plan = [
      'NEW_BUSINESS',
      'RECENTLY_CLOSED',
      'INFORCE_CLIENTS',
      'PAID_COMMISSIONS',
      'COMMISSIONS_EARNING_REPORT',
      'CORRESPONDENCE',
    ] as const
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: runUpdateMany,
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'run-incomplete-paid-commissions',
            state: 'FAILED',
            plannedGridKeys: [...plan],
            completedStages: 3,
            currentGridKey: 'COMMISSIONS_EARNING_REPORT',
            stageCompletions: plan.slice(0, 3).map((gridKey) => ({ gridKey })),
            stageFailures: [],
          })
          .mockResolvedValueOnce(null),
      },
      nationalLifeConnectorStageFailure: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    await expect(startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: plan },
    )).resolves.toMatchObject({
      runId: 'run-incomplete-paid-commissions',
      nextStageIndex: 3,
      completedStages: 3,
    })
    expect(runUpdateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ currentGridKey: 'PAID_COMMISSIONS' }),
    }))
  })


  it('resolves failures for a deprecated source when migrating a running plan', async () => {
    const failureUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-running',
          state: 'RUNNING',
          plannedGridKeys: ['NEW_BUSINESS', 'PROJECTED_COMMISSIONS', 'INFORCE_CLIENTS'],
          completedStages: 1,
          currentGridKey: 'INFORCE_CLIENTS',
          stageCompletions: [{ gridKey: 'NEW_BUSINESS' }],
          stageFailures: [{ gridKey: 'PROJECTED_COMMISSIONS' }],
        }),
      },
      nationalLifeConnectorStageFailure: { updateMany: failureUpdateMany },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    await expect(startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
    )).resolves.toMatchObject({
      runId: 'run-running',
      stages: planReadGridStages(['NEW_BUSINESS', 'INFORCE_CLIENTS']),
      completedStages: 1,
      nextStageIndex: 1,
    })
    expect(failureUpdateMany).toHaveBeenCalledWith({
      where: {
        runId: 'run-running',
        deviceId: 'device-1',
        gridKey: { in: ['PROJECTED_COMMISSIONS'] },
        resolvedAt: null,
      },
      data: { resolvedAt: now, updatedAt: now },
    })
  })

  it('returns the next durable batch checkpoint for an interrupted stage', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-checkpoint',
        state: 'FAILED',
        plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        completedStages: 1,
        currentGridKey: 'INFORCE_CLIENTS',
      })
    const receiptFindMany = vi.fn().mockResolvedValue([
      { sequence: 0, nextOffset: 400, recordCount: 200 },
      { sequence: 1, nextOffset: 600, recordCount: 200 },
      { sequence: 2, nextOffset: 800, recordCount: 200 },
      { sequence: 3, nextOffset: 800, recordCount: 0 },
    ])
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst,
      },
      nationalLifeConnectorStageReceipt: { findMany: receiptFindMany },
    } as never

    const resumed = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { exportEnabled: true },
    )
    expect(resumed).toMatchObject({
      runId: 'run-checkpoint',
      duplicate: true,
      completedStages: 1,
      resume: { sequence: 4, offset: 800, recordCount: 600 },
    })
    expect(resumed.stages[1]?.capability).toBe('READ_GRID')
    expect(receiptFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { runId: 'run-checkpoint', gridKey: 'INFORCE_CLIENTS' },
      orderBy: { sequence: 'asc' },
    }))
  })

  /// The TTL kills a run whose in-force export never answered, leaving
  /// `currentGridKey` on INFORCE_CLIENTS with no receipts at all. Resuming with
  /// the export still enabled replays the identical hang, so stages after it are
  /// unreachable forever. Fall back to the paginated grid: the policies still
  /// land, only the contact columns are lost.
  it('falls back to the paginated grid when an in-force export left no receipts', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-hung-export',
        state: 'FAILED',
        plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        completedStages: 1,
        currentGridKey: 'INFORCE_CLIENTS',
      })
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst,
      },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    const resumed = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { exportEnabled: true },
    )

    expect(resumed.nextStageIndex).toBe(1)
    expect(resumed.stages[1]?.capability).toBe('READ_GRID')
  })

  /// Once the export stage reports its own timeout the run settles PARTIAL, not
  /// FAILED, and resume re-enters through `firstFailedIndex`. The downgrade has
  /// to key on the in-force stage having already been tried and not completed —
  /// not on which of the two terminal states the run happened to land in.
  it('falls back to the paginated grid when an in-force export already failed', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-export-failed',
        state: 'PARTIAL',
        plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        completedStages: 1,
        currentGridKey: null,
        stageCompletions: [{ gridKey: 'NEW_BUSINESS' }],
        stageFailures: [{ gridKey: 'INFORCE_CLIENTS' }],
      })
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst,
      },
      nationalLifeConnectorStageFailure: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      nationalLifeConnectorStageReceipt: { findMany: vi.fn().mockResolvedValue([]) },
    } as never

    const resumed = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { exportEnabled: true },
    )

    expect(resumed.nextStageIndex).toBe(1)
    expect(resumed.stages[1]?.capability).toBe('READ_GRID')
  })



  it('does not reopen a recently verified run and reread every source', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-complete',
        state: 'COMPLETED',
        plannedGridKeys: [...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS],
        completedStages: LOCAL_CONNECTOR_DEFAULT_GRID_KEYS.length,
        currentGridKey: null,
      })
    const create = vi.fn()
    const db = {
      nationalLifeSyncRun: { create, updateMany: vi.fn(), findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({
      runId: 'run-complete',
      duplicate: true,
      completedStages: LOCAL_CONNECTOR_DEFAULT_GRID_KEYS.length,
    })
    expect(create).not.toHaveBeenCalled()
    expect(findFirst).toHaveBeenNthCalledWith(3, expect.objectContaining({
      where: expect.objectContaining({ state: 'COMPLETED' }),
    }))
  })

  it('prefers a newer completed run over an older failed retry cursor', async () => {
    const failedAt = new Date(now.getTime() - 2 * 60 * 60_000)
    const completedAt = new Date(now.getTime() - 60 * 60_000)
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-old-failed',
        state: 'FAILED',
        plannedGridKeys: [...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS],
        completedStages: 0,
        currentGridKey: 'NEW_BUSINESS',
        completedAt: failedAt,
        updatedAt: failedAt,
      })
      .mockResolvedValueOnce({
        id: 'run-new-complete',
        state: 'COMPLETED',
        plannedGridKeys: [...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS],
        completedStages: LOCAL_CONNECTOR_DEFAULT_GRID_KEYS.length,
        currentGridKey: null,
        completedAt,
        updatedAt: completedAt,
      })
    const create = vi.fn()
    const db = {
      nationalLifeSyncRun: { create, updateMany: vi.fn(), findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({
      runId: 'run-new-complete',
      duplicate: true,
      completedStages: LOCAL_CONNECTOR_DEFAULT_GRID_KEYS.length,
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('does not reuse a completed broader run for the selected priority scope', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-full',
        state: 'COMPLETED',
        plannedGridKeys: [...LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS],
        completedStages: LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS.length,
        currentGridKey: null,
      })
    const create = vi.fn().mockResolvedValue({ id: 'run-priority' })
    const db = {
      nationalLifeSyncRun: { create, updateMany: vi.fn(), findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toMatchObject({ runId: 'run-priority', duplicate: false, completedStages: 0 })
    expect(create).toHaveBeenCalledOnce()
  })

  /// A completed run is fresh only for the exact requested plan. Serving a
  /// broader or narrower run under another denominator would either skip newly
  /// requested sources or present historical ones as part of today's scope.
  /// Only terminal runs are superseded; an in-flight one
  /// still owns its plan, because swapping stages under a navigating device is
  /// exactly what the plan-authority rule exists to prevent.
  it('supersedes a verified run whose plan predates the requested sources', async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-complete',
        state: 'COMPLETED',
        plannedGridKeys: [...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS],
        completedStages: LOCAL_CONNECTOR_DEFAULT_GRID_KEYS.length,
        currentGridKey: null,
      })
    const create = vi.fn().mockResolvedValue({ id: 'run-wide' })
    const db = {
      nationalLifeSyncRun: { create, updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst },
    } as never

    // Both flags on at once is what the rollout actually turns on, and the
    // superseding path plans from scratch instead of reusing the active run's
    // stages — so the export stage has to survive that path, not just this one.
    const run = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS, exportEnabled: true },
    )

    expect(run).toMatchObject({ runId: 'run-wide', duplicate: false, completedStages: 0 })
    expect(run.stages.map(planStageKey)).toEqual([...LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS])
    expect(create).toHaveBeenCalledTimes(1)

    const byKey = new Map(run.stages.map((stage) => [planStageKey(stage), stage.capability]))
    expect(byKey.get('INFORCE_CLIENTS')).toBe('READ_EXPORT')
    expect(byKey.get('NEW_BUSINESS')).toBe('READ_GRID')
    for (const sourceKey of NATIONAL_LIFE_DISCOVERY_PAGE_KEYS) {
      expect(byKey.get(sourceKey)).toBe('READ_PAGE')
    }
  })

  /// A failed run owns a durable cursor, so it keeps its narrower plan and
  /// resumes rather than being discarded. The widened plan reaches it one cycle
  /// later, when it completes and the branch above supersedes it.
  it('resumes a failed run on its own plan even when the request adds sources', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const findFirst = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'run-failed',
        state: 'FAILED',
        plannedGridKeys: ['NEW_BUSINESS', 'RECENTLY_CLOSED'],
        completedStages: 1,
        currentGridKey: null,
        stageCompletions: [{ gridKey: 'NEW_BUSINESS' }],
        stageFailures: [],
      })
      .mockResolvedValueOnce(null)
    const create = vi.fn()
    const db = {
      nationalLifeSyncRun: { create, updateMany, findFirst },
    } as never

    const run = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS },
    )

    expect(create).not.toHaveBeenCalled()
    expect(run).toMatchObject({ runId: 'run-failed', duplicate: true, completedStages: 1 })
    expect(run.stages.map(planStageKey)).toEqual(['NEW_BUSINESS', 'RECENTLY_CLOSED'])
    expect(run.nextStageIndex).toBe(1)
  })

  it('never swaps the plan under an in-flight run, even when sources were added', async () => {
    const create = vi.fn()
    const db = {
      nationalLifeSyncRun: {
        create,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-live',
          state: 'RUNNING',
          plannedGridKeys: [...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS],
          completedStages: 2,
          currentGridKey: 'INFORCE_CLIENTS',
        }),
      },
    } as never

    const run = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS },
    )

    expect(run.duplicate).toBe(true)
    expect(run.stages.map(planStageKey)).toEqual([...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS])
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts a grid beyond the original two', async () => {
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-2' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never

    const run = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: ['PAID_COMMISSIONS'] },
    )

    expect(run.stages).toHaveLength(1)
    expect(planStageKey(run.stages[0]!)).toBe('PAID_COMMISSIONS')
    expect(run.stages[0].params.navigatePath).toBe(
      '/agent/compensation/commissions/paid-commissions',
    )
  })

  it('persists the untouched carrier row', async () => {
    const caseUpsert = vi.fn().mockResolvedValue({})
    const rawPageUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run_1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-3',
          runId: 'run_1',
          gridKey: 'NEW_BUSINESS',
          sequence: 0,
          contentHash: 'd'.repeat(64),
          recordCount: 1,
          createdAt: now,
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: caseUpsert },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: rawPageUpsert, deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'nlc:run_1:NEW_BUSINESS:0',
      contentHash: 'd'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run_1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z',
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNo: 'X1', InsuredName: 'Maria Silva', UnknownColumn: 'keep me' }],
      },
    })

    const stored = caseUpsert.mock.calls[0][0]
    expect(stored.create.policyNo).toBe('X1')
    expect(stored.create.insuredName).toBe('Maria Silva')
    expect(stored.create.raw).toMatchObject({ UnknownColumn: 'keep me' })
    expect(stored.update.raw).toMatchObject({ UnknownColumn: 'keep me' })
    expect(rawPageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        runId: 'run_1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        recordCount: 1,
        records: [{ PolicyNo: 'X1', InsuredName: 'Maria Silva', UnknownColumn: 'keep me' }],
      }),
    }))
  })

  it('keeps the local snapshot receipt successful when promotion sync needs review', async () => {
    const caseUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run_1', plannedGridKeys: ['NEW_BUSINESS'] }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-promotion-review',
          deviceId: 'device-1',
          runId: 'run_1',
          gridKey: 'NEW_BUSINESS',
          sequence: 0,
          truncated: false,
          contentHash: '9'.repeat(64),
          recordCount: 1,
          writtenCount: 1,
          idempotencyKey: 'nlc:run_1:NEW_BUSINESS:promotion-review',
          createdAt: now,
        }),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'NEW_BUSINESS' }]),
      },
      nationalLifeCaseSnapshot: { upsert: caseUpsert },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      agent: { findMany: vi.fn().mockRejectedValue(new Error('promotion ledger unavailable')) },
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    const result = await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'nlc:run_1:NEW_BUSINESS:promotion-review',
      contentHash: '9'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run_1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z',
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNo: 'X-PROMOTION-REVIEW' }],
      },
    })

    expect(caseUpsert).toHaveBeenCalledOnce()
    expect(result).toMatchObject({
      duplicate: false,
      receipt: { writtenCount: 1 },
      promotionCredits: {
        status: 'NEEDS_REVIEW',
        skipped: { PROMOTION_WRITER_FAILED: 1 },
      },
    })
  })

  it('routes a report grid to report rows with the untouched row', async () => {
    const reportUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run_1', plannedGridKeys: ['PAID_COMMISSIONS'] }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-4',
          runId: 'run_1',
          gridKey: 'PAID_COMMISSIONS',
          sequence: 0,
          contentHash: 'e'.repeat(64),
          recordCount: 1,
          createdAt: now,
        }),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'PAID_COMMISSIONS' }]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn() },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: reportUpsert },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'PAID_COMMISSIONS',
      idempotencyKey: 'nlc:run_1:PAID_COMMISSIONS:0',
      contentHash: 'e'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run_1',
        gridKey: 'PAID_COMMISSIONS',
        sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z',
        recordsTotal: 1,
        truncated: false,
        records: [{ GlobalId: 'G1', PayDate: '2026-07-01', NLDCommEarningAmt: '123.45' }],
      },
    })

    const written = reportUpsert.mock.calls[0][0]
    expect(written.where.agentId_deploymentScope_gridKey_rowKey.gridKey).toBe('PAID_COMMISSIONS')
    expect(written.create.rowKey).toBe('G1|2026-07-01')
    expect(written.create.raw).toMatchObject({ GlobalId: 'G1' })
  })

  it('persists a captured server-rendered page only in the raw landing zone', async () => {
    const reportUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'run_1', plannedGridKeys: ['COMMISSIONS_OVERVIEW'] }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-page',
          runId: 'run_1',
          gridKey: 'COMMISSIONS_OVERVIEW',
          sequence: 0,
          contentHash: 'f'.repeat(64),
          recordCount: 1,
          writtenCount: 0,
          createdAt: now,
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn() },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: reportUpsert },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await expect(
      ingestLocalConnectorStage(db, {
        agentId: 'agent-1',
        deviceId: 'device-1',
        gridKey: 'COMMISSIONS_OVERVIEW',
        idempotencyKey: 'nlc:run_1:COMMISSIONS_OVERVIEW:0',
        contentHash: 'f'.repeat(64),
        now,
        envelope: {
          schemaVersion: 2,
          runId: 'run_1',
          gridKey: 'COMMISSIONS_OVERVIEW',
          sequence: 0,
          observedAt: '2026-08-04T00:00:00.000Z',
          recordsTotal: 1,
          truncated: false,
          records: [{ RecordType: 'PAGE_META', Title: 'Commission Overview' }],
        },
      }),
    ).resolves.toMatchObject({ duplicate: false })
    expect(reportUpsert).not.toHaveBeenCalled()
    expect(tx.nationalLifeRawGridPage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        gridKey: 'COMMISSIONS_OVERVIEW',
        records: [{ RecordType: 'PAGE_META', Title: 'Commission Overview' }],
      }),
    }))
    expect(tx.nationalLifeConnectorStageReceipt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ writtenCount: 0 }) }),
    )
  })

  it('rejects a stage for a grid the run never planned and does not complete it', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const caseUpsert = vi.fn().mockResolvedValue({})
    const reportUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        // A default run: it planned exactly NEW_BUSINESS and INFORCE_CLIENTS.
        findFirst: vi.fn().mockResolvedValue({
          id: 'run_1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: caseUpsert },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: reportUpsert },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    // The device asks the URL and the envelope to agree on a grid of its own
    // choosing. They agree — and it is still refused.
    await expect(
      ingestLocalConnectorStage(db, {
        agentId: 'agent-1',
        deviceId: 'device-1',
        gridKey: 'PAID_COMMISSIONS',
        idempotencyKey: 'nlc:run_1:PAID_COMMISSIONS:0',
        contentHash: 'a'.repeat(64),
        now,
        envelope: {
          schemaVersion: 2,
          runId: 'run_1',
          gridKey: 'PAID_COMMISSIONS',
          sequence: 0,
          observedAt: '2026-08-04T00:00:00.000Z',
          recordsTotal: 1,
          truncated: false,
          records: [{ GlobalId: 'G1', PayDate: '2026-07-01' }],
        },
      }),
    ).rejects.toThrow('GRID_NOT_PLANNED')

    expect(reportUpsert).not.toHaveBeenCalled()
    expect(tx.nationalLifeConnectorStageReceipt.create).not.toHaveBeenCalled()
    expect(runUpdate).not.toHaveBeenCalled()
  })

  it('does not let unplanned grids close a run by count alone', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run_1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-5',
          runId: 'run_1',
          gridKey: 'NEW_BUSINESS',
          sequence: 0,
          contentHash: 'b'.repeat(64),
          recordCount: 1,
          writtenCount: 1,
          createdAt: now,
        }),
        // Two finalized grids on the run — but only one of them was planned.
        // A count-based check would read 2 >= 2 and close the run.
        findMany: vi.fn().mockResolvedValue([
          { gridKey: 'NEW_BUSINESS' },
          { gridKey: 'PAID_COMMISSIONS' },
        ]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'nlc:run_1:NEW_BUSINESS:0',
      contentHash: 'b'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run_1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z',
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNo: 'X1' }],
      },
    })

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'RUNNING', currentGridKey: 'NEW_BUSINESS' }) }),
    )
  })

  it('reuses the existing run plan instead of the requested grids', async () => {
    const create = vi.fn()
    const db = {
      nationalLifeSyncRun: {
        create,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
      },
    } as never

    const run = await startLocalConnectorRun(
      db,
      { agentId: 'agent-1', deviceId: 'device-1', now },
      { gridKeys: ['PAID_COMMISSIONS'] },
    )

    expect(run.duplicate).toBe(true)
    expect(run.stages.map(planStageKey)).toEqual([
      'NEW_BUSINESS',
      'INFORCE_CLIENTS',
    ])
    expect(create).not.toHaveBeenCalled()
  })

  it('treats a run with no persisted plan as the legacy default pair', async () => {
    const db = {
      nationalLifeSyncRun: {
        create: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn().mockResolvedValue({ id: 'run-legacy', plannedGridKeys: [] }),
      },
    } as never

    const run = await startLocalConnectorRun(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      now,
    })

    expect(run.stages.map(planStageKey)).toEqual([
      'NEW_BUSINESS',
      'INFORCE_CLIENTS',
    ])
  })

  it('records zero rows written when every row fails normalization', async () => {
    const caseUpsert = vi.fn()
    const receiptCreate = vi.fn().mockResolvedValue({
      id: 'receipt-6',
      runId: 'run_1',
      gridKey: 'NEW_BUSINESS',
      sequence: 0,
      contentHash: 'c'.repeat(64),
      recordCount: 2,
      writtenCount: 0,
      createdAt: now,
    })
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run_1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: receiptCreate,
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: caseUpsert },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    // A selector drift on the extension: the rows arrive, but none carries the
    // PolicyNo the mapper keys on, so every one is dropped.
    const result = await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'nlc:run_1:NEW_BUSINESS:0',
      contentHash: 'c'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run_1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z',
        recordsTotal: 2,
        truncated: false,
        records: [{ WrongColumn: 'a' }, { WrongColumn: 'b' }],
      },
    })

    expect(caseUpsert).not.toHaveBeenCalled()
    // Received two, wrote none — the receipt says so instead of looking clean.
    expect(receiptCreate.mock.calls[0][0].data.recordCount).toBe(2)
    expect(receiptCreate.mock.calls[0][0].data.writtenCount).toBe(0)
    expect(result.receipt.writtenCount).toBe(0)
  })

  it('does not treat a truncated page receipt as a completed grid', async () => {
    const caseUpsert = vi.fn().mockResolvedValue({})
    const runUpdate = vi.fn().mockResolvedValue({})
    const receipt = {
      id: 'receipt-1',
      deviceId: 'device-1',
      runId: 'run-1',
      gridKey: 'NEW_BUSINESS',
      sequence: 0,
      truncated: true,
      contentHash: 'a'.repeat(64),
      recordCount: 1,
      idempotencyKey: 'idem-000000000001',
      createdAt: now,
      updatedAt: now,
    }
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(receipt),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: caseUpsert },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    const result = await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'idem-000000000001',
      contentHash: 'a'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run-1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 2,
        truncated: true,
        records: [{ PolicyNo: 'NL-123', InsuredName: 'Ada Lovelace' }],
      },
    })

    expect(result.duplicate).toBe(false)
    expect(caseUpsert.mock.calls[0][0].create.raw).toEqual({
      PolicyNo: 'NL-123',
      InsuredName: 'Ada Lovelace',
    })
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'RUNNING',
          currentGridKey: 'NEW_BUSINESS',
        }),
      }),
    )
  })

  it('leaves a single-grid run open when its only receipt is truncated', async () => {
    // Incomplete data must not finalize a stage. The extension sets truncated when the
    // carrier total passes its fetch ceiling and still uploads what it read; the run
    // stays RUNNING so the missing rows are not mistaken for a finished grid. This path
    // was unreachable while the server's recordsTotal cap sat below the extension's
    // ceiling — the envelope 400'd before a truncated receipt could ever be written.
    const runUpdate = vi.fn().mockResolvedValue({})
    const receiptFindMany = vi.fn().mockResolvedValue([])
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-truncated',
          deviceId: 'device-1',
          runId: 'run-1',
          gridKey: 'NEW_BUSINESS',
          sequence: 0,
          truncated: true,
          contentHash: 'd'.repeat(64),
          recordCount: 1,
          idempotencyKey: 'idem-truncated-001',
          createdAt: now,
          updatedAt: now,
        }),
        findMany: receiptFindMany,
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'idem-truncated-001',
      contentHash: 'd'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run-1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 200_000,
        truncated: true,
        records: [{ PolicyNo: 'NL-999' }],
      },
    })

    // Page upload never finalizes a grid; an explicit reconciled completion does.
    expect(receiptFindMany).not.toHaveBeenCalled()
    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'RUNNING',
          currentGridKey: 'NEW_BUSINESS',
        }),
      }),
    )
  })

  it('does not complete a run merely because the final page receipt landed', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const receipt = {
      id: 'receipt-2',
      deviceId: 'device-1',
      runId: 'run-1',
      gridKey: 'INFORCE_CLIENTS',
      sequence: 0,
      truncated: false,
      contentHash: 'c'.repeat(64),
      recordCount: 0,
      idempotencyKey: 'idem-final-inforce',
      createdAt: now,
      updatedAt: now,
    }
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(receipt),
        findMany: vi.fn().mockResolvedValue([
          { gridKey: 'NEW_BUSINESS' },
          { gridKey: 'INFORCE_CLIENTS' },
        ]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn() },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'INFORCE_CLIENTS',
      idempotencyKey: 'idem-final-inforce',
      contentHash: 'c'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run-1',
        gridKey: 'INFORCE_CLIENTS',
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 0,
        truncated: false,
        records: [],
      },
    })

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'RUNNING',
          currentGridKey: 'INFORCE_CLIENTS',
        }),
      }),
    )
  })

  it('keeps an installed pre-0.1.2 connector moving during the Store rollout', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run-legacy', plannedGridKeys: ['NEW_BUSINESS'] }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'receipt-legacy',
          runId: 'run-legacy',
          gridKey: 'NEW_BUSINESS',
          sequence: 0,
          contentHash: 'e'.repeat(64),
          recordCount: 1,
          createdAt: now,
        }),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'NEW_BUSINESS' }]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'legacy-stage-0001',
      contentHash: 'e'.repeat(64),
      now,
      legacyStageCompletion: true,
      envelope: {
        schemaVersion: 2,
        runId: 'run-legacy',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNo: 'NL-LEGACY' }],
      },
    })

    expect(runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: 'COMPLETED', completedStages: 1 }),
      }),
    )
  })

  it('rolls back a late ingest instead of reopening a run canceled after its active read', async () => {
    const canceled = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    const runUpdate = vi.fn().mockRejectedValue(canceled)
    const receiptCreate = vi.fn().mockResolvedValue({
      id: 'receipt-raced',
      deviceId: 'device-1',
      runId: 'run-raced',
      gridKey: 'NEW_BUSINESS',
      sequence: 0,
      contentHash: 'f'.repeat(64),
      recordCount: 0,
      writtenCount: 0,
      createdAt: now,
    })
    const tx = {
      nationalLifeSyncRun: {
        // The transaction observed RUNNING, then onboarding cancellation won
        // immediately before the conditional run update.
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-raced',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: receiptCreate,
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn() },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await expect(ingestLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS',
      idempotencyKey: 'nlc:run-raced:NEW_BUSINESS:0',
      contentHash: 'f'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2,
        runId: 'run-raced',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 0,
        truncated: false,
        records: [],
      },
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
    expect(receiptCreate).toHaveBeenCalledOnce()
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-raced', state: 'RUNNING' },
    }))
  })

  it('returns the original receipt only when an idempotency key has the same hash', async () => {
    const stored = {
      id: 'receipt-1',
      deviceId: 'device-1',
      runId: 'run-1',
      gridKey: 'NEW_BUSINESS',
      sequence: 0,
      truncated: false,
      contentHash: 'a'.repeat(64),
      recordCount: 1,
      idempotencyKey: 'idem-000000000001',
      createdAt: now,
      updatedAt: now,
    }
    const db = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(stored) },
      $transaction: vi.fn(),
    } as never
    const input = {
      agentId: 'agent-1',
      deviceId: 'device-1',
      gridKey: 'NEW_BUSINESS' as const,
      idempotencyKey: 'idem-000000000001',
      contentHash: 'a'.repeat(64),
      now,
      envelope: {
        schemaVersion: 2 as const,
        runId: 'run-1',
        gridKey: 'NEW_BUSINESS' as const,
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 1,
        truncated: false,
        records: [{ PolicyNo: 'NL-123' }],
      },
    }

    await expect(ingestLocalConnectorStage(db, input)).resolves.toMatchObject({
      duplicate: true,
      receipt: { receiptId: 'receipt-1' },
    })
    await expect(
      ingestLocalConnectorStage(db, { ...input, contentHash: 'b'.repeat(64) }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })

  it('puts a run from another deployment scope out of reach of every run query', async () => {
    // The stub db ignores `where`, so the only honest check is the predicate the
    // service hands Prisma: a run under another scope is excluded because the query
    // says so. All four run queries are asserted together — three siblings agreeing
    // and one not is exactly how this class of gap reappears.
    const scope = { deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE }

    const staleUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const activeFindFirst = vi.fn().mockResolvedValue(null)
    const startDb = {
      nationalLifeSyncRun: {
        create: vi.fn().mockResolvedValue({ id: 'run-1' }),
        updateMany: staleUpdateMany,
        findFirst: activeFindFirst,
      },
    } as never
    await startLocalConnectorRun(startDb, { agentId: 'agent-1', deviceId: 'device-1', now })
    // 1. failStaleLocalRuns
    expect(staleUpdateMany.mock.calls[0][0].where).toMatchObject(scope)
    // 2. active-run lookup
    expect(activeFindFirst.mock.calls[0][0].where).toMatchObject(scope)

    // 3. failLocalConnectorRun
    const failUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    await failLocalConnectorRun({ nationalLifeSyncRun: { updateMany: failUpdateMany } } as never, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      safeErrorCode: 'BRIDGE_UNAVAILABLE',
      now,
    })
    expect(failUpdateMany.mock.calls[0][0].where).toMatchObject(scope)

    // 4. ingest lookup
    const ingestFindFirst = vi.fn().mockResolvedValue(null)
    const tx = {
      nationalLifeSyncRun: { findFirst: ingestFindFirst, update: vi.fn() },
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      nationalLifeCaseSnapshot: { upsert: vi.fn() },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
      nationalLifeRawGridPage: { upsert: vi.fn(), deleteMany: vi.fn() },
    }
    const ingestDb = {
      nationalLifeConnectorStageReceipt: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never
    await expect(
      ingestLocalConnectorStage(ingestDb, {
        agentId: 'agent-1',
        deviceId: 'device-1',
        gridKey: 'NEW_BUSINESS',
        idempotencyKey: 'nlc:run-other-scope:NEW_BUSINESS:0',
        contentHash: 'a'.repeat(64),
        now,
        envelope: {
          schemaVersion: 2,
          runId: 'run-other-scope',
          gridKey: 'NEW_BUSINESS',
          sequence: 0,
          observedAt: now.toISOString(),
          recordsTotal: 0,
          truncated: false,
          records: [],
        },
      }),
    ).rejects.toThrow('RUN_NOT_FOUND')
    expect(ingestFindFirst.mock.calls[0][0].where).toMatchObject(scope)
  })

  it('fails an active local run with a safe error code', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = { nationalLifeSyncRun: { updateMany } } as never
    await expect(
      failLocalConnectorRun(db, {
        agentId: 'agent-1',
        deviceId: 'device-1',
        runId: 'run-1',
        safeErrorCode: 'BRIDGE_UNAVAILABLE',
        now,
      }),
    ).resolves.toEqual({ runId: 'run-1', state: 'FAILED' })
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: 'FAILED',
          safeErrorCode: 'BRIDGE_UNAVAILABLE',
        }),
      }),
    )
  })

  it('records one source failure and advances to the next unsettled source', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'PROJECTED_COMMISSIONS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageCompletion: {
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'NEW_BUSINESS' }]),
      },
      nationalLifeConnectorStageFailure: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'PROJECTED_COMMISSIONS' }]),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(failLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-1',
      gridKey: 'PROJECTED_COMMISSIONS',
      safeErrorCode: 'TEMPLATE_UNAVAILABLE',
      now,
    })).resolves.toMatchObject({
      state: 'RUNNING',
      nextStageIndex: 2,
      completedStages: 1,
      failedStages: 1,
      terminal: false,
    })
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        state: 'RUNNING',
        currentGridKey: 'INFORCE_CLIENTS',
      }),
    }))
  })

  it('finishes as partial only after every planned source has an outcome', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'PROJECTED_COMMISSIONS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageCompletion: {
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'NEW_BUSINESS' }]),
      },
      nationalLifeConnectorStageFailure: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'PROJECTED_COMMISSIONS' }]),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(failLocalConnectorStage(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1',
      gridKey: 'PROJECTED_COMMISSIONS', safeErrorCode: 'PORTAL_REQUEST_FAILED', now,
    })).resolves.toMatchObject({ state: 'PARTIAL', nextStageIndex: 2, terminal: true })
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        state: 'PARTIAL',
        failedStages: 1,
        currentGridKey: null,
        safeErrorCode: 'SOURCE_PARTIAL_FAILURE',
      }),
    }))
  })

  it('completes a grid only when every page sequence and the carrier total reconcile', async () => {
    const runUpdate = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-1',
          plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'receipt-0', sequence: 0, recordCount: 200,
            writtenCount: 200, duplicateCount: 0, rejectedCount: 0,
          },
          {
            id: 'receipt-1', sequence: 1, recordCount: 57,
            writtenCount: 57, duplicateCount: 0, rejectedCount: 0,
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageCompletion: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'NEW_BUSINESS' }]),
      },
      nationalLifeConnectorStageFailure: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      nationalLifeInforcePolicy: { deleteMany: vi.fn() },
      nationalLifeReportRow: { deleteMany: vi.fn() },
      nationalLifeRawGridPage: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          {
            sequence: 0,
            recordCount: 200,
            records: Array.from({ length: 200 }, (_, index) => ({ PolicyNo: `P${index}` })),
          },
          {
            sequence: 1,
            recordCount: 57,
            records: Array.from({ length: 57 }, (_, index) => ({ PolicyNo: `P${index + 199}` })),
          },
        ]),
        findFirst: vi.fn().mockResolvedValue({ observedAt: now }),
        deleteMany: vi.fn(),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(completeLocalConnectorStage(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', gridKey: 'NEW_BUSINESS',
      expectedRecordCount: 257, finalSequence: 1, truncated: false, now,
    })).resolves.toMatchObject({ completed: false, receivedRecordCount: 257 })
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        state: 'RUNNING',
        completedStages: 1,
        currentGridKey: 'INFORCE_CLIENTS',
      }),
    }))
    expect(tx.nationalLifeCaseSnapshot.deleteMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        gridKey: 'NEW_BUSINESS',
        fetchedAt: { lt: now },
      },
    })
    expect(tx.nationalLifeConnectorStageReceipt.update).toHaveBeenCalledTimes(1)
    expect(tx.nationalLifeConnectorStageReceipt.update).toHaveBeenCalledWith({
      where: { id: 'receipt-1' },
      data: { writtenCount: 56, duplicateCount: 1, rejectedCount: 0 },
    })
  })

  it('does not complete a run canceled while its final marker is reconciling', async () => {
    const canceled = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    const runUpdate = vi.fn().mockRejectedValue(canceled)
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'run-raced',
          state: 'RUNNING',
          plannedGridKeys: ['INFORCE_CLIENTS'],
          completedStages: 0,
        }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'receipt-0',
          sequence: 0,
          recordCount: 1,
          writtenCount: 1,
          duplicateCount: 0,
          rejectedCount: 0,
        }]),
        update: vi.fn(),
      },
      nationalLifeConnectorStageCompletion: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ gridKey: 'INFORCE_CLIENTS' }]),
      },
      nationalLifeConnectorStageFailure: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { deleteMany: vi.fn() },
      nationalLifeInforcePolicy: { deleteMany: vi.fn() },
      nationalLifeReportRow: { deleteMany: vi.fn() },
      nationalLifeRawGridPage: {
        findMany: vi.fn().mockResolvedValue([{
          sequence: 0,
          recordCount: 1,
          records: [{ PolicyNumber: 'P1' }],
        }]),
        findFirst: vi.fn().mockResolvedValue({ observedAt: now }),
        deleteMany: vi.fn(),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(completeLocalConnectorStage(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-raced',
      gridKey: 'INFORCE_CLIENTS',
      expectedRecordCount: 1,
      finalSequence: 0,
      truncated: false,
      now,
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
    expect(runUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-raced', state: 'RUNNING' },
      data: expect.objectContaining({ state: 'COMPLETED' }),
    }))
  })

  it.each([
    ['INFORCE_CLIENTS', 'nationalLifeInforcePolicy'],
    ['PAYABLE_GROSS_COMMISSIONS', 'nationalLifeReportRow'],
  ] as const)('prunes stale normalized rows after verifying %s', async (gridKey, targetModel) => {
    const models = {
      nationalLifeCaseSnapshot: { deleteMany: vi.fn() },
      nationalLifeInforcePolicy: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      nationalLifeReportRow: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    }
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1', plannedGridKeys: [gridKey] }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'receipt-0', sequence: 0, recordCount: 1,
          writtenCount: 1, duplicateCount: 0, rejectedCount: 0,
        }]),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageCompletion: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ gridKey }]),
      },
      nationalLifeConnectorStageFailure: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      ...models,
      nationalLifeRawGridPage: {
        findMany: vi.fn().mockResolvedValue([{
          sequence: 0,
          recordCount: 1,
          records: [{ PolicyNumber: 'P1' }],
        }]),
        findFirst: vi.fn().mockResolvedValue({ observedAt: now }),
        deleteMany: vi.fn(),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await completeLocalConnectorStage(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', gridKey,
      expectedRecordCount: 1, finalSequence: 0, truncated: false, now,
    })

    const expectedWhere = {
      agentId: 'agent-1',
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      fetchedAt: { lt: now },
      ...(targetModel === 'nationalLifeReportRow' ? { gridKey } : {}),
    }
    expect(models[targetModel].deleteMany).toHaveBeenCalledWith({ where: expectedWhere })
  })

  it.each([
    'PAID_COMMISSIONS',
    'COMMISSIONS_EARNING_REPORT',
  ] as const)('retains verified %s rows as the agent historical ledger', async (gridKey) => {
    expect(NATIONAL_LIFE_HISTORICAL_REPORT_GRID_KEYS.has(gridKey)).toBe(true)
    const deleteReportRows = vi.fn()
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1', plannedGridKeys: [gridKey] }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findMany: vi.fn().mockResolvedValue([{
          id: 'receipt-0', sequence: 0, recordCount: 1,
          writtenCount: 1, duplicateCount: 0, rejectedCount: 0,
        }]),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageCompletion: {
        upsert: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([{ gridKey }]),
      },
      nationalLifeConnectorStageFailure: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { deleteMany: vi.fn() },
      nationalLifeInforcePolicy: { deleteMany: vi.fn() },
      nationalLifeReportRow: { deleteMany: deleteReportRows },
      nationalLifeRawGridPage: {
        findMany: vi.fn().mockResolvedValue([{
          sequence: 0,
          recordCount: 1,
          records: [{
            CommissionStatementId: 'statement-1',
            PolicyNumber: 'P1',
            GrossCommEarned: '$10.00',
          }],
        }]),
        findFirst: vi.fn().mockResolvedValue({ observedAt: now }),
        deleteMany: vi.fn(),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await completeLocalConnectorStage(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', gridKey,
      expectedRecordCount: 1, finalSequence: 0, truncated: false, now,
    })

    expect(deleteReportRows).not.toHaveBeenCalled()
  })

  it('refuses a final marker when a page is missing', async () => {
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1', plannedGridKeys: ['NEW_BUSINESS'] }),
      },
      nationalLifeConnectorStageReceipt: {
        findMany: vi.fn().mockResolvedValue([{ sequence: 0, recordCount: 200 }]),
      },
    }
    const db = { $transaction: (callback: (value: typeof tx) => unknown) => callback(tx) } as never

    await expect(completeLocalConnectorStage(db, {
      agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1', gridKey: 'NEW_BUSINESS',
      expectedRecordCount: 257, finalSequence: 1, truncated: false, now,
    })).rejects.toThrow('STAGE_INCOMPLETE')
  })
})
