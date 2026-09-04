import 'server-only'

import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'
import { normalizeCarrierPolicyNumber } from '../policy-number'
import { sanitizeFilename, saveUploadedFile } from '@/lib/storage'

export const NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES = 1024 * 1024
export const NATIONAL_LIFE_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024
export const NATIONAL_LIFE_DOCUMENT_CONTENT_TYPE = 'application/pdf'

export class NationalLifeDocumentTransferError extends Error {
  constructor(readonly code:
    | 'DOCUMENT_SOURCE_NOT_FOUND'
    | 'DOCUMENT_SOURCE_INVALID'
    | 'DOCUMENT_POLICY_NOT_FOUND'
    | 'DOCUMENT_TRANSFER_NOT_FOUND'
    | 'DOCUMENT_TRANSFER_CONFLICT'
    | 'DOCUMENT_CHUNK_INVALID'
    | 'DOCUMENT_INCOMPLETE'
    | 'DOCUMENT_HASH_MISMATCH'
    | 'DOCUMENT_INVALID_PDF') {
    super(code)
  }
}

type DeviceScope = { agentId: string; deviceId: string }

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function plainText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

export function isEncryptedDocumentHandle(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 2_048 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

export function nationalLifeDocumentFileName(raw: Record<string, unknown>, policyNumber: string): string {
  const type = plainText(raw.DocumentType) ?? plainText(raw.DocumentCategory) ?? 'Document'
  const date = (plainText(raw.DocumentDate) ?? 'undated').replace(/[^0-9A-Za-z-]/g, '-')
  return sanitizeFilename(`National-Life_${policyNumber}_${date}_${type}.pdf`).slice(0, 180)
}

export function nationalLifeDocumentStorageKey(policyId: string, reportRowId: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_')
  return `policies/${safe(policyId)}/national-life/${safe(reportRowId)}.pdf`
}

export function documentChunkLayout(expectedBytes: number, sequence: number) {
  const totalChunks = Math.ceil(expectedBytes / NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES)
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence >= totalChunks) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_CHUNK_INVALID')
  }
  const byteOffset = sequence * NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES
  return {
    totalChunks,
    byteOffset,
    byteLength: Math.min(NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES, expectedBytes - byteOffset),
  }
}

export async function requestNationalLifeDocumentTransfer(
  db: PrismaClient,
  input: DeviceScope & { reportRowId: string },
) {
  const source = await db.nationalLifePublishedReportRow.findFirst({
    where: {
      id: input.reportRowId,
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      gridKey: 'CORRESPONDENCE',
    },
    select: { id: true, rowKey: true, raw: true },
  })
  if (!source) throw new NationalLifeDocumentTransferError('DOCUMENT_SOURCE_NOT_FOUND')

  const raw = source.raw as Record<string, unknown>
  const encryptedHandle = raw.EncryptedDocumentHandle
  const policyNumber = normalizeCarrierPolicyNumber(plainText(raw.RefPolicyNumber))
  if (!isEncryptedDocumentHandle(encryptedHandle) || !policyNumber) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_SOURCE_INVALID')
  }

  const policy = await db.policy.findFirst({
    where: { agentId: input.agentId, policyNumber },
    select: { id: true, policyNumber: true },
  })
  if (!policy) throw new NationalLifeDocumentTransferError('DOCUMENT_POLICY_NOT_FOUND')

  const stored = await db.policyDocument.findFirst({
    where: { policyId: policy.id, provider: 'NATIONAL_LIFE', externalId: source.rowKey },
    select: { id: true },
  })
  if (stored) {
    return { completed: true as const, documentId: stored.id }
  }

  const existingTransfer = await db.nationalLifeDocumentTransfer.findUnique({
    where: { agentId_publishedReportRowId: { agentId: input.agentId, publishedReportRowId: source.id } },
    select: { deviceId: true, state: true, updatedAt: true },
  })
  if (
    existingTransfer?.state === 'UPLOADING' &&
    existingTransfer.deviceId !== input.deviceId &&
    existingTransfer.updatedAt.getTime() > Date.now() - 5 * 60_000
  ) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_CONFLICT')
  }

  const fileName = nationalLifeDocumentFileName(raw, policy.policyNumber)
  const transfer = await db.nationalLifeDocumentTransfer.upsert({
    where: { agentId_publishedReportRowId: { agentId: input.agentId, publishedReportRowId: source.id } },
    create: {
      agentId: input.agentId,
      deviceId: input.deviceId,
      publishedReportRowId: source.id,
      policyId: policy.id,
      fileName,
    },
    update: {
      deviceId: input.deviceId,
      policyId: policy.id,
      fileName,
      safeErrorCode: null,
    },
    select: { id: true, documentId: true, state: true },
  })
  if (transfer.documentId) {
    return { completed: true as const, documentId: transfer.documentId }
  }
  // Integrity failures are terminal for the attempted byte stream, not for the
  // carrier document. A later explicit click must get a clean resumable upload
  // instead of inheriting the failed chunks and becoming permanently stuck.
  if (transfer.state === 'FAILED') {
    await db.$transaction(async (tx) => {
      await tx.nationalLifeDocumentChunk.deleteMany({ where: { transferId: transfer.id } })
      await tx.nationalLifeDocumentTransfer.update({
        where: { id: transfer.id },
        data: {
          contentType: null,
          expectedBytes: null,
          expectedSha256: null,
          totalChunks: null,
          state: 'REQUESTED',
          receivedBytes: 0,
          receivedChunks: 0,
          safeErrorCode: null,
          completedAt: null,
        },
      })
    })
  }
  return {
    completed: false as const,
    transferId: transfer.id,
    encryptedHandle,
    fileName,
  }
}

