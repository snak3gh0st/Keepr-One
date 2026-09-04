import { describe, expect, it, vi } from 'vitest'
import {
  NATIONAL_LIFE_EXPORT_CHUNK_BYTES,
  NATIONAL_LIFE_EXPORT_CONTENT_TYPE,
  NationalLifeExportUploadError,
  beginNationalLifeExportUpload,
  completeNationalLifeExportUpload,
  exportChunkLayout,
  putNationalLifeExportChunk,
} from './export-upload-service'

describe('National Life export upload layout', () => {
  it('keeps every binary chunk at or below one MiB', () => {
    const bytes = NATIONAL_LIFE_EXPORT_CHUNK_BYTES * 2 + 17
    expect(exportChunkLayout(bytes, 0)).toMatchObject({ byteOffset: 0, byteLength: NATIONAL_LIFE_EXPORT_CHUNK_BYTES, totalChunks: 3 })
    expect(exportChunkLayout(bytes, 1)).toMatchObject({ byteOffset: NATIONAL_LIFE_EXPORT_CHUNK_BYTES, byteLength: NATIONAL_LIFE_EXPORT_CHUNK_BYTES })
    expect(exportChunkLayout(bytes, 2)).toMatchObject({ byteOffset: NATIONAL_LIFE_EXPORT_CHUNK_BYTES * 2, byteLength: 17 })
  })

  it('refuses a sequence outside the declared file', () => {
    expect(() => exportChunkLayout(10, 1)).toThrowError(NationalLifeExportUploadError)
  })

  it('does not create an upload when cancellation wins the active-run lock', async () => {
    const canceled = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    const create = vi.fn()
    const tx = {
      nationalLifeSyncRun: { update: vi.fn().mockRejectedValue(canceled) },
      nationalLifeExportUpload: { findUnique: vi.fn(), create },
    }
    const db = {
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await expect(beginNationalLifeExportUpload(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-canceled',
      sourceKey: 'INFORCE_CLIENTS',
      fileName: 'NLG_InforceClientInfo_20260904.xlsx',
      contentType: NATIONAL_LIFE_EXPORT_CONTENT_TYPE,
      expectedBytes: 3,
      expectedSha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
    expect(create).not.toHaveBeenCalled()
    expect(tx.nationalLifeSyncRun.update).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'run-canceled',
        state: 'RUNNING',
        plannedGridKeys: { has: 'INFORCE_CLIENTS' },
      }),
    }))
  })

  it('returns an already completed begin request without reopening its run', async () => {
    const runUpdate = vi.fn()
    const tx = {
      nationalLifeSyncRun: { update: runUpdate },
      nationalLifeExportUpload: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'upload-complete',
          agentId: 'agent-1',
          state: 'COMPLETED',
          fileName: 'NLG_InforceClientInfo_20260904.xlsx',
          contentType: NATIONAL_LIFE_EXPORT_CONTENT_TYPE,
          expectedBytes: 3,
          expectedSha256: 'a'.repeat(64),
          totalChunks: 1,
          chunks: [],
        }),
      },
    }
    const db = {
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await expect(beginNationalLifeExportUpload(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      runId: 'run-complete',
      sourceKey: 'INFORCE_CLIENTS',
      fileName: 'NLG_InforceClientInfo_20260904.xlsx',
      contentType: NATIONAL_LIFE_EXPORT_CONTENT_TYPE,
      expectedBytes: 3,
      expectedSha256: 'a'.repeat(64),
    })).resolves.toMatchObject({
      uploadId: 'upload-complete',
      completed: true,
      duplicate: true,
    })
    expect(runUpdate).not.toHaveBeenCalled()
  })

  it('does not persist a binary chunk after its run was canceled', async () => {
    const canceled = Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    const create = vi.fn()
    const tx = {
      nationalLifeSyncRun: { update: vi.fn().mockRejectedValue(canceled) },
      nationalLifeExportChunk: { findUnique: vi.fn(), create },
      nationalLifeExportUpload: { update: vi.fn() },
    }
    const db = {
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-1',
          runId: 'run-canceled',
          sourceKey: 'INFORCE_CLIENTS',
          expectedBytes: 3,
          state: 'UPLOADING',
        }),
      },
      $transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    } as never

    await expect(putNationalLifeExportChunk(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-1',
      sequence: 0,
      bytes: new Uint8Array([1, 2, 3]),
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
    expect(create).not.toHaveBeenCalled()
    expect(tx.nationalLifeExportUpload.update).not.toHaveBeenCalled()
  })

  it('refuses completion before parsing when the upload run is no longer active', async () => {
    const db = {
      nationalLifeSyncRun: { findFirst: vi.fn().mockResolvedValue(null) },
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-1',
          agentId: 'agent-1',
          deviceId: 'device-1',
          runId: 'run-canceled',
          sourceKey: 'INFORCE_CLIENTS',
          state: 'UPLOADING',
          chunks: [],
          totalChunks: 1,
          expectedBytes: 3,
        }),
      },
    } as never

    await expect(completeNationalLifeExportUpload(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-1',
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
  })

  it('allows a completion retry to recover after its run already reached COMPLETED', async () => {
    const runFind = vi.fn().mockResolvedValue({ id: 'run-complete' })
    const db = {
      nationalLifeSyncRun: { findFirst: runFind },
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-1',
          agentId: 'agent-1',
          deviceId: 'device-1',
          runId: 'run-complete',
          sourceKey: 'INFORCE_CLIENTS',
          state: 'UPLOADING',
          chunks: [],
          totalChunks: 1,
          expectedBytes: 3,
        }),
      },
    } as never

    await expect(completeNationalLifeExportUpload(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-1',
    })).rejects.toMatchObject({ code: 'EXPORT_INCOMPLETE' })
    expect(runFind).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ state: { in: ['RUNNING', 'COMPLETED'] } }),
    }))
  })

  it('does not overwrite USER_CANCELLED when a late hash verifier loses the upload race', async () => {
    const uploadUpdateMany = vi.fn().mockResolvedValue({ count: 0 })
    const db = {
      nationalLifeSyncRun: { findFirst: vi.fn().mockResolvedValue({ id: 'run-canceled' }) },
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-canceled',
          agentId: 'agent-1',
          deviceId: 'device-1',
          runId: 'run-canceled',
          sourceKey: 'INFORCE_CLIENTS',
          state: 'UPLOADING',
          chunks: [{ sequence: 0, byteLength: 3, bytes: Buffer.from([1, 2, 3]) }],
          totalChunks: 1,
          expectedBytes: 3,
          expectedSha256: 'a'.repeat(64),
        }),
        updateMany: uploadUpdateMany,
      },
    } as never

    await expect(completeNationalLifeExportUpload(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-canceled',
    })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' })
    expect(uploadUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'upload-canceled',
        agentId: 'agent-1',
        deviceId: 'device-1',
        state: 'UPLOADING',
      },
      data: { state: 'FAILED', safeErrorCode: 'EXPORT_HASH_MISMATCH' },
    })
  })

  it('keeps completion retries idempotent after the upload is already complete', async () => {
    const runUpdate = vi.fn()
    const db = {
      nationalLifeSyncRun: { update: runUpdate },
      nationalLifeExportUpload: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'upload-complete',
          sourceKey: 'INFORCE_CLIENTS',
          state: 'COMPLETED',
          rowCount: 12,
          writtenCount: 10,
          chunks: [],
        }),
      },
    } as never

    await expect(completeNationalLifeExportUpload(db, {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-complete',
    })).resolves.toMatchObject({
      completed: true,
      duplicate: true,
      rowCount: 12,
      writtenCount: 10,
    })
    expect(runUpdate).not.toHaveBeenCalled()
  })
})
