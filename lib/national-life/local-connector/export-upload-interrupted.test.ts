import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  completeStage: vi.fn(),
  parse: vi.fn(),
}))

vi.mock('./run-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./run-service')>()
  return {
    ...actual,
    ingestLocalConnectorStage: mocks.ingest,
    completeLocalConnectorStage: mocks.completeStage,
  }
})
vi.mock('./export-workbook', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./export-workbook')>()
  return { ...actual, parseNationalLifeInforceExport: mocks.parse }
})

import { completeNationalLifeExportUpload } from './export-upload-service'

describe('interrupted export row writing', () => {
  it('records why the upload stopped, without closing it to recovery', async () => {
    const bytes = Buffer.from('workbook')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })

    mocks.parse.mockResolvedValue({ rows: Array.from({ length: 400 }, (_, i) => ({ 'Policy #': String(i) })) })
    mocks.ingest
      .mockResolvedValueOnce({ receipt: { writtenCount: 200 } })
      .mockRejectedValueOnce(new Error('connection reset'))

    const db = {
      nationalLifeSyncRun: { findFirst: vi.fn().mockResolvedValue({ id: 'run-1' }) },
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-1', agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1',
          sourceKey: 'INFORCE_CLIENTS', state: 'UPLOADING', totalChunks: 1,
          createdAt: new Date('2026-09-17T14:39:00.000Z'),
          expectedBytes: bytes.length, expectedSha256: sha,
          chunks: [{ sequence: 0, byteLength: bytes.length, bytes }],
        }),
        updateMany,
      },
    } as never

    await expect(completeNationalLifeExportUpload(db, {
      agentId: 'agent-1', deviceId: 'device-1', uploadId: 'upload-1',
    })).rejects.toThrow('connection reset')

    // The reason is recorded so the interruption stops being silent...
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { safeErrorCode: 'EXPORT_WRITE_INTERRUPTED' },
    }))
    // ...but the upload stays UPLOADING, which is what keeps it recoverable.
    const [[call]] = updateMany.mock.calls
    expect(call.where).toMatchObject({ id: 'upload-1', state: 'UPLOADING' })
    expect(call.data).not.toHaveProperty('state')
  })

  it('stamps pages from the upload, so a retry can be recognised as a repeat', async () => {
    // The envelope is hashed into the stage receipt, and ingestion rejects a
    // repeated sequence whose hash changed. Reading the clock here would make
    // every recovery attempt collide with its own earlier try.
    const bytes = Buffer.from('workbook')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const createdAt = new Date('2026-09-17T14:39:00.000Z')

    mocks.parse.mockResolvedValue({ rows: [{ 'Policy #': '1' }] })
    mocks.ingest.mockResolvedValue({ receipt: { writtenCount: 1 } })
    mocks.completeStage.mockResolvedValue({ completed: true, terminal: true })

    const db = {
      nationalLifeSyncRun: { findFirst: vi.fn().mockResolvedValue({ id: 'run-1' }) },
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-1', agentId: 'agent-1', deviceId: 'device-1', runId: 'run-1',
          sourceKey: 'INFORCE_CLIENTS', state: 'UPLOADING', totalChunks: 1,
          createdAt,
          expectedBytes: bytes.length, expectedSha256: sha,
          chunks: [{ sequence: 0, byteLength: bytes.length, bytes }],
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      nationalLifeExportChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        nationalLifeSyncRun: { findFirst: vi.fn().mockResolvedValue({ id: 'run-1' }) },
        nationalLifeExportUpload: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn() },
        nationalLifeExportChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      })),
    } as never

    await completeNationalLifeExportUpload(db, {
      agentId: 'agent-1', deviceId: 'device-1', uploadId: 'upload-1',
    }).catch(() => undefined)

    expect(mocks.ingest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      envelope: expect.objectContaining({ observedAt: createdAt.toISOString() }),
    }))
  })
})
