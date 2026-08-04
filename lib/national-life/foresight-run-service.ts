import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { FORESIGHT_SSO_EXPIRED, NATIONAL_LIFE_PROVIDER } from './constants'

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
  if (job.state === 'ACTION_REQUIRED' || job.safeErrorCode === FORESIGHT_SSO_EXPIRED) return 'PAUSED'
  if (job.state === 'RUNNING') return 'RUNNING'
  if (job.state === 'QUEUED') return 'QUEUED'
  if (job.state === 'SUCCEEDED') return 'COMPLETED'
  return job.state === 'FAILED' || job.state === 'CANCELLED' ? 'FAILED' : 'QUEUED'
}

export function createForesightRunStore(repository: ForesightRepository): ForesightRunStore {
  return {
    async start(input) {
      const active = await repository.nationalLifeForesightReadRun.findFirst({
        where: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          state: { in: [...ACTIVE_STATES] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, jobs: { select: { id: true }, take: 1 } },
      })
      if (active?.jobs[0]) {
        return { runId: active.id, jobId: active.jobs[0].id, duplicate: true }
      }

      const run = await repository.nationalLifeForesightReadRun.create({
        data: {
          agentId: input.agentId,
          deploymentScope: input.deploymentScope,
          provider: NATIONAL_LIFE_PROVIDER,
          mode: input.mode,
          targetCaseId: input.targetCaseId,
          createdAt: input.now,
          updatedAt: input.now,
        },
        select: { id: true },
      })
      const job = await repository.browserAutomationJob.create({
        data: {
          agentId: input.agentId,
          provider: NATIONAL_LIFE_PROVIDER,
          operation: 'SYNC_FORESIGHT_READ',
          foresightRunId: run.id,
          state: 'QUEUED',
          idempotencyKey: `national-life:foresight:${input.agentId}:${input.deploymentScope}:${input.mode}:${input.targetCaseId ?? 'all'}`,
          input: { foresightRunId: run.id, mode: input.mode, ...(input.targetCaseId ? { targetCaseId: input.targetCaseId } : {}) },
          availableAt: input.now,
        },
        select: { id: true },
      })
      return { runId: run.id, jobId: job.id, duplicate: false }
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
        select: { completedAt: true, jobs: { select: { state: true, safeErrorCode: true, finishedAt: true } } },
      })
      const job = run?.jobs[0]
      if (!run || !job) return
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
