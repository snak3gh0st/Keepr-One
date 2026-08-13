import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import {
  NATIONAL_LIFE_SYNC_STAGES,
  syncProgressFromJobs,
  syncRunStateFromJobs,
  type NationalLifeSyncRunState,
} from './sync-progress'
import { expireStaleLocalConnectorRuns } from './local-connector/run-service'
import { NATIONAL_LIFE_DISCOVERY_PAGE_KEYS } from './read-coverage'

const ACTIVE_RUN_STATES: readonly NationalLifeSyncRunState[] = [
  'QUEUED',
  'RUNNING',
  'PAUSED',
]

export type StartNationalLifeSyncInput = {
  agentId: string
  deploymentScope: string
  now: Date
}

export type NationalLifeSyncRunTransaction = Pick<
  Prisma.TransactionClient,
  'nationalLifeSyncRun' | 'browserAutomationJob'
>

export type NationalLifeSyncStatus = {
  runId: string
  state: NationalLifeSyncRunState
  completed: number
  total: number
  percent: number
  failed: number
  currentGridKey: string | null
  currentGridLabel: string | null
  safeErrorCode: string | null
  shouldPoll: boolean
  completedAt: Date | null
  /// Linhas que o dispositivo entregou e linhas que sobreviveram à normalização.
  /// Nulo quando não há recibo nenhum para consultar — um run REMOTE não gera
  /// recibos, e dizer "0 gravadas" ali seria acusar de vazio um sync que deu
  /// certo. Com número, o par expõe o caso que motivou a coluna: recebi 200,
  /// escrevi 0.
  receivedRecords: number | null
  writtenRecords: number | null
  /// The per-area truth behind the headline counter. A local run only becomes
  /// VERIFIED after the connector reconciles all its pages with recordsTotal.
  stageCoverage?: NationalLifeStageCoverage[]
}

export type NationalLifeStageCoverage = {
  gridKey: string
  label: string | null
  state: 'PENDING' | 'READING' | 'CAPTURED' | 'VERIFIED' | 'FAILED'
  verifiedRecords: number | null
}

/// Rótulos em inglês: quem lê é um agente americano.
const GRID_LABELS: Record<string, string> = {
  NEW_BUSINESS: 'new business',
  RECENTLY_CLOSED: 'recently closed cases',
  INFORCE_CLIENTS: 'in-force policies',
  PAID_COMMISSIONS: 'paid commissions',
  PROJECTED_COMMISSIONS: 'projected commissions',
  CLIENT_INTELLIGENCE: 'client intelligence',
  CORRESPONDENCE: 'correspondence',
  COMMISSIONS_PAYMENT_PORTAL: 'commission payments',
  PIP_PENDING: 'pending increases',
  TRANSFERS_EXCHANGES: 'transfers and exchanges',
  LIFE_PENDING_LAPSE: 'pending lapse policies',
  COMMISSIONS_EARNING_REPORT: 'commission earning detail',
  PAYABLE_GROSS_COMMISSIONS: 'payable gross commissions',
  AGENT_DASHBOARD: 'agent dashboard',
  PREMIUM_REPORT_AGENCY: 'premium report',
  POLICY_PAYMENT_HISTORY: 'policy payment history',
  LIFE_PERSISTENCY: 'life persistency',
  PENDING_GROSS_COMMISSIONS: 'pending gross commissions',
  COMMISSIONS_OVERVIEW: 'commission overview',
  COMMISSIONS_POLICY_HISTORY: 'policy commission history',
  PLACEMENT_REPORT: 'placement report',
  DAILY_UNIT_VALUES: 'daily unit values',
  PIP_CONTRIBUTION_INCREASE: 'PIP contribution increases',
  ANNUITY_PAST_DUE_CONTRIBUTIONS: 'past-due annuity contributions',
  ANNUITY_PAYROLL_FLOW_CHANGES: 'annuity payroll flow changes',
  INFORMAL_REQUESTS: 'informal requests',
  TRANSFER_COMPANY_INFORMATION: 'transfer company information',
}

