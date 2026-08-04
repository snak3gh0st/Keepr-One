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
      schemaVersion: 1,
      stages: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
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
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1' }),
        update: runUpdate,
      },
      nationalLifeConnectorStageReceipt: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(receipt),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nationalLifeCaseSnapshot: { upsert: caseUpsert },
      nationalLifeInforcePolicy: { upsert: vi.fn() },
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
        schemaVersion: 1,
        runId: 'run-1',
        gridKey: 'NEW_BUSINESS',
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 2,
        truncated: true,
        records: [{ policyNo: 'NL-123', insuredName: 'Ada Lovelace' }],
      },
    })

    expect(result.duplicate).toBe(false)
    expect(caseUpsert.mock.calls[0][0].create.raw).toEqual({})
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
        findFirst: vi.fn().mockResolvedValue({ id: 'run-1' }),
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
        schemaVersion: 1,
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
        schemaVersion: 1 as const,
        runId: 'run-1',
        gridKey: 'NEW_BUSINESS' as const,
        sequence: 0,
        observedAt: now.toISOString(),
        recordsTotal: 1,
        truncated: false,
        records: [{ policyNo: 'NL-123' }],
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
