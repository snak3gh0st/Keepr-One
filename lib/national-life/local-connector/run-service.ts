import 'server-only'

import type { Prisma, PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import {
  LOCAL_CONNECTOR_GRID_KEYS,
  type InforceClientRecord,
  type LocalConnectorStageEnvelope,
  type NewBusinessRecord,
} from './contracts'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'

export { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'

export const LOCAL_CONNECTOR_RUN_TTL_MS = 30 * 60_000
// This run-start response still advertises the legacy typed-envelope protocol
// version: LOCAL_CONNECTOR_SCHEMA_VERSION in contracts.ts moved to 2 for the new
// raw-record envelope, but the stage route these runs feed still parses the v1
// typed schemas. Task 7 retires this alongside the typed schemas it describes.
const RUN_PROTOCOL_SCHEMA_VERSION = 1 as const
const UPSERT_CHUNK_SIZE = 100

type LocalConnectorDb = Pick<
  PrismaClient,
  | 'nationalLifeSyncRun'
  | 'nationalLifeConnectorStageReceipt'
  | 'nationalLifeCaseSnapshot'
  | 'nationalLifeInforcePolicy'
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
) {
  const now = input.now ?? new Date()
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
      schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
      stages: [...LOCAL_CONNECTOR_GRID_KEYS],
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
      totalStages: LOCAL_CONNECTOR_GRID_KEYS.length,
      currentGridKey: LOCAL_CONNECTOR_GRID_KEYS[0],
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    select: { id: true },
  })

  return {
    runId: run.id,
    schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
    stages: [...LOCAL_CONNECTOR_GRID_KEYS],
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
  gridKey: (typeof LOCAL_CONNECTOR_GRID_KEYS)[number]
  idempotencyKey: string
  contentHash: string
  envelope: LocalConnectorStageEnvelope
  now?: Date
}

function nullable(value: string | null | undefined): string | null {
  return value ?? null
}

function newBusinessData(record: NewBusinessRecord, observedAt: Date) {
  return {
    insuredName: nullable(record.insuredName),
    ownerName: nullable(record.ownerName),
    product: nullable(record.product),
    carrierStatus: nullable(record.carrierStatus),
    deliveryStatus: nullable(record.deliveryStatus),
    actionRequired: nullable(record.actionRequired),
    requirements: nullable(record.requirements),
    submitDate: nullable(record.submitDate),
    sentDate: nullable(record.sentDate),
    modalPremium: nullable(record.modalPremium),
    anticipatedAnnualPremium: nullable(record.anticipatedAnnualPremium),
    submitMethod: nullable(record.submitMethod),
    caseManager: nullable(record.caseManager),
    agency: nullable(record.agency),
    writingAgentName: nullable(record.writingAgentName),
    writingAgentNumber: nullable(record.writingAgentNumber),
    companyCode: nullable(record.companyCode),
    raw: {} as Prisma.InputJsonValue,
    fetchedAt: observedAt,
  }
}

function inforceData(record: InforceClientRecord, observedAt: Date) {
  return {
    nbPolicyNumber: nullable(record.nbPolicyNumber),
    policyStatus: nullable(record.policyStatus),
    policyIssueDate: nullable(record.policyIssueDate),
    lastStatusChangeDate: nullable(record.lastStatusChangeDate),
    productClass: nullable(record.productClass),
    productName: nullable(record.productName),
    productCode: nullable(record.productCode),
    companyCode: nullable(record.companyCode),
    systemCode: nullable(record.systemCode),
    planCode: nullable(record.planCode),
    agentNumber: nullable(record.agentNumber),
    agentName: nullable(record.agentName),
    servicingAgentName: nullable(record.servicingAgentName),
    servicingAgencyName: nullable(record.servicingAgencyName),
    insuredClientName: nullable(record.insuredClientName),
    insuredDob: nullable(record.insuredDob),
    insuredEmail: nullable(record.insuredEmail),
    insuredPhoneNumber: nullable(record.insuredPhoneNumber),
    ownerClientName: nullable(record.ownerClientName),
    ownerDob: nullable(record.ownerDob),
    ownerEmail: nullable(record.ownerEmail),
    ownerPhoneNumber: nullable(record.ownerPhoneNumber),
    accumulatedCashValue: nullable(record.accumulatedCashValue),
    anticipatedAnnualPremium: nullable(record.anticipatedAnnualPremium),
    termConversionDate: nullable(record.termConversionDate),
    levelPeriodEndDate: nullable(record.levelPeriodEndDate),
    employerName: nullable(record.employerName),
    raw: {} as Prisma.InputJsonValue,
    fetchedAt: observedAt,
  }
}

async function persistRecords(
  tx: Prisma.TransactionClient,
  input: IngestInput,
  observedAt: Date,
) {
  if (input.envelope.gridKey === 'NEW_BUSINESS') {
    for (let offset = 0; offset < input.envelope.records.length; offset += UPSERT_CHUNK_SIZE) {
      const chunk = input.envelope.records.slice(offset, offset + UPSERT_CHUNK_SIZE)
      await Promise.all(
        chunk.map((record) => {
          const data = newBusinessData(record, observedAt)
          return tx.nationalLifeCaseSnapshot.upsert({
            where: {
              agentId_deploymentScope_gridKey_policyNo: {
                agentId: input.agentId,
                deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
                gridKey: input.gridKey,
                policyNo: record.policyNo,
              },
            },
            create: {
              agentId: input.agentId,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              gridKey: input.gridKey,
              policyNo: record.policyNo,
              ...data,
            },
            update: data,
          })
        }),
      )
    }
    return
  }

  for (let offset = 0; offset < input.envelope.records.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = input.envelope.records.slice(offset, offset + UPSERT_CHUNK_SIZE)
    await Promise.all(
      chunk.map((record) => {
        const data = inforceData(record, observedAt)
        return tx.nationalLifeInforcePolicy.upsert({
          where: {
            agentId_deploymentScope_policyNumber: {
              agentId: input.agentId,
              deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
              policyNumber: record.policyNumber,
            },
          },
          create: {
            agentId: input.agentId,
            deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
            policyNumber: record.policyNumber,
            ...data,
          },
          update: data,
        })
      }),
    )
  }
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
        select: { id: true },
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
      const completed = LOCAL_CONNECTOR_GRID_KEYS.every((gridKey) =>
        finalizedGrids.some((row) => row.gridKey === gridKey),
      )
      const currentGridKey =
        LOCAL_CONNECTOR_GRID_KEYS.find(
          (gridKey) => !finalizedGrids.some((row) => row.gridKey === gridKey),
        ) ?? null
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
