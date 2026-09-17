import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { completeNationalLifeExportUpload } from './export-upload-service'

const MIN_SECRET_LENGTH = 32

/**
 * How long after it started an upload counts as interrupted.
 *
 * A device legitimately takes time between the last chunk and the completion
 * call, so a fresh upload must never be grabbed out from under it. Everything
 * here is idempotent, but finishing someone else's live upload would still
 * turn a normal handoff into a confusing double write.
 *
 * Measured from `createdAt`, deliberately not from `updatedAt`: recording why
 * an upload stopped is itself a write, so staleness keyed on `updatedAt` would
 * hide the very uploads that just reported being interrupted.
 */
export const EXPORT_RECOVERY_MIN_AGE_MS = 15 * 60_000

/** A single pass never finalizes more uploads than this. */
export const EXPORT_RECOVERY_MAX_PER_PASS = 20

export type ExportRecoveryReport = {
  considered: number
  recovered: number
  skipped: Record<string, number>
  failed: number
  /**
   * Uploads whose stage sequences were already claimed by the paginated grid
   * collector. These cannot be replayed at all: the export rows and the grid
   * rows compete for the same sequence space, and the grid won. Counted apart
   * from ordinary failures because the remedy is different — a fresh sync, not
   * a retry — and because a non-zero value here means the run reported success
   * while losing the premium the export carried.
   */
  supersededByGrid: number
}

type AuthResult = 'OK' | 'DENIED' | 'NOT_CONFIGURED'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function authorizeExportRecoveryRequest(
  authorization: string | null,
  secret: string | undefined = process.env.NATIONAL_LIFE_EXPORT_RECOVERY_SECRET,
): AuthResult {
  const configured = secret?.trim() ?? ''
  if (configured.length < MIN_SECRET_LENGTH) return 'NOT_CONFIGURED'
  if (!authorization?.startsWith('Bearer ')) return 'DENIED'

  const presented = authorization.slice('Bearer '.length).trim()
  if (!presented) return 'DENIED'
  return timingSafeEqual(digest(presented), digest(configured)) ? 'OK' : 'DENIED'
}

/**
 * Finishes carrier exports whose row writing was interrupted.
 *
 * The write loop in completeNationalLifeExportUpload is not transactional with
 * the terminal write that marks the upload COMPLETED. When it is interrupted,
 * the already-ingested pages stay, the upload stays UPLOADING, and — because
 * the paginated grid collector can finish the same stage — the run still
 * reports success while the book loses the premium the export carried.
 *
 * Retrying the whole completion is safe: stage ingestion is keyed on
 * `export:<uploadId>:<sequence>`, so pages that already landed are recognised
 * as duplicates instead of being written twice, and the service explicitly
 * accepts terminal runs for exactly this recovery.
 */
export async function recoverInterruptedExportUploads(
  db: PrismaClient,
  options: { now?: Date; minAgeMs?: number; limit?: number } = {},
): Promise<ExportRecoveryReport> {
  const report: ExportRecoveryReport = {
    considered: 0, recovered: 0, skipped: {}, failed: 0, supersededByGrid: 0,
  }
  const skip = (reason: string) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1
  }

  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - (options.minAgeMs ?? EXPORT_RECOVERY_MIN_AGE_MS))

  const stuck = await db.nationalLifeExportUpload.findMany({
    where: { state: 'UPLOADING', createdAt: { lt: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? EXPORT_RECOVERY_MAX_PER_PASS,
    select: {
      id: true,
      agentId: true,
      deviceId: true,
      totalChunks: true,
      expectedBytes: true,
      _count: { select: { chunks: true } },
      chunks: { select: { byteLength: true } },
    },
  })

  for (const upload of stuck) {
    report.considered += 1

    // An upload missing chunks was never fully delivered. Completing it would
    // fail on the integrity check anyway, and retrying it every pass would turn
    // a dead transfer into permanent noise.
    const receivedBytes = upload.chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    if (
      upload._count.chunks !== upload.totalChunks
      || receivedBytes !== upload.expectedBytes
    ) {
      skip('INCOMPLETE_TRANSFER')
      continue
    }

    try {
      await completeNationalLifeExportUpload(db, {
        agentId: upload.agentId,
        deviceId: upload.deviceId,
        uploadId: upload.id,
      })
      report.recovered += 1
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UNKNOWN'
      if (code === 'IDEMPOTENCY_CONFLICT') {
        report.supersededByGrid += 1
      } else {
        report.failed += 1
      }
      console.error('Interrupted National Life export could not be recovered', {
        uploadId: upload.id,
        code,
      })
    }
  }

  return report
}
