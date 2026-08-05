import 'server-only'
import { toCaseSnapshots, type CaseSnapshot } from '@/lib/national-life/case-snapshot-service'
import {
  toInforcePolicySnapshots,
  type InforcePolicySnapshot,
} from '@/lib/national-life/inforce-policy-service'
import { toReportRows, type ReportRow } from '@/lib/national-life/report-row-service'
import type { NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'

const CASE_SNAPSHOT_GRIDS = new Set<NationalLifeGridKey>(['NEW_BUSINESS', 'RECENTLY_CLOSED'])
const INFORCE_GRIDS = new Set<NationalLifeGridKey>(['INFORCE_CLIENTS'])
const REPORT_ROW_GRIDS = new Set<NationalLifeGridKey>([
  'PAID_COMMISSIONS',
  'PROJECTED_COMMISSIONS',
  'CLIENT_INTELLIGENCE',
  'CORRESPONDENCE',
  'COMMISSIONS_PAYMENT_PORTAL',
  'PIP_PENDING',
])

export class RawIngestRouteError extends Error {
  constructor(readonly code: 'GRID_NOT_ROUTED', readonly gridKey: NationalLifeGridKey) {
    super(`No ingest route for grid ${gridKey}`)
  }
}

export type RawIngestPlan =
  | { target: 'CASE_SNAPSHOT'; gridKey: NationalLifeGridKey; snapshots: CaseSnapshot[] }
  | { target: 'INFORCE_POLICY'; gridKey: NationalLifeGridKey; snapshots: InforcePolicySnapshot[] }
  | { target: 'REPORT_ROW'; gridKey: NationalLifeGridKey; rows: ReportRow[] }

/// Mirrors the routing in sync-grid.ts so the local and remote paths cannot drift.
/// Pure: the caller owns the write, because the persist helpers bind the module-level
/// Prisma client and cannot run inside the stage-ingest transaction.
export function planRawIngest(
  gridKey: NationalLifeGridKey,
  rows: Record<string, unknown>[],
): RawIngestPlan {
  if (CASE_SNAPSHOT_GRIDS.has(gridKey)) {
    return { target: 'CASE_SNAPSHOT', gridKey, snapshots: toCaseSnapshots(rows) }
  }
  if (INFORCE_GRIDS.has(gridKey)) {
    return { target: 'INFORCE_POLICY', gridKey, snapshots: toInforcePolicySnapshots(rows) }
  }
  if (REPORT_ROW_GRIDS.has(gridKey)) {
    return { target: 'REPORT_ROW', gridKey, rows: toReportRows(gridKey, rows) }
  }
  throw new RawIngestRouteError('GRID_NOT_ROUTED', gridKey)
}
