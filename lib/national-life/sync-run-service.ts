import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import {
  NATIONAL_LIFE_SYNC_STAGES,
  syncProgressFromJobs,
  syncRunStateFromJobs,
  type NationalLifeSyncRunState,
} from './sync-progress'

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
}

const GRID_LABELS: Record<string, string> = {
  NEW_BUSINESS: 'novos negócios',
  RECENTLY_CLOSED: 'casos encerrados recentemente',
  INFORCE_CLIENTS: 'apólices em vigor',
  PAID_COMMISSIONS: 'comissões pagas',
  PROJECTED_COMMISSIONS: 'comissões projetadas',
  CLIENT_INTELLIGENCE: 'inteligência de clientes',
  CORRESPONDENCE: 'correspondências',
  COMMISSIONS_PAYMENT_PORTAL: 'pagamentos de comissão',
  PIP_PENDING: 'pendências de aumento',
}

export function nationalLifeSyncGridLabel(gridKey: string | null): string | null {
  return gridKey ? GRID_LABELS[gridKey] ?? null : null
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
      safeErrorCode: true,
      completedAt: true,
      jobs: {
        select: { state: true, syncStageIndex: true, syncGridKey: true },
        orderBy: { syncStageIndex: 'asc' },
      },
    },
  })
  if (!run) {
    return null
  }

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
  }
}

