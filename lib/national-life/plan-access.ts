import {
  NATIONAL_LIFE_GRIDS,
  type NationalLifeGridKey,
} from '@/lib/national-life/portal-grid-client'
import { getAgentAccessForAgent } from '@/lib/agent-access'
import type { NationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import {
  NATIONAL_LIFE_PERSONAL_GRID_KEYS,
} from '@/lib/national-life/plan-access-catalog'
export {
  NATIONAL_LIFE_AGENCY_ONLY_GRID_KEYS,
  NATIONAL_LIFE_PERSONAL_GRID_KEYS,
  isNationalLifeAgencyOnlyGrid,
} from '@/lib/national-life/plan-access-catalog'

const personalKeys = new Set<NationalLifeGridKey>(NATIONAL_LIFE_PERSONAL_GRID_KEYS)

export async function canAgentReadNationalLifeGrid(
  agentId: string,
  gridKey: NationalLifeGridKey,
): Promise<boolean> {
  const access = await getAgentAccessForAgent(agentId)
  if (!access.isActive) return false
  return access.canViewAgencyNationalLife || personalKeys.has(gridKey)
}

export async function filterNationalLifeGridKeysForAgent(
  agentId: string,
  gridKeys: readonly NationalLifeGridKey[],
): Promise<NationalLifeGridKey[]> {
  const access = await getAgentAccessForAgent(agentId)
  if (!access.isActive) return []
  return access.canViewAgencyNationalLife
    ? [...gridKeys]
    : gridKeys.filter((gridKey) => personalKeys.has(gridKey))
}

/** Removes historical agency-only progress after downgrade as well as at run start. */
export async function sanitizeNationalLifeSyncStatusForAgent(
  agentId: string,
  status: NationalLifeSyncStatus | null,
): Promise<NationalLifeSyncStatus | null> {
  if (!status) return null

  const coverage = status.stageCoverage ?? []
  const knownCoverage = coverage.filter(
    (stage): stage is typeof stage & { gridKey: NationalLifeGridKey } =>
      stage.gridKey in NATIONAL_LIFE_GRIDS,
  )
  const permittedKeys = new Set(
    await filterNationalLifeGridKeysForAgent(
      agentId,
      knownCoverage.map((stage) => stage.gridKey),
    ),
  )
  const visibleCoverage = knownCoverage.filter((stage) => permittedKeys.has(stage.gridKey))
  const hiddenAny = visibleCoverage.length !== coverage.length
  const completedStates = new Set(['CAPTURED', 'VERIFIED', 'REUSED'])
  const completed = visibleCoverage.filter((stage) => completedStates.has(stage.state)).length
  const failed = visibleCoverage.filter((stage) => stage.state === 'FAILED').length
  const total = visibleCoverage.length
  const currentGridVisible = status.currentGridKey
    ? permittedKeys.has(status.currentGridKey as NationalLifeGridKey)
    : false

  return {
    ...status,
    completed: coverage.length > 0 ? completed : status.completed,
    total: coverage.length > 0 ? total : status.total,
    percent: coverage.length > 0
      ? total === 0 ? 0 : Math.round((completed / total) * 100)
      : status.percent,
    failed: coverage.length > 0 ? failed : status.failed,
    currentGridKey: currentGridVisible ? status.currentGridKey : null,
    currentGridLabel: currentGridVisible ? status.currentGridLabel : null,
    stageCoverage: visibleCoverage,
    ...(hiddenAny
      ? {
          receivedRecords: null,
          writtenRecords: null,
          duplicateRecords: null,
          rejectedRecords: null,
          estimate: null,
          delta: null,
        }
      : {}),
  }
}
