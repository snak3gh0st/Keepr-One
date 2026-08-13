import { NATIONAL_LIFE_READ_COVERAGE } from './read-coverage'

export type NationalLifeAcquisitionStrategy =
  | 'JSON_GRID'
  | 'PAGE_SNAPSHOT'
  | 'OFFICIAL_EXPORT'
  | 'ENTITY_DETAIL'
  | 'DOCUMENT'

export type NationalLifeAcquisitionActivation =
  | 'ACTIVE'
  | 'PROBE_REQUIRED'
  | 'ON_DEMAND'

export type NationalLifeAcquisitionSource = {
  key: string
  route: string
  preferredStrategy: NationalLifeAcquisitionStrategy
  fallbackStrategy?: NationalLifeAcquisitionStrategy
  activation: NationalLifeAcquisitionActivation
  /// Sources in the same group expose overlapping carrier data. Keeping this
  /// explicit prevents "more collectors" from becoming duplicate Keepr One rows.
  dedupeGroup?: string
}

const officialExportCandidates = new Set([
  'PAYABLE_GROSS_COMMISSIONS',
  'PREMIUM_REPORT_AGENCY',
  'LIFE_PERSISTENCY',
  'PENDING_GROSS_COMMISSIONS',
  'COMMISSIONS_OVERVIEW',
  'COMMISSIONS_POLICY_HISTORY',
  'PLACEMENT_REPORT',
  'DAILY_UNIT_VALUES',
  'PIP_CONTRIBUTION_INCREASE',
  'ANNUITY_PAST_DUE_CONTRIBUTIONS',
  'ANNUITY_PAYROLL_FLOW_CHANGES',
])

const dedupeGroups: Readonly<Record<string, string>> = {
  PAYABLE_GROSS_COMMISSIONS: 'PROJECTED_PAYABLE_COMMISSIONS',
  PAID_COMMISSIONS: 'PAID_EARNING_COMMISSIONS',
  COMMISSIONS_EARNING_REPORT: 'PAID_EARNING_COMMISSIONS',
}

function strategyFor(source: (typeof NATIONAL_LIFE_READ_COVERAGE)[number]):
  Pick<NationalLifeAcquisitionSource, 'preferredStrategy' | 'fallbackStrategy' | 'activation'> {
  if (officialExportCandidates.has(source.key)) {
    return {
      preferredStrategy: 'OFFICIAL_EXPORT',
      fallbackStrategy: source.implementation === 'AUTOMATIC' ? 'JSON_GRID' : 'PAGE_SNAPSHOT',
      // A visible Download button is evidence of a candidate, not proof of its
      // request contract, file type, filters, or completeness.
      activation: 'PROBE_REQUIRED',
    }
  }
  if (source.collector === 'GRID') {
    return { preferredStrategy: 'JSON_GRID', activation: 'ACTIVE' }
  }
  if (source.collector === 'ENTITY_DETAIL') {
    return { preferredStrategy: 'ENTITY_DETAIL', activation: 'ON_DEMAND' }
  }
  if (source.collector === 'DOCUMENT') {
    return { preferredStrategy: 'DOCUMENT', activation: 'ON_DEMAND' }
  }
  return {
    preferredStrategy: 'PAGE_SNAPSHOT',
    activation: source.implementation === 'ON_DEMAND' ? 'ON_DEMAND' : 'PROBE_REQUIRED',
  }
}

/// One acquisition decision per known portal source. This catalogue is
/// intentionally broader than the active run plan: adding a candidate here does
/// not authorize the extension to execute it.
export const NATIONAL_LIFE_ACQUISITION_CATALOG: readonly NationalLifeAcquisitionSource[] =
  NATIONAL_LIFE_READ_COVERAGE.map((source) => ({
    key: source.key,
    route: source.route,
    ...strategyFor(source),
    ...(dedupeGroups[source.key] ? { dedupeGroup: dedupeGroups[source.key] } : {}),
  }))
