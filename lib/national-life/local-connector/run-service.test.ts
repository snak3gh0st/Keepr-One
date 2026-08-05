import { describe, expect, it, vi } from 'vitest'
import {
  failLocalConnectorRun,
  ingestLocalConnectorStage,
  startLocalConnectorRun,
} from './run-service'

const now = new Date('2026-08-04T18:00:00.000Z')

describe('local connector runs', () => {
  it('creates a local run without browser jobs and reuses an active run', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'run-1' })
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'run-1' })
    const db = {
      nationalLifeSyncRun: { create, updateMany, findFirst },
    } as never

    await expect(
      startLocalConnectorRun(db, { agentId: 'agent-1', deviceId: 'device-1', now }),
    ).resolves.toEqual({
      runId: 'run-1',
      schemaVersion: 2,
      stages: [
        {
          capability: 'READ_GRID',
          params: {
            gridKey: 'NEW_BUSINESS',
            navigatePath: '/agent/book-of-business/new-business/all-new-business-cases',
          },
        },
        {
          capability: 'READ_GRID',
          params: {
            gridKey: 'INFORCE_CLIENTS',
            navigatePath: '/agent/book-of-business/inforce-book/all-clients',
          },
        },
      ],
      duplicate: false,
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
    ).resolves.toMatchObject({ runId: 'run-1', duplicate: true })
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
    expect(run.stages[0].params.gridKey).toBe('PAID_COMMISSIONS')
    expect(run.stages[0].params.navigatePath).toBe(
      '/agent/compensation/commissions/paid-commissions',
    )
  })

  it('persists the untouched carrier row', async () => {
    const caseUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run_1', totalStages: 2 }),
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
  })

  it('routes a report grid to report rows with the untouched row', async () => {
    const reportUpsert = vi.fn().mockResolvedValue({})
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run_1', totalStages: 1 }),
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

  it('rejects a grid that has no ingest destination', async () => {
    const tx = {
      nationalLifeSyncRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'run_1', totalStages: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: vi.fn() },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
      nationalLifeReportRow: { upsert: vi.fn() },
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
          recordsTotal: 0,
          truncated: false,
          records: [],
        },
      }),
    ).rejects.toThrow('No ingest route for grid COMMISSIONS_OVERVIEW')
    expect(tx.nationalLifeConnectorStageReceipt.create).not.toHaveBeenCalled()
  })

  it('does not complete a run until every grid has a non-truncated receipt', async () => {
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
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1', totalStages: 2 }),
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
          completedStages: 0,
          currentGridKey: 'NEW_BUSINESS',
          completedAt: null,
        }),
      }),
    )
  })

  it('completes only after final receipts for both grids', async () => {
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
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1', totalStages: 2 }),
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
          state: 'COMPLETED',
          completedStages: 2,
          currentGridKey: null,
          completedAt: now,
        }),
      }),
    )
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
})
