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

export { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'

export const LOCAL_CONNECTOR_RUN_TTL_MS = 30 * 60_000
/// The grids a run reads when the caller does not name any. The capability
/// catalogue can plan all twenty, but widening the default would change what an
/// unattended device does at the same moment the protocol changed shape, so the
/// extra grids are opt-in per run.
export const LOCAL_CONNECTOR_DEFAULT_GRID_KEYS = [
  'NEW_BUSINESS',
  'INFORCE_CLIENTS',
] as const satisfies readonly NationalLifeGridKey[]
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

export class LocalConnectorRunError extends Error {
  constructor(readonly code: 'RUN_NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'RUN_NOT_ACTIVE') {
    super(code)
  }
}

async function failStaleLocalRuns(
  db: LocalConnectorDb,
  input: { agentId: string; deviceId: string; now: Date },
) {
  const staleBefore = new Date(input.now.getTime() - LOCAL_CONNECTOR_RUN_TTL_MS)
  await db.nationalLifeSyncRun.updateMany({
    where: {
      agentId: input.agentId,
      connectorDeviceId: input.deviceId,
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
      connectorDeviceId: input.deviceId,
      executionSource: 'LOCAL',
      provider: NATIONAL_LIFE_PROVIDER,
      state: 'RUNNING',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (active) {
    return {
      runId: active.id,
      schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION,
      stages,
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

async function persistRecords(
  tx: Prisma.TransactionClient,
  input: IngestInput,
  observedAt: Date,
) {
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
    return
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
    return
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
}

function publicReceipt(receipt: {
  id: string
  runId: string
  gridKey: string
  sequence: number
  contentHash: string
  recordCount: number
  createdAt: Date
}) {
  return {
    receiptId: receipt.id,
    runId: receipt.runId,
    gridKey: receipt.gridKey,
    sequence: receipt.sequence,
    contentHash: receipt.contentHash,
    recordCount: receipt.recordCount,
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
          connectorDeviceId: input.deviceId,
          executionSource: 'LOCAL',
          provider: NATIONAL_LIFE_PROVIDER,
          state: { in: ['RUNNING', 'COMPLETED'] },
        },
        select: { id: true, totalStages: true },
      })
      if (!run || input.envelope.gridKey !== input.gridKey) {
        throw new LocalConnectorRunError('RUN_NOT_FOUND')
      }

      const sequenceCollision = await receiptForSequence(tx, input)
      if (sequenceCollision) {
        if (sequenceCollision.contentHash === input.contentHash) {
          return { receipt: sequenceCollision, duplicate: true as const }
        }
        throw new LocalConnectorRunError('IDEMPOTENCY_CONFLICT')
      }

      await persistRecords(tx, input, observedAt)
      const created = await tx.nationalLifeConnectorStageReceipt.create({
        data: {
          deviceId: input.deviceId,
          runId: run.id,
          gridKey: input.gridKey,
          sequence: input.envelope.sequence,
          truncated: input.envelope.truncated,
          contentHash: input.contentHash,
          recordCount: input.envelope.records.length,
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
      const completedStages = finalizedGrids.length
      // The run row no longer knows which grids were planned — a run can now carry
      // any subset of the catalogue — so completeness is counted against the
      // totalStages written at start instead of a fixed grid list.
      const completed = completedStages >= run.totalStages
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