const DISCOVERY_PAGE_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)

export function nationalLifeSyncGridLabel(gridKey: string | null): string | null {
  return gridKey ? GRID_LABELS[gridKey] ?? null : null
}

export function localStageCoverage(input: {
  plannedGridKeys: readonly string[]
  totalStages: number
  currentGridKey: string | null
  failedGridKeys: readonly string[]
  completions: ReadonlyArray<{ gridKey: string; expectedRecordCount: number }>
}): NationalLifeStageCoverage[] {
  const planned = input.plannedGridKeys.length > 0
    ? input.plannedGridKeys
    : NATIONAL_LIFE_SYNC_STAGES.slice(0, input.totalStages)
  const completed = new Map(input.completions.map((row) => [row.gridKey, row.expectedRecordCount]))
  return planned.map((gridKey) => ({
    gridKey,
    label: nationalLifeSyncGridLabel(gridKey),
    state: completed.has(gridKey)
      ? DISCOVERY_PAGE_KEYS.has(gridKey) ? 'CAPTURED' : 'VERIFIED'
      : gridKey === input.currentGridKey
        ? 'READING'
        : input.failedGridKeys.includes(gridKey)
          ? 'FAILED'
          : 'PENDING',
    verifiedRecords: completed.get(gridKey) ?? null,
  }))
}

export type StageReceiptTotals = {
  receivedRecords: number | null
  writtenRecords: number | null
}

/// `writtenCount` é opcional no schema: recibos anteriores à coluna são nulos.
/// Somá-los como zero transformaria "não sei" em "não escrevi nada", que é a
/// mentira oposta à que a coluna existe para evitar.
export function summarizeStageReceipts(
  receipts: ReadonlyArray<{ recordCount: number; writtenCount: number | null }>,
): StageReceiptTotals {
  if (receipts.length === 0) {
    return { receivedRecords: null, writtenRecords: null }
  }
  const known = receipts.filter((receipt) => typeof receipt.writtenCount === 'number')
  return {
    receivedRecords: receipts.reduce((total, receipt) => total + receipt.recordCount, 0),
    writtenRecords:
      known.length === 0
        ? null
        : known.reduce((total, receipt) => total + (receipt.writtenCount ?? 0), 0),
  }
}

export async function startNationalLifeSync(
  tx: NationalLifeSyncRunTransaction,
  input: StartNationalLifeSyncInput,
): Promise<{ runId: string; duplicate: boolean }> {
  const active = await tx.nationalLifeSyncRun.findFirst({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'REMOTE',
      state: { in: [...ACTIVE_RUN_STATES] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (active) {
    return { runId: active.id, duplicate: true }
  }

  const run = await tx.nationalLifeSyncRun.create({
    data: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'REMOTE',
      totalStages: NATIONAL_LIFE_SYNC_STAGES.length,
      createdAt: input.now,
      updatedAt: input.now,
    },
    select: { id: true },
  })

  await tx.browserAutomationJob.createMany({
    data: NATIONAL_LIFE_SYNC_STAGES.map((gridKey, syncStageIndex) => ({
      agentId: input.agentId,
      provider: NATIONAL_LIFE_PROVIDER,
      operation: 'SYNC_NATIONAL_LIFE_GRID' as const,
      syncRunId: run.id,
      syncStageIndex,
      syncGridKey: gridKey,
      state: 'QUEUED' as const,
      idempotencyKey: `national-life:sync:${input.agentId}:${run.id}:${syncStageIndex}`,
      input: { syncRunId: run.id, gridKey },
      availableAt: input.now,
    })),
  })

  return { runId: run.id, duplicate: false }
}

type ReconcileInput = StartNationalLifeSyncInput & { runId: string }

export async function reconcileNationalLifeSync(
  tx: NationalLifeSyncRunTransaction,
  input: ReconcileInput,
): Promise<void> {
  const run = await tx.nationalLifeSyncRun.findFirst({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'REMOTE',
    },
    select: {
      startedAt: true,
      completedAt: true,
      plannedGridKeys: true,
      jobs: {
        select: { state: true, syncStageIndex: true, syncGridKey: true },
        orderBy: { syncStageIndex: 'asc' },
      },
    },
  })
  if (!run) {
    return
  }

  const progress = syncProgressFromJobs(run.jobs)
  const state = syncRunStateFromJobs(run.jobs)
  const terminal = state === 'COMPLETED' || state === 'PARTIAL' || state === 'FAILED'
  await tx.nationalLifeSyncRun.updateMany({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'REMOTE',
    },
    data: {
      state,
      completedStages: progress.completed,
      failedStages: progress.failed,
      currentGridKey: progress.currentGridKey,
      startedAt:
        run.startedAt ?? (state === 'RUNNING' || terminal ? input.now : undefined),
      completedAt: terminal ? run.completedAt ?? input.now : null,
      updatedAt: input.now,
    },
  })
}

