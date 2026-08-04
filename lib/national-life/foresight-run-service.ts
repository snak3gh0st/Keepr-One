import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isNationalLifeLoginRequiredCode, NATIONAL_LIFE_PROVIDER } from './constants'

const ACTIVE_STATES = ['QUEUED', 'RUNNING', 'PAUSED'] as const
const TERMINAL_STATES = new Set(['COMPLETED', 'PARTIAL', 'FAILED'])

export type ForesightReadStatus = {
  runId: string
  mode: 'INVENTORY' | 'DETAIL'
  state: 'QUEUED' | 'RUNNING' | 'PAUSED' | 'PARTIAL' | 'COMPLETED' | 'FAILED'
  totalCases: number
  inventoriedCases: number
  totalServices: number
  completedServices: number
  currentCaseName: string | null
  currentService: string | null
  percent: number
  shouldPoll: boolean
  completedAt: Date | null
}

export type ForesightRunStore = {
  start(input: {
    agentId: string
    deploymentScope: string
    mode: 'INVENTORY' | 'DETAIL'
    targetCaseId?: string
    now: Date
  }): Promise<{ runId: string; jobId: string; duplicate: boolean }>
  updateProgress(input: {
    runId: string
    agentId: string
    deploymentScope: string
    patch: {
      totalCases?: number
      inventoriedCases?: number
      totalServices?: number
      completedServices?: number
      currentCaseName?: string | null
      currentService?: string | null
    }
  }): Promise<void>
  reconcile(input: { runId: string; agentId: string; deploymentScope: string }): Promise<void>
  getStatus(agentId: string, deploymentScope: string): Promise<ForesightReadStatus | null>
}

type ForesightRepository = Pick<
  Prisma.TransactionClient,
  'nationalLifeForesightReadRun' | 'browserAutomationJob'
>

type ForesightRunStoreRepository = ForesightRepository & {
  $transaction?: <T>(
    operation: (transaction: ForesightRepository) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => Promise<T>
}

function percent(run: Pick<ForesightReadStatus, 'totalCases' | 'inventoriedCases' | 'totalServices' | 'completedServices'>): number {
  const total = run.totalCases + run.totalServices
  return total === 0 ? 0 : Math.round(((run.inventoriedCases + run.completedServices) / total) * 100)
}

function statusFromRun(run: Omit<ForesightReadStatus, 'percent' | 'shouldPoll'>): ForesightReadStatus {
  return {
    ...run,
    percent: percent(run),
    shouldPoll: run.state === 'QUEUED' || run.state === 'RUNNING',
  }
}

function stateFromJob(job: { state: string; safeErrorCode: string | null }): ForesightReadStatus['state'] {
  if (
    isNationalLifeLoginRequiredCode(job.safeErrorCode) ||
    job.state === 'ACTION_REQUIRED' ||
    job.state === 'WAITING_FOR_MFA' ||
    job.state === 'CREDENTIALS_EXPIRED'
  ) return 'PAUSED'
  if (job.state === 'RUNNING') return 'RUNNING'
  if (job.state === 'QUEUED') return 'QUEUED'
  if (job.state === 'SUCCEEDED') return 'COMPLETED'
  return job.state === 'FAILED' || job.state === 'CANCELLED' ? 'FAILED' : 'QUEUED'
}

async function findActiveForesightRun(
  repository: ForesightRepository,
  input: Parameters<ForesightRunStore['start']>[0],
) {
  return repository.nationalLifeForesightReadRun.findFirst({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      mode: input.mode,
      targetCaseId: input.targetCaseId ?? null,
      state: { in: [...ACTIVE_STATES] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, jobs: { select: { id: true }, take: 1 } },
  })
}

export async function startForesightReadRun(
  repository: ForesightRepository,
  input: Parameters<ForesightRunStore['start']>[0],
): Promise<{ runId: string; jobId: string; duplicate: boolean }> {
  const active = await findActiveForesightRun(repository, input)
  if (active?.jobs[0]) return { runId: active.id, jobId: active.jobs[0].id, duplicate: true }

  const run = await repository.nationalLifeForesightReadRun.create({
    data: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      mode: input.mode,
      targetCaseId: input.targetCaseId ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    },
    select: { id: true },
  })
  const job = await repository.browserAutomationJob.create({
    data: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      operation: 'SYNC_FORESIGHT_READ',
      foresightRunId: run.id,
      state: 'QUEUED',
      idempotencyKey: `national-life:foresight:${input.agentId}:${input.deploymentScope}:${input.mode}:${input.targetCaseId ?? 'all'}`,
      input: {
        foresightRunId: run.id,
        mode: input.mode,
        targetCaseId: input.targetCaseId ?? null,
        deploymentScope: input.deploymentScope,
      },
      availableAt: input.now,
    },
    select: { id: true },
  })
  return { runId: run.id, jobId: job.id, duplicate: false }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

export function createForesightRunStore(repository: ForesightRunStoreRepository): ForesightRunStore {
  return {
    async start(input) {
      const create = (transaction: ForesightRepository) => startForesightReadRun(transaction, input)
      try {
        return repository.$transaction
          ? await repository.$transaction(create, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
          : await create(repository)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        const active = await findActiveForesightRun(repository, input)
        if (!active?.jobs[0]) throw error
        return { runId: active.id, jobId: active.jobs[0].id, duplicate: true }
      }
    },

    async updateProgress(input) {
      await repository.nationalLifeForesightReadRun.updateMany({
        where: {
          id: input.runId,
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
        },
        data: input.patch,
      })
    },

    async reconcile(input) {
      const run = await repository.nationalLifeForesightReadRun.findFirst({
        where: {
          id: input.runId,
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
        },
        select: {
          completedAt: true,
          jobs: { select: { state: true, safeErrorCode: true, finishedAt: true, deploymentScope: true } },
        },
      })
      const job = run?.jobs[0]
      if (!run || !job || job.deploymentScope !== input.deploymentScope) return
      const state = stateFromJob(job)
      await repository.nationalLifeForesightReadRun.updateMany({
        where: {
          id: input.runId,
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
        },
        data: {
          state,
          completedAt: TERMINAL_STATES.has(state) ? run.completedAt ?? job.finishedAt ?? new Date() : null,
        },
      })
    },

    async getStatus(agentId, deploymentScope) {
      const run = await repository.nationalLifeForesightReadRun.findFirst({
        where: { agentId, deploymentScope, provider: NATIONAL_LIFE_PROVIDER },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, mode: true, state: true, totalCases: true, inventoriedCases: true,
          totalServices: true, completedServices: true, currentCaseName: true,
          currentService: true, completedAt: true,
        },
      })
      return run ? statusFromRun({ runId: run.id, ...run }) : null
    },
  }
}

export const foresightRunStore = createForesightRunStore(prisma)
