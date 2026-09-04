import 'server-only'

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import type { NationalLifeGridKey } from '../portal-grid-client'
import { LOCAL_CONNECTOR_SCHEMA_VERSION } from './contracts'
import {
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
  LocalConnectorRunError,
  completeLocalConnectorStage,
  ingestLocalConnectorStage,
} from './run-service'
import {
  NATIONAL_LIFE_EXPORT_MAX_BYTES,
  parseNationalLifeInforceExport,
} from './export-workbook'

export const NATIONAL_LIFE_EXPORT_CHUNK_BYTES = 1024 * 1024
export const NATIONAL_LIFE_EXPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const EXPORTABLE_SOURCE_KEYS = new Set<NationalLifeGridKey>(['INFORCE_CLIENTS'])

export class NationalLifeExportUploadError extends Error {
  constructor(readonly code:
    | 'EXPORT_NOT_ALLOWED'
    | 'EXPORT_UPLOAD_NOT_FOUND'
    | 'EXPORT_UPLOAD_CONFLICT'
    | 'EXPORT_CHUNK_INVALID'
    | 'EXPORT_INCOMPLETE'
    | 'EXPORT_HASH_MISMATCH'
    | 'RUN_NOT_ACTIVE') {
    super(code)
  }
}

type ExportDb = Pick<
  PrismaClient,
  'nationalLifeSyncRun' | 'nationalLifeExportUpload' | 'nationalLifeExportChunk' | '$transaction'
>

type DeviceScope = { agentId: string; deviceId: string }

type ExportRunScope = DeviceScope & {
  runId: string
  sourceKey: NationalLifeGridKey
}

function isMissingRecordError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025'
}

/**
 * The conditional update both verifies and locks the run for the enclosing
 * transaction. A plain read would leave a window where onboarding cancellation
 * can commit before the upload advances.
 */
async function lockExportRun(
  db: Pick<PrismaClient, 'nationalLifeSyncRun'>,
  input: ExportRunScope,
  state: 'RUNNING' | 'COMPLETED' | 'PARTIAL' = 'RUNNING',
) {
  try {
    return await db.nationalLifeSyncRun.update({
      where: {
        id: input.runId,
        agentId: input.agentId,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        connectorDeviceId: input.deviceId,
        executionSource: 'LOCAL',
        provider: NATIONAL_LIFE_PROVIDER,
        state,
        plannedGridKeys: { has: input.sourceKey },
      },
      data: { updatedAt: new Date() },
      select: { id: true },
    })
  } catch (error) {
    if (isMissingRecordError(error)) {
      throw new NationalLifeExportUploadError('RUN_NOT_ACTIVE')
    }
    throw error
  }
}

async function assertExportRunCanComplete(
  db: Pick<PrismaClient, 'nationalLifeSyncRun'>,
  input: ExportRunScope,
) {
  const run = await db.nationalLifeSyncRun.findFirst({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      connectorDeviceId: input.deviceId,
      executionSource: 'LOCAL',
      provider: NATIONAL_LIFE_PROVIDER,
      // COMPLETED is required for an idempotent recovery when stage completion
      // committed but the upload's own terminal write did not.
      state: { in: ['RUNNING', 'COMPLETED'] },
      plannedGridKeys: { has: input.sourceKey },
    },
    select: { id: true },
  })
  if (!run) throw new NationalLifeExportUploadError('RUN_NOT_ACTIVE')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function safeFileName(sourceKey: NationalLifeGridKey, fileName: string): boolean {
  if (sourceKey === 'INFORCE_CLIENTS') {
    return /^NLG_InforceClientInfo_[0-9]{8}\.xlsx$/.test(fileName)
  }
  return false
}

export function exportChunkLayout(expectedBytes: number, sequence: number) {
  const totalChunks = Math.ceil(expectedBytes / NATIONAL_LIFE_EXPORT_CHUNK_BYTES)
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= totalChunks) {
    throw new NationalLifeExportUploadError('EXPORT_CHUNK_INVALID')
  }
  const byteOffset = sequence * NATIONAL_LIFE_EXPORT_CHUNK_BYTES
  return {
    totalChunks,
    byteOffset,
    byteLength: Math.min(NATIONAL_LIFE_EXPORT_CHUNK_BYTES, expectedBytes - byteOffset),
  }
}