export async function declareNationalLifeDocumentTransfer(
  db: PrismaClient,
  input: DeviceScope & {
    transferId: string
    contentType: string
    expectedBytes: number
    expectedSha256: string
  },
) {
  if (
    input.contentType !== NATIONAL_LIFE_DOCUMENT_CONTENT_TYPE ||
    !Number.isSafeInteger(input.expectedBytes) ||
    input.expectedBytes <= 0 ||
    input.expectedBytes > NATIONAL_LIFE_DOCUMENT_MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(input.expectedSha256)
  ) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_SOURCE_INVALID')
  }
  const transfer = await db.nationalLifeDocumentTransfer.findFirst({
    where: { id: input.transferId, agentId: input.agentId, deviceId: input.deviceId },
    include: { chunks: { select: { sequence: true }, orderBy: { sequence: 'asc' } } },
  })
  if (!transfer) throw new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_NOT_FOUND')
  if (transfer.documentId || transfer.state === 'COMPLETED') {
    return { transferId: transfer.id, completed: true, nextSequence: transfer.totalChunks ?? 0 }
  }

  const totalChunks = Math.ceil(input.expectedBytes / NATIONAL_LIFE_DOCUMENT_CHUNK_BYTES)
  const hasDeclaredPayload = transfer.expectedBytes !== null
  if (hasDeclaredPayload && (
    transfer.expectedBytes !== input.expectedBytes ||
    transfer.expectedSha256 !== input.expectedSha256 ||
    transfer.contentType !== input.contentType ||
    transfer.totalChunks !== totalChunks
  )) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_CONFLICT')
  }
  if (!hasDeclaredPayload) {
    await db.nationalLifeDocumentTransfer.update({
      where: { id: transfer.id },
      data: {
        contentType: input.contentType,
        expectedBytes: input.expectedBytes,
        expectedSha256: input.expectedSha256,
        totalChunks,
        state: 'UPLOADING',
      },
    })
  }
  const received = new Set(transfer.chunks.map((chunk) => chunk.sequence))
  let nextSequence = 0
  while (received.has(nextSequence)) nextSequence += 1
  return { transferId: transfer.id, completed: false, nextSequence, totalChunks }
}

export async function putNationalLifeDocumentChunk(
  db: PrismaClient,
  input: DeviceScope & { transferId: string; sequence: number; bytes: Uint8Array },
) {
  const transfer = await db.nationalLifeDocumentTransfer.findFirst({
    where: {
      id: input.transferId,
      agentId: input.agentId,
      deviceId: input.deviceId,
      state: 'UPLOADING',
    },
  })
  if (!transfer || transfer.expectedBytes === null) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_NOT_FOUND')
  }
  const layout = documentChunkLayout(transfer.expectedBytes, input.sequence)
  if (input.bytes.byteLength !== layout.byteLength) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_CHUNK_INVALID')
  }
  const contentHash = sha256(input.bytes)

  return db.$transaction(async (tx) => {
    const existing = await tx.nationalLifeDocumentChunk.findUnique({
      where: { transferId_sequence: { transferId: transfer.id, sequence: input.sequence } },
    })
    if (existing) {
      if (existing.contentHash !== contentHash || existing.byteLength !== input.bytes.byteLength) {
        throw new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_CONFLICT')
      }
    } else {
      await tx.nationalLifeDocumentChunk.create({
        data: {
          transferId: transfer.id,
          sequence: input.sequence,
          byteOffset: layout.byteOffset,
          byteLength: input.bytes.byteLength,
          contentHash,
          bytes: Buffer.from(input.bytes),
        },
      })
    }
    const aggregate = await tx.nationalLifeDocumentChunk.aggregate({
      where: { transferId: transfer.id },
      _count: { _all: true },
      _sum: { byteLength: true },
    })
    await tx.nationalLifeDocumentTransfer.update({
      where: { id: transfer.id },
      data: {
        receivedChunks: aggregate._count._all,
        receivedBytes: aggregate._sum.byteLength ?? 0,
      },
    })
    return { transferId: transfer.id, sequence: input.sequence, duplicate: Boolean(existing) }
  })
}

