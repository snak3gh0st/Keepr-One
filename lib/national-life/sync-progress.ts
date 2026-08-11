import type { BrowserJobState } from './job-state'
import { NATIONAL_LIFE_AUTOMATIC_GRID_KEYS } from './read-coverage'

export const NATIONAL_LIFE_SYNC_STAGES = NATIONAL_LIFE_AUTOMATIC_GRID_KEYS

export type NationalLifeSyncStage = (typeof NATIONAL_LIFE_SYNC_STAGES)[number]

export type NationalLifeSyncRunState =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'

export type SyncProgressJob = {
  state: BrowserJobState | string
  syncStageIndex: number | null
  syncGridKey?: string | null
}

export type NationalLifeSyncProgress = {
  completed: number
  total: number
  percent: number
  currentGridKey: string | null
  failed: number
}

const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'])

export function syncProgressFromJobs(
  jobs: readonly SyncProgressJob[],
): NationalLifeSyncProgress {
  const completed = jobs.filter((job) => job.state === 'SUCCEEDED').length
  const failed = jobs.filter((job) => job.state === 'FAILED').length
  const current = [...jobs]
    .filter((job) => job.syncStageIndex !== null && !TERMINAL_STATES.has(job.state))
    .sort((left, right) => (left.syncStageIndex ?? 0) - (right.syncStageIndex ?? 0))[0]

  return {
    completed,
    total: NATIONAL_LIFE_SYNC_STAGES.length,
    percent: Math.round((completed / NATIONAL_LIFE_SYNC_STAGES.length) * 100),
    currentGridKey: current?.syncGridKey ?? null,
    failed,
  }
}

export function syncRunStateFromJobs(
  jobs: readonly SyncProgressJob[],
): NationalLifeSyncRunState {
  if (jobs.some((job) => job.state === 'ACTION_REQUIRED')) {
    return 'PAUSED'
  }

  if (jobs.some((job) => !TERMINAL_STATES.has(job.state))) {
    return jobs.some((job) => job.state === 'RUNNING') ? 'RUNNING' : 'QUEUED'
  }

  return jobs.some((job) => job.state === 'FAILED') ? 'PARTIAL' : 'COMPLETED'
}
