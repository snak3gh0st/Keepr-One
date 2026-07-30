import type { GridRow } from './portal-grid-client'

/// Per-statement drill-down links found inside a PAID_COMMISSIONS row.
///
/// The statement cells arrive as rendered anchors, and those anchors carry plain
/// `?id=<token>` URLs — so the detail is reachable without replaying the page's
/// `getHierarchyReportDetails` click handler.
export type CommissionDetailLink = {
  kind: 'NLD_COMMISSION_EARNING' | 'CHARGEBACK'
  path: string
  statementId: string
}

const DETAIL_PATTERNS = [
  {
    kind: 'NLD_COMMISSION_EARNING' as const,
    // Matched on the path so a carrier-side host change does not silently skip it.
    pattern:
      /href=['"]([^'"]*commissions-earning-report\/nld-commission-earning\?id=([A-Za-z0-9]+))['"]/i,
  },
  {
    kind: 'CHARGEBACK' as const,
    pattern:
      /href=['"]([^'"]*commissions-earning-report\/chargeback\?id=([A-Za-z0-9]+))['"]/i,
  },
]

/// Fields whose rendered markup is known to hold a drill-down anchor.
const LINK_FIELDS = ['NLDCommEarningAmt', 'ESICommEarningAmt', 'CommChargebackBalance', 'PayStatement'] as const

export function extractCommissionDetailLinks(row: GridRow): CommissionDetailLink[] {
  const links = new Map<string, CommissionDetailLink>()

  for (const field of LINK_FIELDS) {
    const value = row[field]
    if (typeof value !== 'string') {
      continue
    }
    for (const { kind, pattern } of DETAIL_PATTERNS) {
      const match = value.match(pattern)
      if (!match) {
        continue
      }
      const [, path, statementId] = match
      // Keyed by kind+id so the same link repeated across cells collapses.
      links.set(`${kind}:${statementId}`, { kind, path, statementId })
    }
  }

  return [...links.values()]
}
