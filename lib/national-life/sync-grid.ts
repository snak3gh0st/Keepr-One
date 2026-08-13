import {
  NATIONAL_LIFE_GRIDS,
  fetchNationalLifeGrid,
  type GridPage,
  type NationalLifeGridKey,
} from './portal-grid-client'
import { persistCaseSnapshots, toCaseSnapshots } from './case-snapshot-service'
import {
  persistInforcePolicies,
  toInforcePolicySnapshots,
} from './inforce-policy-service'
import { persistReportRows, toReportRows } from './report-row-service'
import type { PromotionCreditSyncResult } from './promotion-credit-sync'
import {
  NATIONAL_LIFE_SYNC_STAGES,
  type NationalLifeSyncStage,
} from './sync-progress'

export const NATIONAL_LIFE_SYNC_GRID_KEYS = NATIONAL_LIFE_SYNC_STAGES

const CASE_SNAPSHOT_GRIDS: readonly NationalLifeSyncStage[] = [
  'NEW_BUSINESS',
  'RECENTLY_CLOSED',
]
const REPORT_ROW_GRIDS: readonly NationalLifeSyncStage[] = [
  'PAID_COMMISSIONS',
  'CLIENT_INTELLIGENCE',
  'CORRESPONDENCE',
  'COMMISSIONS_PAYMENT_PORTAL',
  'PIP_PENDING',
  'TRANSFERS_EXCHANGES',
  'LIFE_PENDING_LAPSE',
  'COMMISSIONS_EARNING_REPORT',
  'PAYABLE_GROSS_COMMISSIONS',
]

export type GridSyncResult = {
  recordsTotal: number
  rowsFetched: number
  truncated: boolean
  snapshots: number
  written: number
  promotionCredits?: PromotionCreditSyncResult
}

export type NationalLifeGridPersistence = {
  persistCaseSnapshots: typeof persistCaseSnapshots
  persistInforcePolicies: typeof persistInforcePolicies
  persistReportRows: typeof persistReportRows
}

export type NationalLifeGridSyncInput = {
  gridKey: NationalLifeGridKey
  page: GridPage
  agentId: string
  deploymentScope: string
  portalLoginUrl: string
  fetchedAt: Date
  dependencies?: Partial<NationalLifeGridPersistence> & {
    fetchGrid?: typeof fetchNationalLifeGrid
  }
}

export class NationalLifeSyncGridError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function isAllowedGrid(gridKey: NationalLifeGridKey): gridKey is NationalLifeSyncStage {
  return (NATIONAL_LIFE_SYNC_GRID_KEYS as readonly string[]).includes(gridKey)
}

export async function syncNationalLifeGrid(
  input: NationalLifeGridSyncInput,
): Promise<GridSyncResult> {
  if (!isAllowedGrid(input.gridKey)) {
    throw new NationalLifeSyncGridError(
      'GRID_NOT_ALLOWED',
      `Grid ${input.gridKey} is not part of the automatic National Life sync`,
    )
  }

  const dependencies = input.dependencies ?? {}
  const fetched = await (dependencies.fetchGrid ?? fetchNationalLifeGrid)(
    input.page,
    NATIONAL_LIFE_GRIDS[input.gridKey],
    input.portalLoginUrl,
  )
  const counts = {
    recordsTotal: fetched.recordsTotal,
    rowsFetched: fetched.rows.length,
    truncated: fetched.truncated,
  }

  if (input.gridKey === 'INFORCE_CLIENTS') {
    const snapshots = toInforcePolicySnapshots(fetched.rows)
    const persisted = await (dependencies.persistInforcePolicies ?? persistInforcePolicies)({
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      snapshots,
      fetchedAt: input.fetchedAt,
    })
    return {
      ...counts,
      snapshots: snapshots.length,
      written: persisted.written,
      promotionCredits: persisted.promotionCredits,
    }
  }

  if (REPORT_ROW_GRIDS.includes(input.gridKey)) {
    const rows = toReportRows(input.gridKey, fetched.rows)
    const persisted = await (dependencies.persistReportRows ?? persistReportRows)({
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      gridKey: input.gridKey,
      rows,
      fetchedAt: input.fetchedAt,
    })
    return { ...counts, snapshots: rows.length, written: persisted.written }
  }

  if (CASE_SNAPSHOT_GRIDS.includes(input.gridKey)) {
    const snapshots = toCaseSnapshots(fetched.rows)
    const persisted = await (dependencies.persistCaseSnapshots ?? persistCaseSnapshots)({
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      gridKey: input.gridKey,
      snapshots,
      fetchedAt: input.fetchedAt,
    })
    return {
      ...counts,
      snapshots: snapshots.length,
      written: persisted.written,
      promotionCredits: persisted.promotionCredits,
    }
  }

  // The allowlist and the three routing branches are intentionally exhaustive.
  throw new NationalLifeSyncGridError('GRID_NOT_ALLOWED', `Grid ${input.gridKey} is not supported`)
}
