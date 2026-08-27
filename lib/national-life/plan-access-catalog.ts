import type { NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'

/** Carrier surfaces whose contract is explicitly agency-wide. */
export const NATIONAL_LIFE_AGENCY_ONLY_GRID_KEYS = [
  'PREMIUM_REPORT_AGENCY',
] as const satisfies readonly NationalLifeGridKey[]

/**
 * Exhaustive allowlist for the individual plan. New carrier grids remain
 * unavailable until their ownership contract is reviewed explicitly.
 */
export const NATIONAL_LIFE_PERSONAL_GRID_KEYS = [
  'NEW_BUSINESS',
  'RECENTLY_CLOSED',
  'INFORCE_CLIENTS',
  'COMMISSIONS_EARNING_REPORT',
  'CORRESPONDENCE',
  'CLIENT_INTELLIGENCE',
] as const satisfies readonly NationalLifeGridKey[]

const agencyOnlyKeys = new Set<NationalLifeGridKey>(
  NATIONAL_LIFE_AGENCY_ONLY_GRID_KEYS,
)

export function isNationalLifeAgencyOnlyGrid(
  gridKey: NationalLifeGridKey,
): boolean {
  return agencyOnlyKeys.has(gridKey)
}
