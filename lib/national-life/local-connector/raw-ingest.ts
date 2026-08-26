import {
  toCaseSnapshot,
  toCaseSnapshots,
  type CaseSnapshot,
} from '@/lib/national-life/case-snapshot-service'
import {
  toInforcePolicySnapshot,
  toInforcePolicySnapshots,
  type InforcePolicySnapshot,
} from '@/lib/national-life/inforce-policy-service'
import {
  toReportRow,
  toReportRows,
  type ReportRow,
} from '@/lib/national-life/report-row-service'
import type { NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import { NATIONAL_LIFE_DISCOVERY_PAGE_KEYS } from '@/lib/national-life/read-coverage'

const CASE_SNAPSHOT_GRIDS = new Set<NationalLifeGridKey>(['NEW_BUSINESS', 'RECENTLY_CLOSED'])
const INFORCE_GRIDS = new Set<NationalLifeGridKey>(['INFORCE_CLIENTS'])
const DISCOVERY_PAGE_GRIDS = new Set<NationalLifeGridKey>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)
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
  ...DISCOVERY_PAGE_GRIDS,
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
  | {
      target: 'CASE_SNAPSHOT'
      gridKey: NationalLifeGridKey
      snapshots: CaseSnapshot[]
      stats: RawIngestStats
    }
  | {
      target: 'INFORCE_POLICY'
      gridKey: NationalLifeGridKey
      snapshots: InforcePolicySnapshot[]
      stats: RawIngestStats
    }
  | {
      target: 'REPORT_ROW'
      gridKey: NationalLifeGridKey
      rows: ReportRow[]
      stats: RawIngestStats
    }
  | {
      target: 'RAW_PAGE_ONLY'
      gridKey: NationalLifeGridKey
      stats: RawIngestStats
    }

export type RawIngestStats = {
  receivedCount: number
  duplicateCount: number
  rejectedCount: number
}

export type ReconciledRawIngestPage = RawIngestStats & {
  sequence: number
  writtenCount: number
}

function countMappedRows<T>(
  rows: Record<string, unknown>[],
  map: (row: Record<string, unknown>) => T | null,
  key: (row: T) => string,
): RawIngestStats {
  const seen = new Set<string>()
  let duplicateCount = 0
  let rejectedCount = 0

  for (const row of rows) {
    const mapped = map(row)
    if (!mapped) {
      rejectedCount += 1
      continue
    }
    const identity = key(mapped)
    if (seen.has(identity)) {
      duplicateCount += 1
    } else {
      seen.add(identity)
    }
  }

  return { receivedCount: rows.length, duplicateCount, rejectedCount }
}

/// Mirrors the routing in sync-grid.ts so the local and remote paths cannot drift.
/// Pure: the caller owns the write, because the persist helpers bind the module-level
/// Prisma client and cannot run inside the stage-ingest transaction.
export function planRawIngest(
  gridKey: NationalLifeGridKey,
  rows: Record<string, unknown>[],
): RawIngestPlan {
  if (CASE_SNAPSHOT_GRIDS.has(gridKey)) {
    return {
      target: 'CASE_SNAPSHOT',
      gridKey,
      snapshots: toCaseSnapshots(rows),
      stats: countMappedRows(rows, toCaseSnapshot, (row) => row.policyNo),
    }
  }
  if (INFORCE_GRIDS.has(gridKey)) {
    return {
      target: 'INFORCE_POLICY',
      gridKey,
      snapshots: toInforcePolicySnapshots(rows),
      stats: countMappedRows(rows, toInforcePolicySnapshot, (row) => row.policyNumber),
    }
  }
  if (DISCOVERY_PAGE_GRIDS.has(gridKey)) {
    return {
      target: 'RAW_PAGE_ONLY',
      gridKey,
      stats: { receivedCount: rows.length, duplicateCount: 0, rejectedCount: 0 },
    }
  }
  if (REPORT_ROW_GRIDS.has(gridKey)) {
    return {
      target: 'REPORT_ROW',
      gridKey,
      rows: toReportRows(gridKey, rows),
      stats: countMappedRows(rows, (row) => toReportRow(gridKey, row), (row) => row.rowKey),
    }
  }
  throw new LocalConnectorRawIngestError('GRID_NOT_ROUTED', gridKey)
}

function normalizedIdentities(plan: RawIngestPlan): string[] {
  switch (plan.target) {
    case 'CASE_SNAPSHOT':
      return plan.snapshots.map((snapshot) => snapshot.policyNo)
    case 'INFORCE_POLICY':
      return plan.snapshots.map((snapshot) => snapshot.policyNumber)
    case 'REPORT_ROW':
      return plan.rows.map((row) => row.rowKey)
    case 'RAW_PAGE_ONLY':
      return []
  }
}

/// Page receipts are written as each carrier response arrives, so their initial
/// duplicate count can only see repetitions inside that response. Reconcile the
/// complete raw snapshot before finalizing the stage so an identity repeated on
/// a later page is reported as a duplicate instead of a second write. The raw
/// rows remain untouched and the normalized upsert is already protected by the
/// same stable identities.
export function reconcileRawIngestPages(
  gridKey: NationalLifeGridKey,
  pages: readonly { sequence: number; rows: Record<string, unknown>[] }[],
): ReconciledRawIngestPage[] {
  const seen = new Set<string>()

  return [...pages]
    .sort((left, right) => left.sequence - right.sequence)
    .map(({ sequence, rows }) => {
      const plan = planRawIngest(gridKey, rows)
      const identities = normalizedIdentities(plan)
      let crossPageDuplicateCount = 0
      let writtenCount = 0

      for (const identity of identities) {
        if (seen.has(identity)) {
          crossPageDuplicateCount += 1
        } else {
          seen.add(identity)
          writtenCount += 1
        }
      }

      return {
        sequence,
        receivedCount: plan.stats.receivedCount,
        writtenCount,
        duplicateCount: plan.stats.duplicateCount + crossPageDuplicateCount,
        rejectedCount: plan.stats.rejectedCount,
      }
    })
}