export async function beginNationalLifeExportUpload(
  db: ExportDb,
  input: DeviceScope & {
    runId: string
    sourceKey: NationalLifeGridKey
    fileName: string
    contentType: string
    expectedBytes: number
    expectedSha256: string
  },
) {
  if (
    !EXPORTABLE_SOURCE_KEYS.has(input.sourceKey) ||
    !safeFileName(input.sourceKey, input.fileName) ||
    input.contentType !== NATIONAL_LIFE_EXPORT_CONTENT_TYPE ||
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes <= 0 ||
    input.expectedBytes > NATIONAL_LIFE_EXPORT_MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(input.expectedSha256)
  ) {
    throw new NationalLifeExportUploadError('EXPORT_NOT_ALLOWED')
  }
  const totalChunks = Math.ceil(input.expectedBytes / NATIONAL_LIFE_EXPORT_CHUNK_BYTES)
  return db.$transaction(async (tx) => {
    const existing = await tx.nationalLifeExportUpload.findUnique({
      where: { deviceId_runId_sourceKey: {
        deviceId: input.deviceId,
        runId: input.runId,
        sourceKey: input.sourceKey,
      } },
      include: { chunks: { select: { sequence: true }, orderBy: { sequence: 'asc' } } },
    })
    if (existing) {
      if (
        existing.agentId !== input.agentId ||
        existing.fileName !== input.fileName ||
        existing.contentType !== input.contentType ||
        existing.expectedBytes !== input.expectedBytes ||
        existing.expectedSha256 !== input.expectedSha256 ||
        existing.totalChunks !== totalChunks
      ) {
        throw new NationalLifeExportUploadError('EXPORT_UPLOAD_CONFLICT')
      }
      if (existing.state === 'COMPLETED') {
        return {
          uploadId: existing.id,
          totalChunks,
          nextSequence: totalChunks,
          completed: true,
          duplicate: true,
        }
      }
      await lockExportRun(tx, input)
      const received = new Set(existing.chunks.map((chunk) => chunk.sequence))
      let nextSequence = 0
      while (received.has(nextSequence)) nextSequence += 1
      return {
        uploadId: existing.id,
        totalChunks,
        nextSequence,
        completed: false,
        duplicate: true,
      }
    }
    await lockExportRun(tx, input)
    const created = await tx.nationalLifeExportUpload.create({
      data: {
        agentId: input.agentId,
        deviceId: input.deviceId,
        runId: input.runId,
        sourceKey: input.sourceKey,
        fileName: input.fileName,
        contentType: input.contentType,
        expectedBytes: input.expectedBytes,
        expectedSha256: input.expectedSha256,
        totalChunks,
      },
      select: { id: true },
    })
    return { uploadId: created.id, totalChunks, nextSequence: 0, completed: false, duplicate: false }
  })
}

export async function putNationalLifeExportChunk(
  db: ExportDb,
  input: DeviceScope & { uploadId: string; sequence: number; bytes: Uint8Array },
) {
  const upload = await db.nationalLifeExportUpload.findFirst({
    where: { id: input.uploadId, agentId: input.agentId, deviceId: input.deviceId, state: 'UPLOADING' },
  })
  if (!upload) throw new NationalLifeExportUploadError('EXPORT_UPLOAD_NOT_FOUND')
  const layout = exportChunkLayout(upload.expectedBytes, input.sequence)
  if (input.bytes.byteLength !== layout.byteLength) {
    throw new NationalLifeExportUploadError('EXPORT_CHUNK_INVALID')
  }
  const contentHash = sha256(input.bytes)

  return db.$transaction(async (tx) => {
    await lockExportRun(tx, {
      agentId: input.agentId,
      deviceId: input.deviceId,
      runId: upload.runId,
      sourceKey: upload.sourceKey as NationalLifeGridKey,
    })
    const existing = await tx.nationalLifeExportChunk.findUnique({
      where: { uploadId_sequence: { uploadId: upload.id, sequence: input.sequence } },
    })
    if (existing) {
      if (existing.contentHash !== contentHash || existing.byteLength !== input.bytes.byteLength) {
        throw new NationalLifeExportUploadError('EXPORT_UPLOAD_CONFLICT')
      }
    } else {
      await tx.nationalLifeExportChunk.create({
        data: {
          uploadId: upload.id,
          sequence: input.sequence,
          byteOffset: layout.byteOffset,
          byteLength: input.bytes.byteLength,
          contentHash,
          bytes: Buffer.from(input.bytes),
        },
      })
    }
    const aggregate = await tx.nationalLifeExportChunk.aggregate({
      where: { uploadId: upload.id },
      _count: { _all: true },
      _sum: { byteLength: true },
    })
    await tx.nationalLifeExportUpload.update({
      where: { id: upload.id },
      data: {
        receivedChunks: aggregate._count._all,
        receivedBytes: aggregate._sum.byteLength ?? 0,
      },
    })
    return {
      uploadId: upload.id,
      sequence: input.sequence,
      contentHash,
      receivedChunks: aggregate._count._all,
      receivedBytes: aggregate._sum.byteLength ?? 0,
      duplicate: Boolean(existing),
    }
  })
}

