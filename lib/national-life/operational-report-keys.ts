/// Report grids promoted into the agent's operational data surface. Keep this
/// in a dependency-free shared module: server components cannot read runtime
/// values exported through a `use client` boundary.
export const NATIONAL_LIFE_OPERATIONAL_REPORT_KEYS = [
  'PAID_COMMISSIONS',
  'CORRESPONDENCE',
  'COMMISSIONS_PAYMENT_PORTAL',
  'PIP_PENDING',
  'COMMISSIONS_EARNING_REPORT',
  'PAYABLE_GROSS_COMMISSIONS',
] as const
