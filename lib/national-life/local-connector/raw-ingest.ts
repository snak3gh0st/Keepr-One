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
  // These grids are preserved as generic carrier report rows until their
  // business-specific models are defined. Raw retention keeps no portal data
  // hostage to a future mapper.
  'TRANSFERS_EXCHANGES',
  'LIFE_PENDING_LAPSE',
  'COMMISSIONS_EARNING_REPORT',
  'PAYABLE_GROSS_COMMISSIONS',
])

/// The grids `planRawIngest` can actually land somewhere, derived from the three
/// routing sets above rather than written out a fourth time — a key can only appear
/// here by being routed. Exported so planning can refuse an unroutable grid before a
/// run exists, instead of letting the first stage discover it on a device mid-run.
export const LOCAL_CONNECTOR_ROUTED_GRIDS: ReadonlySet<NationalLifeGridKey> = new Set([
  ...CASE_SNAPSHOT_GRIDS,
  ...INFORCE_GRIDS,
  ...REPORT_ROW_GRIDS,
])

export function isRoutedGrid(gridKey: NationalLifeGridKey): boolean {
  return LOCAL_CONNECTOR_ROUTED_GRIDS.has(gridKey)
}

export class LocalConnectorRawIngestError extends Error {
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
  throw new LocalConnectorRawIngestError('GRID_NOT_ROUTED', gridKey)
}
