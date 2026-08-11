import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import type { NationalLifeGridKey } from '../portal-grid-client'
import { planReadGridStages, type LocalConnectorStagePlan } from './capabilities'
import {
  LOCAL_CONNECTOR_SCHEMA_VERSION,
  type LocalConnectorRawStageEnvelope,
} from './contracts'
import { planRawIngest } from './raw-ingest'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'
import { NATIONAL_LIFE_SYNC_STAGES } from '../sync-progress'

export { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'

/// Every query that reads or mutates a run filters on `agentId` *and*
/// `deploymentScope`. The scope is a constant today, so an agent cannot in fact
/// hold runs under two scopes — but the tenancy predicate is what makes that a
/// property of the query rather than of the current configuration, and queries
/// that disagree on it are how the gap becomes reachable later.

export const LOCAL_CONNECTOR_RUN_TTL_MS = 30 * 60_000
/// The grids a run reads when the caller does not name any. This is the common
/// operational plan; callers can still request a narrower subset explicitly.
export const LOCAL_CONNECTOR_LEGACY_GRID_KEYS = [
  'NEW_BUSINESS',
  'INFORCE_CLIENTS',
] as const satisfies readonly NationalLifeGridKey[]
export const LOCAL_CONNECTOR_DEFAULT_GRID_KEYS = NATIONAL_LIFE_SYNC_STAGES
const UPSERT_CHUNK_SIZE = 100

type LocalConnectorDb = Pick<
  PrismaClient,
  | 'nationalLifeSyncRun'
  | 'nationalLifeConnectorStageReceipt'
  | 'nationalLifeCaseSnapshot'
  | 'nationalLifeInforcePolicy'
  | 'nationalLifeReportRow'
  | '$transaction'
>

type LocalConnectorRunDb = Pick<PrismaClient, 'nationalLifeSyncRun'>

export class LocalConnectorRunError extends Error {
  constructor(
    readonly code:
      | 'RUN_NOT_FOUND'
      | 'IDEMPOTENCY_CONFLICT'
      | 'RUN_NOT_ACTIVE'
      | 'GRID_NOT_PLANNED',
  ) {
    super(code)
  }
}

/// The server's own answer to "which grids does this run cover".
///
/// An empty column means the run predates it, and such a run could only have
/// planned the legacy default pair — so no backfill is needed. Everything that
/// decides what a run covers reads this and nothing the device sent: the grid
/// key in the URL and the one in the envelope both come from the device, so
/// cross-checking them against each other proves nothing about authority.
function plannedGridKeys(run: { plannedGridKeys: string[] }): readonly NationalLifeGridKey[] {
  if (run.plannedGridKeys.length === 0) return LOCAL_CONNECTOR_LEGACY_GRID_KEYS
  return run.plannedGridKeys as NationalLifeGridKey[]
}

async function failStaleLocalRuns(
  db: LocalConnectorRunDb,
  input: { agentId: string; deviceId?: string; now: Date },
) {
  const staleBefore = new Date(input.now.getTime() - LOCAL_CONNECTOR_RUN_TTL_MS)
  await db.nationalLifeSyncRun.updateMany({
    where: {
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      ...(input.deviceId ? { connectorDeviceId: input.deviceId } : {}),
      executionSource: 'LOCAL',
      provider: NATIONAL_LIFE_PROVIDER,
      state: 'RUNNING',
      updatedAt: { lt: staleBefore },
    },
    data: {
      state: 'FAILED',
      safeErrorCode: 'LOCAL_CONNECTOR_TIMEOUT',
      completedAt: input.now,
      updatedAt: input.now,
    },
  })
}

/// Status polling is already a guaranteed path from the Keepr One page. Use it
/// as a second safety net for a worker/tab that disappears without sending ERROR:
/// a run that has not received a heartbeat for the TTL is no longer allowed to
/// present itself as an endless sync.
export async function expireStaleLocalConnectorRuns(
  db: Pick<PrismaClient, 'nationalLifeSyncRun'>,
  input: { agentId: string; now?: Date },
) {
  await failStaleLocalRuns(db, {
    agentId: input.agentId,
    now: input.now ?? new Date(),
  })
}

export async function startLocalConnectorRun(
  db: LocalConnectorDb,
  input: { agentId: string; deviceId: string; now?: Date },
  options?: { gridKeys?: readonly NationalLifeGridKey[] },
): Promise<{
  runId: string
  schemaVersion: typeof LOCAL_CONNECTOR_SCHEMA_VERSION
  stages: LocalConnectorStagePlan[]
  duplicate: boolean
}> {
  const now = input.now ?? new Date()
  // Planned before any write: an unknown grid key must fail the request rather
  // than leave a RUNNING run behind that no device can ever finish.
  const stages = planReadGridStages(options?.gridKeys ?? LOCAL_CONNECTOR_DEFAULT_GRID_KEYS)
  await failStaleLocalRuns(db, { agentId: input.agentId, deviceId: input.deviceId, now })

  const active = await db.nationalLifeSyncRun.findFirst({
    where: {
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      connectorDeviceId: input.deviceId,
      executionSource: 'LOCAL',
      provider: NATIONAL_LIFE_PROVIDER,
      state: 'RUNNING',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, plannedGridKeys: true },
  })
  if (active) {
    // The plan comes from the run that already exists, not from what this call
    // asked for: returning the requested grids would hand the device a plan whose
    // stages the run can never account for, and it would never complete.
    return {
      runId: active.id,
      schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION,
      stages: planReadGridStages(plannedGridKeys(active)),
      duplicate: true as const,
    }
  }

  const run = await db.nationalLifeSyncRun.create({
    data: {
      agentId: input.agentId,
      connectorDeviceId: input.deviceId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'LOCAL',
      state: 'RUNNING',
      totalStages: stages.length,
      plannedGridKeys: stages.map((stage) => stage.params.gridKey),
      currentGridKey: stages[0]?.params.gridKey ?? null,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  })

  return {
    runId: run.id,
    schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION,
    stages,
    duplicate: false as const,
  }
}

export async function failLocalConnectorRun(
  db: LocalConnectorDb,
  input: {
    agentId: string
    deviceId: string
    runId: string
    safeErrorCode: string
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  const updated = await db.nationalLifeSyncRun.updateMany({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      connectorDeviceId: input.deviceId,
      executionSource: 'LOCAL',
      provider: NATIONAL_LIFE_PROVIDER,
      state: 'RUNNING',
    },
    data: {
      state: 'FAILED',
      safeErrorCode: input.safeErrorCode.slice(0, 80),
      completedAt: now,
      updatedAt: now,
    },
  })
  if (updated.count !== 1) throw new LocalConnectorRunError('RUN_NOT_ACTIVE')
  return { runId: input.runId, state: 'FAILED' as const }
}

type IngestInput = {
  agentId: string
  deviceId: string
  gridKey: NationalLifeGridKey
  idempotencyKey: string
  contentHash: string
  envelope: LocalConnectorRawStageEnvelope
  now?: Date
}

/// The mappers are pure and the writes stay here: persistCaseSnapshots and its
/// siblings bind the module-level Prisma client, so they cannot enlist in the
/// stage-ingest transaction that also writes the receipt and the run row.
async function inChunks<T>(items: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let offset = 0; offset < items.length; offset += UPSERT_CHUNK_SIZE) {
    await write(items.slice(offset, offset + UPSERT_CHUNK_SIZE))
  }
}

/// Returns rows actually written. It can be below `envelope.records.length`: the
/// mappers drop rows with no natural key and dedupe on it, so a whole page can
/// normalize to nothing. The receipt records both numbers so a run that ingested
/// zero rows is visible instead of looking like a clean empty grid.
async function persistRecords(
  tx: Prisma.TransactionClient,
  input: IngestInput,
  observedAt: Date,
): Promise<number> {
  const plan = planRawIngest(input.gridKey, input.envelope.records)

  if (plan.target === 'CASE_SNAPSHOT') {
    await inChunks(plan.snapshots, (chunk) =>
      Promise.all(
        chunk.map(({ policyNo, raw, ...rest }) => {
          const data = {
            ...rest,
            raw: raw as Prisma.InputJsonValue,
            fetchedAt: observedAt,
          }
          return tx.nationalLifeCaseSnapshot.upsert({
            where: {
              agentId_deploymentScope_gridKey_policyNo: {
                agentId: input.agentId,
                deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
                gridKey: input.gridKey,
                policyNo,
              },
            },
            create: {
              agentId: input.agentId,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              gridKey: input.gridKey,
              policyNo,
              ...data,
            },
            update: data,
          })
        }),
      ),
    )
    return plan.snapshots.length
  }

  if (plan.target === 'INFORCE_POLICY') {
    await inChunks(plan.snapshots, (chunk) =>
      Promise.all(
        chunk.map(({ policyNumber, raw, ...rest }) => {
          const data = {
            ...rest,
            raw: raw as Prisma.InputJsonValue,
            fetchedAt: observedAt,
          }
          return tx.nationalLifeInforcePolicy.upsert({
            where: {
              agentId_deploymentScope_policyNumber: {
                agentId: input.agentId,
                deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
                policyNumber,
              },
            },
            create: {
              agentId: input.agentId,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              policyNumber,
              ...data,
            },
            update: data,
          })
        }),
      ),
    )
    return plan.snapshots.length
  }

  await inChunks(plan.rows, (chunk) =>
    Promise.all(
      chunk.map((row) => {
        const data = {
          primaryDate: row.primaryDate,
          label: row.label,
          amounts: row.amounts as Prisma.InputJsonValue,
          raw: row.raw as Prisma.InputJsonValue,
          fetchedAt: observedAt,
        }
        return tx.nationalLifeReportRow.upsert({
          where: {
            agentId_deploymentScope_gridKey_rowKey: {
              agentId: input.agentId,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              gridKey: input.gridKey,
              rowKey: row.rowKey,
            },
          },
          create: {
            agentId: input.agentId,
            deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
            gridKey: input.gridKey,
            rowKey: row.rowKey,
            ...data,
          },
          update: data,
        })
      }),
    ),
  )
  return plan.rows.length
}

function publicReceipt(receipt: {
  id: string
  runId: string
  gridKey: string
  sequence: number
  contentHash: string
  recordCount: number
  writtenCount: number | null
  createdAt: Date
}) {
  return {
    receiptId: receipt.id,
    runId: receipt.runId,
    gridKey: receipt.gridKey,
    sequence: receipt.sequence,
    contentHash: receipt.contentHash,
    recordCount: receipt.recordCount,
    writtenCount: receipt.writtenCount,
    createdAt: receipt.createdAt.toISOString(),
  }
}

async function existingReceipt(db: LocalConnectorDb, input: IngestInput) {
  const receipt = await db.nationalLifeConnectorStageReceipt.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  })
  if (!receipt) return null
  if (
    receipt.deviceId !== input.deviceId ||
    receipt.runId !== input.envelope.runId ||
    receipt.gridKey !== input.gridKey ||
    receipt.contentHash !== input.contentHash
  ) {
    throw new LocalConnectorRunError('IDEMPOTENCY_CONFLICT')
  }
  return publicReceipt(receipt)
}

