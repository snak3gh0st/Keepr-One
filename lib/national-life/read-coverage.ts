import {
  NATIONAL_LIFE_GRIDS,
  type NationalLifeGridKey,
} from './portal-grid-client'

export type NationalLifeReadCollector =
  | 'GRID'
  | 'DASHBOARD'
  | 'FILTERED_REPORT'
  | 'ENTITY_DETAIL'
  | 'DOCUMENT'

export type NationalLifeReadImplementation =
  | 'AUTOMATIC'
  | 'NEEDS_COLLECTOR'
  | 'NEEDS_PROBE'
  | 'ON_DEMAND'

export type NationalLifeReadSource = {
  key: string
  label: string
  route: string
  collector: NationalLifeReadCollector
  implementation: NationalLifeReadImplementation
  requiredForFullSync: boolean
}

/// The grids proven by the released local connector. This is the run plan, not
/// the complete portal denominator; `NATIONAL_LIFE_READ_COVERAGE` below owns the
/// latter so the product cannot call 13 grids "everything".
export const NATIONAL_LIFE_AUTOMATIC_GRID_KEYS = [
  'NEW_BUSINESS',
  'RECENTLY_CLOSED',
  'INFORCE_CLIENTS',
  'PAID_COMMISSIONS',
  'PROJECTED_COMMISSIONS',
  'CLIENT_INTELLIGENCE',
  'CORRESPONDENCE',
  'COMMISSIONS_PAYMENT_PORTAL',
  'PIP_PENDING',
  'TRANSFERS_EXCHANGES',
  'LIFE_PENDING_LAPSE',
  'COMMISSIONS_EARNING_REPORT',
  'PAYABLE_GROSS_COMMISSIONS',
] as const satisfies readonly NationalLifeGridKey[]

const automaticLabels: Record<(typeof NATIONAL_LIFE_AUTOMATIC_GRID_KEYS)[number], string> = {
  NEW_BUSINESS: 'New business cases',
  RECENTLY_CLOSED: 'Recently closed cases',
  INFORCE_CLIENTS: 'In-force clients and policies',
  PAID_COMMISSIONS: 'Paid commissions',
  PROJECTED_COMMISSIONS: 'Projected commissions',
  CLIENT_INTELLIGENCE: 'Client intelligence',
  CORRESPONDENCE: 'Correspondence index',
  COMMISSIONS_PAYMENT_PORTAL: 'Commission payees',
  PIP_PENDING: 'Pending PIP increases',
  TRANSFERS_EXCHANGES: 'Transfers and exchanges',
  LIFE_PENDING_LAPSE: 'Pending lapse policies',
  COMMISSIONS_EARNING_REPORT: 'Commission earning detail',
  PAYABLE_GROSS_COMMISSIONS: 'Payable gross commissions',
}

const automaticSources: NationalLifeReadSource[] = NATIONAL_LIFE_AUTOMATIC_GRID_KEYS.map(
  (key) => ({
    key,
    label: automaticLabels[key],
    route: NATIONAL_LIFE_GRIDS[key],
    collector: 'GRID',
    implementation: 'AUTOMATIC',
    requiredForFullSync: true,
  }),
)

