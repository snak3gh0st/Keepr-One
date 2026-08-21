/**
 * Shared by Next server routes and the standalone National Life TSX worker.
 * Keep this dependency graph free of `server-only`: that package intentionally
 * throws when the worker imports the shared run service outside Next.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import type { NationalLifeGridKey } from '../portal-grid-client'
import {
  planReadGridStages,
  planReadPageStages,
  planReadExportStages,
  type LocalConnectorStagePlan,
} from './capabilities'
import {
  LOCAL_CONNECTOR_SCHEMA_VERSION,
  type LocalConnectorRawStageEnvelope,
} from './contracts'
import { planRawIngest } from './raw-ingest'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'
import { NATIONAL_LIFE_SYNC_STAGES } from '../sync-progress'
import { NATIONAL_LIFE_DISCOVERY_PAGE_KEYS } from '../read-coverage'

export { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'

/// Every query that reads or mutates a run filters on `agentId` *and*
/// `deploymentScope`. The scope is a constant today, so an agent cannot in fact
/// hold runs under two scopes — but the tenancy predicate is what makes that a
/// property of the query rather than of the current configuration, and queries
/// that disagree on it are how the gap becomes reachable later.

export const LOCAL_CONNECTOR_RUN_TTL_MS = 30 * 60_000
/// Um clique repetido depois de um sync completo não deve reabrir o portal e
/// reler tudo. A janela é deliberadamente finita: depois dela, Sync significa
/// buscar uma fotografia nova, não servir indefinidamente a antiga.
export const LOCAL_CONNECTOR_VERIFIED_FRESH_MS = 24 * 60 * 60_000
/// The grids a run reads when the caller does not name any. This is the common
/// operational plan; callers can still request a narrower subset explicitly.
export const LOCAL_CONNECTOR_LEGACY_GRID_KEYS = [
  'NEW_BUSINESS',
  'INFORCE_CLIENTS',
] as const satisfies readonly NationalLifeGridKey[]
export const LOCAL_CONNECTOR_DEFAULT_GRID_KEYS = [
  ...NATIONAL_LIFE_SYNC_STAGES,
] as const
export const LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS = [
  ...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS,
  ...NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
] as const
const DISCOVERY_PAGE_KEYS = new Set<NationalLifeGridKey>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)
// The carrier's projected-commission route is only a menu redirect to payable
// gross commissions. Keep the catalogue key for old envelopes, but never plan
// it as an independent source again.
const DEPRECATED_LOCAL_CONNECTOR_GRID_KEYS = new Set<NationalLifeGridKey>([
  'PROJECTED_COMMISSIONS',
])
const UPSERT_CHUNK_SIZE = 100

type LocalConnectorDb = Pick<
  PrismaClient,
  | 'nationalLifeSyncRun'
  | 'nationalLifeConnectorStageReceipt'
  | 'nationalLifeConnectorStageCompletion'
  | 'nationalLifeConnectorStageFailure'
  | 'nationalLifeCaseSnapshot'
  | 'nationalLifeInforcePolicy'
  | 'nationalLifeReportRow'
  | 'nationalLifeRawGridPage'
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

export class LocalConnectorStageCompletionError extends Error {
  constructor(
    readonly code: 'STAGE_INCOMPLETE' | 'STAGE_TRUNCATED',
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

function nextUnsettledStageIndex(
  planned: readonly NationalLifeGridKey[],
  completedKeys: readonly string[],
  failedKeys: readonly string[],
): number {
  const settled = new Set([...completedKeys, ...failedKeys])
  const index = planned.findIndex((gridKey) => !settled.has(gridKey))
  return index === -1 ? planned.length : index
}

function planLocalConnectorStages(
  keys: readonly NationalLifeGridKey[],
  options?: { exportEnabled?: boolean },
): LocalConnectorStagePlan[] {
  const unique = [...new Set(keys)]
  return unique.map((key) =>
    options?.exportEnabled && key === 'INFORCE_CLIENTS'
      ? planReadExportStages([key])[0]!
      : DISCOVERY_PAGE_KEYS.has(key)
      ? planReadPageStages([key])[0]!
      : planReadGridStages([key])[0]!,
  )
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
  options?: { gridKeys?: readonly NationalLifeGridKey[]; forceRefresh?: boolean; exportEnabled?: boolean },
): Promise<{
  runId: string
  schemaVersion: typeof LOCAL_CONNECTOR_SCHEMA_VERSION
  stages: LocalConnectorStagePlan[]
  duplicate: boolean
  completedStages: number
  nextStageIndex: number
  resume?: { sequence: number; offset: number; recordCount: number }
}> {
  const now = input.now ?? new Date()
  const requestedGridKeys = options?.gridKeys ?? LOCAL_CONNECTOR_DEFAULT_GRID_KEYS
  // Planned before any write: an unknown grid key must fail the request rather
  // than leave a RUNNING run behind that no device can ever finish.
  const stages = planLocalConnectorStages(requestedGridKeys, {
    exportEnabled: options?.exportEnabled,
  })
  await failStaleLocalRuns(db, { agentId: input.agentId, deviceId: input.deviceId, now })

  const runSelect = {
    id: true,
    state: true,
    plannedGridKeys: true,
    completedStages: true,
    currentGridKey: true,
    stageCompletions: { select: { gridKey: true } },
    stageFailures: { where: { resolvedAt: null }, select: { gridKey: true } },
  } as const
  const runScope = {
    agentId: input.agentId,
    deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
    connectorDeviceId: input.deviceId,
    executionSource: 'LOCAL' as const,
    provider: NATIONAL_LIFE_PROVIDER,
  }
  // An already-running attempt always wins: starting another attempt against it
  // would create competing navigations. Only when there is no live attempt do
  // we look at failed runs, and then the greatest durable cursor wins. This is
  // what prevents a retry from selecting a newer 0-stage failure and repeating
  // areas already verified by an older, more advanced run.
  const running = await db.nationalLifeSyncRun.findFirst({
    where: { ...runScope, state: 'RUNNING' },
    orderBy: { createdAt: 'desc' },
    select: runSelect,
  })
  const failed = await db.nationalLifeSyncRun.findFirst({
    where: {
      ...runScope,
      OR: [
        {
          state: 'FAILED',
          updatedAt: { gte: new Date(now.getTime() - LOCAL_CONNECTOR_VERIFIED_FRESH_MS) },
        },
        {
          state: 'PARTIAL',
          completedAt: { gte: new Date(now.getTime() - LOCAL_CONNECTOR_VERIFIED_FRESH_MS) },
        },
      ],
    },
    orderBy: [{ completedStages: 'desc' }, { createdAt: 'desc' }],
    select: runSelect,
  })
  const completed = options?.forceRefresh
    ? null
    : await db.nationalLifeSyncRun.findFirst({
        where: {
          ...runScope,
          state: 'COMPLETED',
          completedAt: { gte: new Date(now.getTime() - LOCAL_CONNECTOR_VERIFIED_FRESH_MS) },
        },
        orderBy: { completedAt: 'desc' },
        select: runSelect,
      })
  // Turning on page discovery or the official export widens the plan the server
  // asks for, and a run that predates the new sources says nothing about them.
  // Reusing one would report "verified" for a whole freshness window while those
  // sources had never been opened — the flag would read as inert.
  //
  // Only COMPLETED is superseded, and the asymmetry is deliberate:
  //
  // - RUNNING keeps its plan. Swapping stages under a device that is already
  //   navigating is exactly what the plan-authority rule below exists to prevent.
  // - FAILED/PARTIAL keeps its plan too, because it owns a durable cursor worth
  //   resuming. It costs at most one cycle: when it finishes on the narrow plan
  //   it becomes COMPLETED, and the next start supersedes it here.
  // - COMPLETED has nothing left to resume and no reopen path — `reopening` does
  //   not include it, and its `nextStageIndex` is the end of the plan — so it can
  //   only be replaced. Widening it in place would leave a finished run holding
  //   12 of 26 stages with nothing to hand the device.
  const missesRequestedSources = (run: { plannedGridKeys?: string[] } | null) => {
    if (!run) return false
    const stored = plannedGridKeys({ plannedGridKeys: run.plannedGridKeys ?? [] })
    return requestedGridKeys.some((gridKey) => !stored.includes(gridKey))
  }
  const reusableCompleted = missesRequestedSources(completed) ? null : completed
  const active = running ?? (options?.forceRefresh ? null : failed) ?? reusableCompleted
  if (active) {
    const storedPlan = plannedGridKeys(active)
    const activePlan = storedPlan.filter((gridKey) => !DEPRECATED_LOCAL_CONNECTOR_GRID_KEYS.has(gridKey))
    const planChanged = activePlan.length !== storedPlan.length
    const receiptCompletedKeys = active.stageCompletions
      ?.map((row) => row.gridKey)
      .filter((gridKey) => activePlan.includes(gridKey as NationalLifeGridKey)) ?? []
    // Runs created before stage-completion receipts used a verified prefix
    // counter. Preserve that cursor during rollout; current runs use exact keys.
    const completedKeys = receiptCompletedKeys.length > 0
      ? receiptCompletedKeys
      : activePlan.slice(0, active.completedStages)
    const failedKeys = active.stageFailures
      ?.map((row) => row.gridKey)
      .filter((gridKey) => activePlan.includes(gridKey as NationalLifeGridKey)) ?? []
    const currentIndex = active.currentGridKey
      ? activePlan.indexOf(active.currentGridKey as NationalLifeGridKey)
      : -1
    const firstFailedIndex = failedKeys
      .map((key) => activePlan.indexOf(key as NationalLifeGridKey))
      .find((index) => index >= 0)
    const nextStageIndex = active.state === 'COMPLETED'
      ? activePlan.length
      : active.state === 'PARTIAL' && firstFailedIndex !== undefined
        ? firstFailedIndex
        : currentIndex >= 0
          ? currentIndex
          : nextUnsettledStageIndex(activePlan, completedKeys, failedKeys)
    const reopening = active.state === 'FAILED' || active.state === 'PARTIAL'
    const completedStages = completedKeys.filter((key) =>
      activePlan.includes(key as NationalLifeGridKey),
    ).length
    if (reopening || planChanged) {
      // Reopen only the exact run/device/scope selected above. If another
      // retry won the race, its update count is zero and returning the same
      // run remains safe because both callers share the same durable cursor.
      await db.nationalLifeSyncRun.updateMany({
        where: {
          id: active.id,
          agentId: input.agentId,
          deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
          connectorDeviceId: input.deviceId,
          executionSource: 'LOCAL',
          provider: NATIONAL_LIFE_PROVIDER,
          state: active.state,
        },
        data: {
          ...(reopening
            ? {
                state: 'RUNNING' as const,
                safeErrorCode: null,
                completedAt: null,
                failedStages: 0,
                startedAt: now,
              }
            : {
                failedStages: failedKeys.length,
                ...(active.state === 'RUNNING' && planChanged ? { startedAt: now } : {}),
              }),
          ...(planChanged
            ? {
                plannedGridKeys: [...activePlan],
                totalStages: activePlan.length,
                completedStages,
              }
            : {}),
          currentGridKey: activePlan[nextStageIndex] ?? null,
          updatedAt: now,
        },
      })
      // Whatever writes `failedStages: 0` owes the same answer to the rows.
      // Resolving only PARTIAL left a reopened FAILED run reporting zero
      // failures while its unresolved rows still fed `failedKeys` next pass.
      if (reopening && db.nationalLifeConnectorStageFailure) {
        await db.nationalLifeConnectorStageFailure.updateMany({
          where: { runId: active.id, deviceId: input.deviceId, resolvedAt: null },
          data: { resolvedAt: now, updatedAt: now },
        })
      } else if (planChanged) {
        // A plan migration must also retire failures for sources removed from
        // that plan. Otherwise the final stage counts an obsolete failure and
        // the run finishes as "2 failed" while only one planned source failed.
        await db.nationalLifeConnectorStageFailure.updateMany({
          where: {
            runId: active.id,
            deviceId: input.deviceId,
            gridKey: { in: [...DEPRECATED_LOCAL_CONNECTOR_GRID_KEYS] },
            resolvedAt: null,
          },
          data: { resolvedAt: now, updatedAt: now },
        })
      }
    }
    let resume: { sequence: number; offset: number; recordCount: number } | undefined
    const currentGridKey = activePlan[nextStageIndex]
    const inForceRetriedAfterFailure =
      active.state === 'FAILED' || failedKeys.includes('INFORCE_CLIENTS')
    let currentStageHasReceipts = false
    if (currentGridKey && db.nationalLifeConnectorStageReceipt) {
      const receipts = await db.nationalLifeConnectorStageReceipt.findMany({
        where: { runId: active.id, gridKey: currentGridKey },
        orderBy: { sequence: 'asc' },
        select: { sequence: true, nextOffset: true, recordCount: true },
      })
      currentStageHasReceipts = receipts.length > 0
      // Receipts created by v2 have no meaningful offset. Restart that stage
      // from its first page instead of guessing and skipping source rows.
      if (!receipts.some((receipt) => receipt.nextOffset === 0 &&
        (receipt.sequence > 0 || receipt.recordCount > 0))) {
        let sequence = 0
        let offset = 0
        let recordCount = 0
        for (const receipt of receipts) {
          if (receipt.sequence !== sequence || receipt.nextOffset < offset) break
          sequence += 1
          offset = receipt.nextOffset
          recordCount += receipt.recordCount
        }
        if (sequence > 0 || offset > 0) resume = { sequence, offset, recordCount }
      }
    }
    const inForceExportExhausted =
      currentGridKey === 'INFORCE_CLIENTS' &&
      (currentStageHasReceipts || inForceRetriedAfterFailure)
    // The plan comes from the run that already exists, not from what this call
    // asked for: returning the requested grids would hand the device a plan whose
    // stages the run can never account for, and it would never complete.
    return {
      runId: active.id,
      schemaVersion: LOCAL_CONNECTOR_SCHEMA_VERSION,
      // The in-force export gets one attempt per run. Past that, the retry goes
      // through the paginated grid.
      //
      // Three ways the attempt is spent, and the terminal state does not
      // distinguish them: partial receipts exist (mixing strategies would trip
      // idempotency, since both share the same durable coordinates), the stage
      // reported its own failure (run settles PARTIAL), or the export answered
      // nothing at all and the TTL killed the run parked on it (run settles
      // FAILED, no failure row). Keying on the state would cover one and miss
      // the others.
      //
      // Replaying the export replays the same silent hang, and INFORCE_CLIENTS
      // is index 2 of 26 — every source after it, all seven commission ones
      // included, stays unreachable. The grid shares this parser, so the
      // policies still land and only the export-only contact columns are lost.
      // Degrading beats blocking, and neither skips the source.
      stages: planLocalConnectorStages(activePlan, {
        exportEnabled: options?.exportEnabled && !inForceExportExhausted,
      }),
      duplicate: true as const,
      completedStages,
      nextStageIndex,
      ...(resume ? { resume } : {}),
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
      plannedGridKeys: stages.map((stage) =>
        stage.capability === 'READ_GRID' ? stage.params.gridKey : stage.params.sourceKey,
      ),
      currentGridKey: stages[0]
        ? stages[0].capability === 'READ_GRID'
          ? stages[0].params.gridKey
          : stages[0].params.sourceKey
        : null,
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
    completedStages: 0,
    nextStageIndex: 0,
  }
}

export async function failLocalConnectorStage(
  db: LocalConnectorDb,
  input: {
    agentId: string
    deviceId: string
    runId: string
    gridKey: NationalLifeGridKey
    safeErrorCode: string
    retryable?: boolean
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const run = await tx.nationalLifeSyncRun.findFirst({
      where: {
        id: input.runId,
        agentId: input.agentId,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        connectorDeviceId: input.deviceId,
        executionSource: 'LOCAL',
        provider: NATIONAL_LIFE_PROVIDER,
        state: 'RUNNING',
      },
      select: { id: true, plannedGridKeys: true },
    })
    if (!run) throw new LocalConnectorRunError('RUN_NOT_ACTIVE')
    const planned = plannedGridKeys(run)
    if (!planned.includes(input.gridKey)) throw new LocalConnectorRunError('GRID_NOT_PLANNED')

    await tx.nationalLifeConnectorStageFailure.upsert({
      where: {
        deviceId_runId_gridKey: {
          deviceId: input.deviceId,
          runId: run.id,
          gridKey: input.gridKey,
        },
      },
      create: {
        deviceId: input.deviceId,
        runId: run.id,
        gridKey: input.gridKey,
        safeErrorCode: input.safeErrorCode.slice(0, 80),
        retryable: input.retryable ?? true,
        failedAt: now,
        updatedAt: now,
      },
      update: {
        safeErrorCode: input.safeErrorCode.slice(0, 80),
        retryable: input.retryable ?? true,
        failedAt: now,
        resolvedAt: null,
        updatedAt: now,
      },
    })

    const [completions, failures] = await Promise.all([
      tx.nationalLifeConnectorStageCompletion.findMany({
        where: { runId: run.id, truncated: false },
        distinct: ['gridKey'],
        select: { gridKey: true },
      }),
      tx.nationalLifeConnectorStageFailure.findMany({
        where: { runId: run.id, resolvedAt: null },
        select: { gridKey: true },
      }),
    ])
    const completedStages = completions.length
    const failedStages = failures.length
    const nextStageIndex = nextUnsettledStageIndex(
      planned,
      completions.map((row) => row.gridKey),
      failures.map((row) => row.gridKey),
    )
    const terminal = nextStageIndex === planned.length
    await tx.nationalLifeSyncRun.update({
      where: { id: run.id },
      data: {
        state: terminal ? 'PARTIAL' : 'RUNNING',
        completedStages,
        failedStages,
        currentGridKey: terminal ? null : planned[nextStageIndex] ?? null,
        safeErrorCode: terminal ? 'SOURCE_PARTIAL_FAILURE' : null,
        completedAt: terminal ? now : null,
        updatedAt: now,
      },
    })
    return {
      runId: run.id,
      gridKey: input.gridKey,
      completedStages,
      failedStages,
      nextStageIndex,
      terminal,
      state: terminal ? 'PARTIAL' as const : 'RUNNING' as const,
    }
  })
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
  legacyStageCompletion?: boolean
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

/// Returns the quality counters alongside rows actually written. It can be below
/// `envelope.records.length`: the mappers drop rows with no natural key and dedupe
/// on it, so a whole page can normalize to nothing. The receipt records all three
/// numbers so a run that ingested zero rows is visible instead of looking clean.
async function persistRecords(
  tx: Prisma.TransactionClient,
  input: IngestInput,
  observedAt: Date,
): Promise<{ writtenCount: number; duplicateCount: number; rejectedCount: number }> {
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
    return {
      writtenCount: plan.snapshots.length,
      duplicateCount: plan.stats.duplicateCount,
      rejectedCount: plan.stats.rejectedCount,
    }
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
    return {
      writtenCount: plan.snapshots.length,
      duplicateCount: plan.stats.duplicateCount,
      rejectedCount: plan.stats.rejectedCount,
    }
  }

  if (plan.target === 'RAW_PAGE_ONLY') {
    return { writtenCount: 0, duplicateCount: 0, rejectedCount: 0 }
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
  return {
    writtenCount: plan.rows.length,
    duplicateCount: plan.stats.duplicateCount,
    rejectedCount: plan.stats.rejectedCount,
  }
}

/// Removes rows that disappeared from a newly verified carrier snapshot.
///
/// Upserts alone cannot do this: a policy or report row that existed yesterday
/// remains forever when it is absent today. The oldest page timestamp in this
/// run is the publication boundary. Pruning happens only after every page and
/// the carrier total reconcile, so an interrupted refresh keeps the last known
/// complete snapshot intact.
async function pruneRowsMissingFromVerifiedSnapshot(
  tx: Prisma.TransactionClient,
  input: Pick<IngestInput, 'agentId' | 'gridKey'> & { runId: string },
) {
  const firstPage = await tx.nationalLifeRawGridPage.findFirst({
    where: { runId: input.runId, gridKey: input.gridKey },
    orderBy: { observedAt: 'asc' },
    select: { observedAt: true },
  })
  if (!firstPage) throw new LocalConnectorStageCompletionError('STAGE_INCOMPLETE')

  const commonWhere = {
    agentId: input.agentId,
    deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
    fetchedAt: { lt: firstPage.observedAt },
  }
  const target = planRawIngest(input.gridKey, []).target

  if (target === 'CASE_SNAPSHOT') {
    return tx.nationalLifeCaseSnapshot.deleteMany({
      where: { ...commonWhere, gridKey: input.gridKey },
    })
  }
  if (target === 'INFORCE_POLICY') {
    return tx.nationalLifeInforcePolicy.deleteMany({ where: commonWhere })
  }
  return tx.nationalLifeReportRow.deleteMany({
    where: { ...commonWhere, gridKey: input.gridKey },
  })
}

function publicReceipt(receipt: {
  id: string
  runId: string
  gridKey: string
  sequence: number
  contentHash: string
  recordCount: number
  writtenCount: number | null
  duplicateCount?: number | null
  rejectedCount?: number | null
  sourceOffset?: number
  nextOffset?: number
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
    duplicateCount: receipt.duplicateCount ?? 0,
    rejectedCount: receipt.rejectedCount ?? 0,
    sourceOffset: receipt.sourceOffset ?? 0,
    nextOffset: receipt.nextOffset ?? 0,
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
          // A late retry of an already accepted chunk is handled by the
          // idempotency lookup above. A new chunk must never reopen a completed
          // run and move the authoritative status backwards to RUNNING.
          state: 'RUNNING',
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

      const ingest = await persistRecords(tx, input, observedAt)
      // Preserve the carrier payload before normalization. Business models may
      // collapse duplicate policies or reject a row without a natural key; the
      // faithful page snapshot guarantees that this never becomes silent data
      // loss and lets us remap old payloads without reading the carrier again.
      await tx.nationalLifeRawGridPage.upsert({
        where: {
          runId_gridKey_sequence: {
            runId: run.id,
            gridKey: input.gridKey,
            sequence: input.envelope.sequence,
          },
        },
        create: {
          agentId: input.agentId,
          deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
          runId: run.id,
          gridKey: input.gridKey,
          sequence: input.envelope.sequence,
          recordCount: input.envelope.records.length,
          contentHash: input.contentHash,
          records: input.envelope.records as Prisma.InputJsonValue,
          observedAt,
        },
        update: {
          recordCount: input.envelope.records.length,
          contentHash: input.contentHash,
          records: input.envelope.records as Prisma.InputJsonValue,
          observedAt,
        },
      })
      const created = await tx.nationalLifeConnectorStageReceipt.create({
        data: {
          deviceId: input.deviceId,
          runId: run.id,
          gridKey: input.gridKey,
          sequence: input.envelope.sequence,
          sourceOffset: input.envelope.sourceOffset ?? 0,
          nextOffset: input.envelope.nextOffset ??
            ((input.envelope.sourceOffset ?? 0) + input.envelope.records.length),
          truncated: input.envelope.truncated,
          contentHash: input.contentHash,
          // Rows received, not rows written. The content hash is taken over the
          // raw body and owes nothing to this number; what fixes its meaning is
          // that it is a public receipt field, and that paired with writtenCount
          // it makes "received 200, wrote 0" visible instead of clean.
          recordCount: input.envelope.records.length,
          writtenCount: ingest.writtenCount,
          duplicateCount: ingest.duplicateCount,
          rejectedCount: ingest.rejectedCount,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
          updatedAt: now,
        },
      })

      if (input.legacyStageCompletion) {
        // The retired protocol only sends chunks. Preserve its existing behaviour
        // during Store rollout so an installed 0.1.0/0.1.1 does not hang; it is
        // intentionally isolated from the 0.1.2+ path below, which never counts
        // a page as a completed grid.
        const finalizedGrids = await tx.nationalLifeConnectorStageReceipt.findMany({
          where: { runId: run.id, truncated: false },
          distinct: ['gridKey'],
          select: { gridKey: true },
        })
        const completedStages = planned.filter((gridKey) =>
          finalizedGrids.some((row) => row.gridKey === gridKey),
        ).length
        const completed = completedStages === planned.length
        await tx.nationalLifeSyncRun.update({
          where: { id: run.id },
          data: {
            state: completed ? 'COMPLETED' : 'RUNNING',
            completedStages,
            currentGridKey: completed ? null : input.gridKey,
            completedAt: completed ? now : null,
            updatedAt: now,
          },
        })
      } else {
        // A page receipt is deliberately not a stage completion. The extension
        // must upload every sequence and then call completeLocalConnectorStage,
        // which reconciles this durable receipt set with the carrier total.
        await tx.nationalLifeSyncRun.update({
          where: { id: run.id },
          data: { state: 'RUNNING', currentGridKey: input.gridKey, updatedAt: now },
        })
      }
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

/// Marks one grid complete only after every uploaded page has landed. `recordsTotal`
/// comes from the carrier response and the receipts are the server's durable view of
/// what actually arrived, so neither the extension's GRID_DONE nor an optimistic UI
/// counter can make an incomplete stage look complete.
export async function completeLocalConnectorStage(
  db: LocalConnectorDb,
  input: {
    agentId: string
    deviceId: string
    runId: string
    gridKey: NationalLifeGridKey
    expectedRecordCount: number
    finalSequence: number
    truncated: boolean
    now?: Date
  },
) {
  const now = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const run = await tx.nationalLifeSyncRun.findFirst({
      where: {
        id: input.runId,
        agentId: input.agentId,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        connectorDeviceId: input.deviceId,
        executionSource: 'LOCAL',
        provider: NATIONAL_LIFE_PROVIDER,
        state: { in: ['RUNNING', 'COMPLETED'] },
      },
      select: { id: true, state: true, plannedGridKeys: true, completedStages: true },
    })
    if (!run) throw new LocalConnectorRunError('RUN_NOT_FOUND')
    if (!plannedGridKeys(run).includes(input.gridKey)) {
      throw new LocalConnectorRunError('GRID_NOT_PLANNED')
    }
    if (run.state === 'COMPLETED') {
      const completed = await tx.nationalLifeConnectorStageCompletion.findUnique({
        where: {
          deviceId_runId_gridKey: {
            deviceId: input.deviceId,
            runId: run.id,
            gridKey: input.gridKey,
          },
        },
        select: { expectedRecordCount: true, finalSequence: true, receivedRecordCount: true },
      })
      if (
        completed &&
        completed.expectedRecordCount === input.expectedRecordCount &&
        completed.finalSequence === input.finalSequence &&
        input.truncated === false
      ) {
        return {
          runId: run.id,
          gridKey: input.gridKey,
          receivedRecordCount: completed.receivedRecordCount,
          completedStages: run.completedStages,
          completed: true,
        }
      }
      throw new LocalConnectorRunError('RUN_NOT_FOUND')
    }
    if (input.truncated) throw new LocalConnectorStageCompletionError('STAGE_TRUNCATED')

    const receipts = await tx.nationalLifeConnectorStageReceipt.findMany({
      where: { deviceId: input.deviceId, runId: run.id, gridKey: input.gridKey },
      orderBy: { sequence: 'asc' },
      select: { sequence: true, recordCount: true },
    })
    const receivedRecordCount = receipts.reduce((total, receipt) => total + receipt.recordCount, 0)
    const sequencesAreComplete =
      receipts.length === input.finalSequence + 1 &&
      receipts.every((receipt, index) => receipt.sequence === index)
    if (!sequencesAreComplete || receivedRecordCount !== input.expectedRecordCount) {
      throw new LocalConnectorStageCompletionError('STAGE_INCOMPLETE')
    }

    await tx.nationalLifeConnectorStageCompletion.upsert({
      where: {
        deviceId_runId_gridKey: {
          deviceId: input.deviceId,
          runId: run.id,
          gridKey: input.gridKey,
        },
      },
      create: {
        deviceId: input.deviceId,
        runId: run.id,
        gridKey: input.gridKey,
        expectedRecordCount: input.expectedRecordCount,
        receivedRecordCount,
        finalSequence: input.finalSequence,
        truncated: false,
        completedAt: now,
      },
      update: {
        expectedRecordCount: input.expectedRecordCount,
        receivedRecordCount,
        finalSequence: input.finalSequence,
        truncated: false,
        completedAt: now,
      },
    })
    await tx.nationalLifeConnectorStageFailure.updateMany({
      where: { runId: run.id, deviceId: input.deviceId, gridKey: input.gridKey, resolvedAt: null },
      data: { resolvedAt: now, updatedAt: now },
    })

    await pruneRowsMissingFromVerifiedSnapshot(tx, {
      agentId: input.agentId,
      runId: run.id,
      gridKey: input.gridKey,
    })

    // Keep exactly one verified raw snapshot per agent and grid. Crucially this
    // happens only after every page reconciles with the carrier total, so a
    // failed replacement can never destroy the previous complete snapshot.
    await tx.nationalLifeRawGridPage.deleteMany({
      where: {
        agentId: input.agentId,
        deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
        gridKey: input.gridKey,
        runId: { not: run.id },
      },
    })

    const [finalizedGrids, failedGrids] = await Promise.all([
      tx.nationalLifeConnectorStageCompletion.findMany({
        where: { runId: run.id, truncated: false },
        distinct: ['gridKey'],
        select: { gridKey: true },
      }),
      tx.nationalLifeConnectorStageFailure.findMany({
        where: { runId: run.id, resolvedAt: null },
        select: { gridKey: true },
      }),
    ])
    const planned = plannedGridKeys(run)
    const completedStages = planned.filter((gridKey) =>
      finalizedGrids.some((row) => row.gridKey === gridKey),
    ).length
    const nextStageIndex = nextUnsettledStageIndex(
      planned,
      finalizedGrids.map((row) => row.gridKey),
      failedGrids.map((row) => row.gridKey),
    )
    const terminal = nextStageIndex === planned.length
    const completed = terminal && failedGrids.length === 0
    await tx.nationalLifeSyncRun.update({
      where: { id: run.id },
      data: {
        state: completed ? 'COMPLETED' : terminal ? 'PARTIAL' : 'RUNNING',
        completedStages,
        failedStages: failedGrids.length,
        currentGridKey: terminal ? null : planned[nextStageIndex] ?? input.gridKey,
        safeErrorCode: terminal && !completed ? 'SOURCE_PARTIAL_FAILURE' : null,
        completedAt: terminal ? now : null,
        updatedAt: now,
      },
    })
    return {
      runId: run.id,
      gridKey: input.gridKey,
      receivedRecordCount,
      completedStages,
      failedStages: failedGrids.length,
      nextStageIndex,
      terminal,
      completed,
    }
  })
}