export async function completeNationalLifeExportUpload(
  db: PrismaClient,
  input: DeviceScope & { uploadId: string },
) {
  const upload = await db.nationalLifeExportUpload.findFirst({
    where: { id: input.uploadId, agentId: input.agentId, deviceId: input.deviceId },
    include: { chunks: { orderBy: { sequence: 'asc' } } },
  })
  if (!upload) throw new NationalLifeExportUploadError('EXPORT_UPLOAD_NOT_FOUND')
  if (upload.state === 'COMPLETED') {
    return {
      uploadId: upload.id,
      sourceKey: upload.sourceKey,
      rowCount: upload.rowCount ?? 0,
      writtenCount: upload.writtenCount ?? 0,
      completed: true,
      duplicate: true,
    }
  }
  await assertExportRunCanComplete(db, {
    agentId: input.agentId,
    deviceId: input.deviceId,
    runId: upload.runId,
    sourceKey: upload.sourceKey as NationalLifeGridKey,
  })
  if (
    upload.chunks.length !== upload.totalChunks ||
    upload.chunks.some((chunk, index) => chunk.sequence !== index) ||
    upload.chunks.reduce((total, chunk) => total + chunk.byteLength, 0) !== upload.expectedBytes
  ) {
    throw new NationalLifeExportUploadError('EXPORT_INCOMPLETE')
  }
  const fileBytes = Buffer.concat(upload.chunks.map((chunk) => Buffer.from(chunk.bytes)))
  if (sha256(fileBytes) !== upload.expectedSha256) {
    const failed = await db.nationalLifeExportUpload.updateMany({
      where: {
        id: upload.id,
        agentId: input.agentId,
        deviceId: input.deviceId,
        state: 'UPLOADING',
      },
      data: { state: 'FAILED', safeErrorCode: 'EXPORT_HASH_MISMATCH' },
    })
    if (failed.count !== 1) {
      // Cancellation also closes the upload conditionally. Whichever terminal
      // transition commits first owns the reason; a stale hash verifier must
      // never replace USER_CANCELLED after the user chose to skip.
      throw new NationalLifeExportUploadError('RUN_NOT_ACTIVE')
    }
    throw new NationalLifeExportUploadError('EXPORT_HASH_MISMATCH')
  }
  if (upload.sourceKey !== 'INFORCE_CLIENTS') {
    throw new NationalLifeExportUploadError('EXPORT_NOT_ALLOWED')
  }
  const parsed = await parseNationalLifeInforceExport(fileBytes)
  const observedAt = new Date()
  let writtenCount = 0
  let finalSequence = -1
  let stageCompletion: Awaited<ReturnType<typeof completeLocalConnectorStage>>
  try {
    for (let offset = 0; offset < parsed.rows.length; offset += 200) {
      const records = parsed.rows.slice(offset, offset + 200)
      finalSequence += 1
      const envelope = {
        schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION,
        runId: upload.runId,
        gridKey: 'INFORCE_CLIENTS' as const,
        sequence: finalSequence,
        sourceOffset: offset,
        nextOffset: offset + records.length,
        observedAt: observedAt.toISOString(),
        recordsTotal: parsed.rows.length,
        truncated: false,
        records,
      }
      const body = new TextEncoder().encode(JSON.stringify(envelope))
      const result = await ingestLocalConnectorStage(db, {
        agentId: input.agentId,
        deviceId: input.deviceId,
        gridKey: 'INFORCE_CLIENTS',
        idempotencyKey: `export:${upload.id}:${finalSequence}`,
        contentHash: sha256(body),
        envelope,
        legacyStageCompletion: false,
      })
      writtenCount += result.receipt.writtenCount ?? 0
    }
    // Empty official workbooks still need one zero-row receipt so the existing
    // completion proof can reconcile sequence zero with an expected count of zero.
    if (finalSequence === -1) {
      finalSequence = 0
      const envelope = {
        schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION,
        runId: upload.runId,
        gridKey: 'INFORCE_CLIENTS' as const,
        sequence: 0,
        sourceOffset: 0,
        nextOffset: 0,
        observedAt: observedAt.toISOString(),
        recordsTotal: 0,
        truncated: false,
        records: [],
      }
      const body = new TextEncoder().encode(JSON.stringify(envelope))
      await ingestLocalConnectorStage(db, {
        agentId: input.agentId,
        deviceId: input.deviceId,
        gridKey: 'INFORCE_CLIENTS',
        idempotencyKey: `export:${upload.id}:0`,
        contentHash: sha256(body),
        envelope,
        legacyStageCompletion: false,
      })
    }
    stageCompletion = await completeLocalConnectorStage(db, {
      agentId: input.agentId,
      deviceId: input.deviceId,
      runId: upload.runId,
      gridKey: 'INFORCE_CLIENTS',
      expectedRecordCount: parsed.rows.length,
      finalSequence,
      truncated: false,
    })
  } catch (error) {
    if (
      error instanceof LocalConnectorRunError &&
      (error.code === 'RUN_NOT_FOUND' || error.code === 'RUN_NOT_ACTIVE')
    ) {
      throw new NationalLifeExportUploadError('RUN_NOT_ACTIVE')
    }
    throw error
  }

  const expectedRunState = stageCompletion.completed
    ? 'COMPLETED'
    : stageCompletion.terminal
      ? 'PARTIAL'
      : 'RUNNING'
  const finalization = await db.$transaction(async (tx) => {
    await lockExportRun(tx, {
      agentId: input.agentId,
      deviceId: input.deviceId,
      runId: upload.runId,
      sourceKey: upload.sourceKey as NationalLifeGridKey,
    }, expectedRunState)
    const finalized = await tx.nationalLifeExportUpload.updateMany({
      where: {
        id: upload.id,
        agentId: input.agentId,
        deviceId: input.deviceId,
        state: 'UPLOADING',
      },
      data: {
        state: 'COMPLETED',
        fileBytes,
        rowCount: parsed.rows.length,
        writtenCount,
        safeErrorCode: null,
        completedAt: observedAt,
      },
    })
    if (finalized.count !== 1) {
      const alreadyCompleted = await tx.nationalLifeExportUpload.findFirst({
        where: {
          id: upload.id,
          agentId: input.agentId,
          deviceId: input.deviceId,
          state: 'COMPLETED',
        },
        select: { id: true },
      })
      if (!alreadyCompleted) {
        throw new NationalLifeExportUploadError('EXPORT_UPLOAD_NOT_FOUND')
      }
      return { duplicate: true }
    }
    await tx.nationalLifeExportChunk.deleteMany({ where: { uploadId: upload.id } })
    // Keep the latest carrier artifact available for audit without growing the
    // database by one multi-megabyte workbook per sync forever.
    await tx.nationalLifeExportUpload.updateMany({
      where: {
        agentId: input.agentId,
        sourceKey: upload.sourceKey,
        id: { not: upload.id },
        fileBytes: { not: null },
      },
      data: { fileBytes: null },
    })
    return { duplicate: false }
  })
  return {
    uploadId: upload.id,
    sourceKey: upload.sourceKey,
    worksheetName: parsed.worksheetName,
    rowCount: parsed.rows.length,
    writtenCount,
    completed: true,
    duplicate: finalization.duplicate,
    nextStageIndex: stageCompletion.nextStageIndex,
    terminal: stageCompletion.terminal,
  }
}
