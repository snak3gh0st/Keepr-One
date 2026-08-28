/// Which stored `gridKey` values hold commission earning detail.
///
/// Four screens — the commission statement, the agent dashboard total, the
/// per-policy commission, and agent promotion — queried only
/// `COMMISSION_DETAIL_NLD_COMMISSION_EARNING`, the key the retired REMOTE
/// engine wrote. The local connector persists the catalogue key verbatim
/// (`report-row-service.ts` stores `gridKey` with no translation), so every one
/// of those reads matched zero rows regardless of how much the sync collected.
/// The screens were empty for a reason that had nothing to do with the data.
///
/// Both keys are read rather than the live one substituted: rows written before
/// the engine changed still carry the legacy key, and this change has no way to
/// migrate them. Reading both is correct in either direction and costs one more
/// value in an indexed `IN` clause.
export const COMMISSION_EARNING_GRID_KEYS = [
  'COMMISSIONS_EARNING_REPORT',
  'COMMISSION_DETAIL_NLD_COMMISSION_EARNING',
] as const

/** Historical rows written before KeeproneConnect became the canonical engine. */
export const LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE = 'keepr-one-production-v1' as const
export const LEGACY_COMMISSION_EARNING_GRID_KEY = 'COMMISSION_DETAIL_NLD_COMMISSION_EARNING' as const