/// Versioned inventory of business data visible in the authenticated agent
/// portal. A source stays in this denominator even when its collector is not
/// implemented, making incomplete coverage explicit and testable.
export const NATIONAL_LIFE_READ_COVERAGE: readonly NationalLifeReadSource[] = [
  ...automaticSources,
  {
    key: 'AGENT_DASHBOARD',
    label: 'Agent dashboard totals and action-required items',
    route: '/agent/',
    collector: 'DASHBOARD',
    implementation: 'NEEDS_COLLECTOR',
    requiredForFullSync: true,
  },
  {
    key: 'PREMIUM_REPORT_AGENCY',
    label: 'Premium report',
    route: NATIONAL_LIFE_GRIDS.PREMIUM_REPORT_AGENCY,
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_COLLECTOR',
    requiredForFullSync: true,
  },
  {
    key: 'POLICY_PAYMENT_HISTORY',
    label: 'Policy payment history',
    route: NATIONAL_LIFE_GRIDS.POLICY_PAYMENT_HISTORY,
    collector: 'FILTERED_REPORT',
    implementation: 'ON_DEMAND',
    requiredForFullSync: true,
  },
  {
    key: 'LIFE_PERSISTENCY',
    label: 'Life persistency report',
    route: NATIONAL_LIFE_GRIDS.LIFE_PERSISTENCY,
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'PENDING_GROSS_COMMISSIONS',
    label: 'Pending gross commissions',
    route: NATIONAL_LIFE_GRIDS.PENDING_GROSS_COMMISSIONS,
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'COMMISSIONS_OVERVIEW',
    label: 'Commission overview by payment date',
    route: NATIONAL_LIFE_GRIDS.COMMISSIONS_OVERVIEW,
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_COLLECTOR',
    requiredForFullSync: true,
  },
  {
    key: 'COMMISSIONS_POLICY_HISTORY',
    label: 'Policy commission history',
    route: NATIONAL_LIFE_GRIDS.COMMISSIONS_POLICY_HISTORY,
    collector: 'FILTERED_REPORT',
    implementation: 'ON_DEMAND',
    requiredForFullSync: true,
  },
  {
    key: 'PLACEMENT_REPORT',
    label: 'Placement report',
    route: NATIONAL_LIFE_GRIDS.PLACEMENT_REPORT,
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'DAILY_UNIT_VALUES',
    label: 'Daily unit values',
    route: '/agent/book-of-business/inforce-book/daily-unit-values',
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'PIP_CONTRIBUTION_INCREASE',
    label: 'PIP contribution increases',
    route: '/agent/book-of-business/inforce-book/pip-contribution-increase',
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'ANNUITY_PAST_DUE_CONTRIBUTIONS',
    label: 'Annuity past-due contributions',
    route: '/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution',
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'ANNUITY_PAYROLL_FLOW_CHANGES',
    label: 'Annuity payroll flow changes',
    route: '/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes',
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'INFORMAL_REQUESTS',
    label: 'Informal requests',
    route: '/agent/book-of-business/new-business/informal-request',
    collector: 'FILTERED_REPORT',
    implementation: 'NEEDS_PROBE',
    requiredForFullSync: true,
  },
  {
    key: 'CLIENT_DETAIL',
    label: 'Client details',
    route: '/agent/book-of-business/inforce-book/all-clients/client-information-details',
    collector: 'ENTITY_DETAIL',
    implementation: 'ON_DEMAND',
    requiredForFullSync: true,
  },
  {
    key: 'POLICY_DETAIL',
    label: 'Policy details',
    route: '/agent/book-of-business/inforce-book/all-clients/policy-details',
    collector: 'ENTITY_DETAIL',
    implementation: 'ON_DEMAND',
    requiredForFullSync: true,
  },
  {
    key: 'NEW_BUSINESS_CASE_DETAIL',
    label: 'New business case details and requirements',
    route: '/agent/book-of-business/new-business/all-new-business-cases/nb-policy-details',
    collector: 'ENTITY_DETAIL',
    implementation: 'ON_DEMAND',
    requiredForFullSync: true,
  },
  {
    key: 'CORRESPONDENCE_DOCUMENTS',
    label: 'Correspondence documents',
    route: NATIONAL_LIFE_GRIDS.CORRESPONDENCE,
    collector: 'DOCUMENT',
    implementation: 'NEEDS_COLLECTOR',
    requiredForFullSync: true,
  },
] as const

export function nationalLifeReadCoverageSummary() {
  const required = NATIONAL_LIFE_READ_COVERAGE.filter((source) => source.requiredForFullSync)
  const automatic = required.filter((source) => source.implementation === 'AUTOMATIC')
  return {
    required: required.length,
    automatic: automatic.length,
    remaining: required.length - automatic.length,
  }
}