export async function getNationalLifeSyncStatus(
  agentId: string,
  deploymentScope: string,
): Promise<NationalLifeSyncStatus | null> {
  await expireStaleLocalConnectorRuns(prisma, { agentId })
  const run = await prisma.nationalLifeSyncRun.findFirst({
    where: {
      agentId,
      deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      state: true,
      executionSource: true,
      completedStages: true,
      totalStages: true,
      failedStages: true,
      currentGridKey: true,
      plannedGridKeys: true,
      safeErrorCode: true,
      completedAt: true,
      jobs: {
        select: { state: true, syncStageIndex: true, syncGridKey: true },
        orderBy: { syncStageIndex: 'asc' },
      },
      stageReceipts: { select: { recordCount: true, writtenCount: true } },
      stageCompletions: { select: { gridKey: true, expectedRecordCount: true } },
      stageFailures: {
        where: { resolvedAt: null },
        select: { gridKey: true },
      },
    },
  })
  if (!run) {
    return null
  }

  const totals = summarizeStageReceipts(run.stageReceipts)

  if (run.executionSource === 'LOCAL') {
    const completed = run.completedStages
    const total = run.totalStages
    return {
      runId: run.id,
      state: run.state as NationalLifeSyncRunState,
      completed,
      total,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100),
      failed: run.failedStages,
      currentGridKey: run.currentGridKey,
      currentGridLabel: nationalLifeSyncGridLabel(run.currentGridKey),
      safeErrorCode: run.safeErrorCode,
      shouldPoll: run.state === 'QUEUED' || run.state === 'RUNNING' || run.state === 'PAUSED',
      completedAt: run.completedAt,
      ...totals,
      stageCoverage: localStageCoverage({
        plannedGridKeys: run.plannedGridKeys,
        totalStages: total,
        currentGridKey: run.currentGridKey,
        failedGridKeys: run.stageFailures.map((failure) => failure.gridKey),
        completions: run.stageCompletions,
      }),
    }
  }

  const progress = syncProgressFromJobs(run.jobs)
  const state = run.state as NationalLifeSyncRunState
  return {
    runId: run.id,
    state,
    ...progress,
    currentGridLabel: nationalLifeSyncGridLabel(progress.currentGridKey),
    safeErrorCode: run.safeErrorCode,
    shouldPoll: state === 'QUEUED' || state === 'RUNNING' || state === 'PAUSED',
    completedAt: run.completedAt,
    ...totals,
    stageCoverage: run.jobs.map((job) => ({
      gridKey: job.syncGridKey ?? 'UNKNOWN',
      label: nationalLifeSyncGridLabel(job.syncGridKey ?? null),
      state: job.state === 'SUCCEEDED' ? 'VERIFIED' : job.state === 'FAILED' ? 'FAILED' : job.syncGridKey === progress.currentGridKey ? 'READING' : 'PENDING',
      verifiedRecords: null,
    })),
  }
}
