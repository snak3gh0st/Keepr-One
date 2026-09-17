import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  complete: vi.fn(),
}))

vi.mock('./export-upload-service', () => ({
  completeNationalLifeExportUpload: mocks.complete,
}))

import {
  authorizeExportRecoveryRequest,
  EXPORT_RECOVERY_MIN_AGE_MS,
  recoverInterruptedExportUploads,
} from './export-upload-recovery'

const NOW = new Date('2026-09-17T20:00:00.000Z')
const SECRET = 'x'.repeat(48)

function db() {
  return { nationalLifeExportUpload: { findMany: mocks.findMany } } as never
}

function upload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upload-1',
    agentId: 'agent-1',
    deviceId: 'device-1',
    totalChunks: 2,
    expectedBytes: 1_000,
    _count: { chunks: 2 },
    chunks: [{ byteLength: 600 }, { byteLength: 400 }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.complete.mockResolvedValue({ completed: true })
})

afterEach(() => vi.clearAllMocks())

describe('authorizeExportRecoveryRequest', () => {
  it('reports the endpoint as unavailable without a strong secret', () => {
    expect(authorizeExportRecoveryRequest('Bearer anything', 'short')).toBe('NOT_CONFIGURED')
    expect(authorizeExportRecoveryRequest('Bearer anything', undefined)).toBe('NOT_CONFIGURED')
  })

  it('refuses a missing, malformed or wrong bearer token', () => {
    expect(authorizeExportRecoveryRequest(null, SECRET)).toBe('DENIED')
    expect(authorizeExportRecoveryRequest('Basic abc', SECRET)).toBe('DENIED')
    expect(authorizeExportRecoveryRequest('Bearer ', SECRET)).toBe('DENIED')
    expect(authorizeExportRecoveryRequest(`Bearer ${'y'.repeat(48)}`, SECRET)).toBe('DENIED')
  })

  it('accepts the configured secret', () => {
    expect(authorizeExportRecoveryRequest(`Bearer ${SECRET}`, SECRET)).toBe('OK')
  })
})

describe('recoverInterruptedExportUploads', () => {
  it('finishes an upload whose chunks all arrived', async () => {
    mocks.findMany.mockResolvedValue([upload()])

    const report = await recoverInterruptedExportUploads(db(), { now: NOW })

    expect(mocks.complete).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent-1',
      deviceId: 'device-1',
      uploadId: 'upload-1',
    })
    expect(report).toMatchObject({ considered: 1, recovered: 1, failed: 0 })
  })

  it('measures staleness from when the upload started, not from its last write', async () => {
    // Recording why an upload stopped is itself a write. Keying staleness on
    // updatedAt would hide exactly the uploads that just reported trouble.
    mocks.findMany.mockResolvedValue([])

    await recoverInterruptedExportUploads(db(), { now: NOW })

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: 'UPLOADING',
          createdAt: { lt: new Date(NOW.getTime() - EXPORT_RECOVERY_MIN_AGE_MS) },
        }),
      }),
    )
    const [[call]] = mocks.findMany.mock.calls
    expect(call.where).not.toHaveProperty('updatedAt')
  })

  it('does not retry a transfer that never fully arrived', async () => {
    mocks.findMany.mockResolvedValue([upload({ _count: { chunks: 1 }, chunks: [{ byteLength: 600 }] })])

    const report = await recoverInterruptedExportUploads(db(), { now: NOW })

    expect(mocks.complete).not.toHaveBeenCalled()
    expect(report.skipped).toEqual({ INCOMPLETE_TRANSFER: 1 })
    expect(report.recovered).toBe(0)
  })

  it('does not retry when the bytes do not add up to what was promised', async () => {
    mocks.findMany.mockResolvedValue([upload({ chunks: [{ byteLength: 600 }, { byteLength: 1 }] })])

    const report = await recoverInterruptedExportUploads(db(), { now: NOW })

    expect(mocks.complete).not.toHaveBeenCalled()
    expect(report.skipped).toEqual({ INCOMPLETE_TRANSFER: 1 })
  })

  it('counts a grid-superseded upload apart from an ordinary failure', async () => {
    // The paginated grid collector already claimed those stage sequences, so
    // the export can never be replayed into that run. The remedy is a fresh
    // sync, not another retry — and the count must make that visible.
    mocks.findMany.mockResolvedValue([upload()])
    mocks.complete.mockRejectedValue(new Error('IDEMPOTENCY_CONFLICT'))

    const report = await recoverInterruptedExportUploads(db(), { now: NOW })

    expect(report).toMatchObject({ considered: 1, recovered: 0, failed: 0, supersededByGrid: 1 })
  })

  it('keeps going after one upload fails, and counts it', async () => {
    mocks.findMany.mockResolvedValue([upload({ id: 'a' }), upload({ id: 'b' })])
    mocks.complete
      .mockRejectedValueOnce(new Error('EXPORT_HASH_MISMATCH'))
      .mockResolvedValueOnce({ completed: true })

    const report = await recoverInterruptedExportUploads(db(), { now: NOW })

    expect(report).toMatchObject({ considered: 2, recovered: 1, failed: 1 })
  })

  it('bounds how many uploads one pass may finalize', async () => {
    mocks.findMany.mockResolvedValue([])

    await recoverInterruptedExportUploads(db(), { now: NOW, limit: 5 })

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }))
  })
})