async function receiptForSequence(
  tx: Prisma.TransactionClient,
  input: IngestInput,
) {
  return tx.nationalLifeConnectorStageReceipt.findUnique({
    where: {
      deviceId_runId_gridKey_sequence: {
        deviceId: input.deviceId,
        runId: input.envelope.runId,
        gridKey: input.gridKey,
        sequence: input.envelope.sequence,
      },
    },
  })
}

export async function ingestLocalConnectorStage(db: LocalConnectorDb, input: IngestInput) {
  const duplicate = await existingReceipt(db, input)
  if (duplicate) return { receipt: duplicate, duplicate: true }

  const now = input.now ?? new Date()
  const observedAt = new Date(input.envelope.observedAt)
  try {
    const result = await db.$transaction(async (tx) => {
      const run = await tx.nationalLifeSyncRun.findFirst({
        where: {
          id: input.envelope.runId,
          agentId: input.agentId,
          deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
          connectorDeviceId: input.deviceId,
          executionSource: 'LOCAL',
          provider: NATIONAL_LIFE_PROVIDER,
          state: { in: ['RUNNING', 'COMPLETED'] },
        },
        select: { id: true, plannedGridKeys: true },
      })
      if (!run || input.envelope.gridKey !== input.gridKey) {
        throw new LocalConnectorRunError('RUN_NOT_FOUND')
      }

      // Server authority over gridKey. The URL segment and the envelope both come
      // from the device, so agreeing with each other proves nothing; only the list
      // the server persisted when it planned the run does. Without this a device
      // could satisfy a two-grid run with two grids it invented, and the run would
      // report COMPLETED having ingested nothing that was asked for.
      const planned = plannedGridKeys(run)
      if (!planned.includes(input.gridKey)) {
        throw new LocalConnectorRunError('GRID_NOT_PLANNED')
      }

      const sequenceCollision = await receiptForSequence(tx, input)
      if (sequenceCollision) {
        if (sequenceCollision.contentHash === input.contentHash) {
          return { receipt: sequenceCollision, duplicate: true as const }
        }
        throw new LocalConnectorRunError('IDEMPOTENCY_CONFLICT')
      }

      const writtenCount = await persistRecords(tx, input, observedAt)
      const created = await tx.nationalLifeConnectorStageReceipt.create({
        data: {
          deviceId: input.deviceId,
          runId: run.id,
          gridKey: input.gridKey,
          sequence: input.envelope.sequence,
          truncated: input.envelope.truncated,
          contentHash: input.contentHash,
          // Rows received, not rows written. The content hash is taken over the
          // raw body and owes nothing to this number; what fixes its meaning is
          // that it is a public receipt field, and that paired with writtenCount
          // it makes "received 200, wrote 0" visible instead of clean.
          recordCount: input.envelope.records.length,
          writtenCount,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        },
      })

      const finalizedGrids = await tx.nationalLifeConnectorStageReceipt.findMany({
        where: { runId: run.id, truncated: false },
        distinct: ['gridKey'],
        select: { gridKey: true },
      })
      // Identity, not arithmetic: every *planned* grid must have a non-truncated
      // receipt. A count would let any N finalized grids close an N-stage run.
      const finalizedPlanned = planned.filter((gridKey) =>
        finalizedGrids.some((row) => row.gridKey === gridKey),
      )
      const completedStages = finalizedPlanned.length
      const completed = finalizedPlanned.length === planned.length
      const currentGridKey = completed ? null : input.gridKey
      await tx.nationalLifeSyncRun.update({
        where: { id: run.id },
        data: {
          state: completed ? 'COMPLETED' : 'RUNNING',
          completedStages,
          currentGridKey,
          completedAt: completed ? now : null,
          updatedAt: now,
        },
      })
      return { receipt: created, duplicate: false as const }
    })
    return { receipt: publicReceipt(result.receipt), duplicate: result.duplicate }
  } catch (error) {
    if (error instanceof LocalConnectorRunError) throw error
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    ) {
      const raced = await existingReceipt(db, input)
      if (raced) return { receipt: raced, duplicate: true }
      throw new LocalConnectorRunError('IDEMPOTENCY_CONFLICT')
    }
    throw error
  }
}