export async function completeNationalLifeDocumentTransfer(
  db: PrismaClient,
  input: DeviceScope & { transferId: string },
) {
  const transfer = await db.nationalLifeDocumentTransfer.findFirst({
    where: { id: input.transferId, agentId: input.agentId, deviceId: input.deviceId },
    include: {
      chunks: { orderBy: { sequence: 'asc' } },
      reportRow: { select: { rowKey: true } },
      publishedReportRow: { select: { rowKey: true } },
    },
  })
  if (!transfer) throw new NationalLifeDocumentTransferError('DOCUMENT_TRANSFER_NOT_FOUND')
  if (transfer.documentId && transfer.state === 'COMPLETED') {
    return { completed: true, duplicate: true, documentId: transfer.documentId }
  }
  if (
    transfer.expectedBytes === null ||
    transfer.expectedSha256 === null ||
    transfer.totalChunks === null ||
    transfer.chunks.length !== transfer.totalChunks ||
    transfer.chunks.some((chunk, index) => chunk.sequence !== index) ||
    transfer.chunks.reduce((total, chunk) => total + chunk.byteLength, 0) !== transfer.expectedBytes
  ) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_INCOMPLETE')
  }

  const bytes = Buffer.concat(transfer.chunks.map((chunk) => Buffer.from(chunk.bytes)))
  if (sha256(bytes) !== transfer.expectedSha256) {
    await db.nationalLifeDocumentTransfer.update({
      where: { id: transfer.id },
      data: { state: 'FAILED', safeErrorCode: 'DOCUMENT_HASH_MISMATCH' },
    })
    throw new NationalLifeDocumentTransferError('DOCUMENT_HASH_MISMATCH')
  }
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    await db.nationalLifeDocumentTransfer.update({
      where: { id: transfer.id },
      data: { state: 'FAILED', safeErrorCode: 'DOCUMENT_INVALID_PDF' },
    })
    throw new NationalLifeDocumentTransferError('DOCUMENT_INVALID_PDF')
  }

  const sourceId = transfer.publishedReportRowId ?? transfer.reportRowId
  const sourceRow = transfer.publishedReportRow ?? transfer.reportRow
  if (!sourceId || !sourceRow) {
    throw new NationalLifeDocumentTransferError('DOCUMENT_SOURCE_NOT_FOUND')
  }
  const sourceIdentity = transfer.publishedReportRowId
    ? { publishedSourceRowId: transfer.publishedReportRowId }
    : { sourceRowId: transfer.reportRowId! }
  const storageKey = nationalLifeDocumentStorageKey(transfer.policyId, sourceId)
  await saveUploadedFile(process.env.UPLOADS_DIR ?? './uploads', storageKey, bytes)
  const now = new Date()
  const document = await db.$transaction(async (tx) => {
    const stored = await tx.policyDocument.upsert({
      where: sourceIdentity,
      create: {
        policyId: transfer.policyId,
        filename: transfer.fileName,
        storedPath: storageKey,
        mimeType: NATIONAL_LIFE_DOCUMENT_CONTENT_TYPE,
        sizeBytes: bytes.byteLength,
        uploadedById: null,
        provider: 'NATIONAL_LIFE',
        externalId: sourceRow.rowKey,
        ...sourceIdentity,
        contentHash: transfer.expectedSha256,
        fetchedAt: now,
      },
      update: {
        filename: transfer.fileName,
        storedPath: storageKey,
        mimeType: NATIONAL_LIFE_DOCUMENT_CONTENT_TYPE,
        sizeBytes: bytes.byteLength,
        contentHash: transfer.expectedSha256,
        fetchedAt: now,
      },
      select: { id: true },
    })
    await tx.nationalLifeDocumentTransfer.update({
      where: { id: transfer.id },
      data: {
        documentId: stored.id,
        state: 'COMPLETED',
        safeErrorCode: null,
        completedAt: now,
      },
    })
    await tx.nationalLifeDocumentChunk.deleteMany({ where: { transferId: transfer.id } })
    return stored
  })
  return { completed: true, duplicate: false, documentId: document.id }
}
