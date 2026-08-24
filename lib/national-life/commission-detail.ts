import type { GridRow } from './portal-grid-client'

/// Per-statement drill-down links found inside a PAID_COMMISSIONS row.
///
/// The statement cells arrive as rendered anchors, and those anchors carry plain
/// `?id=<token>` URLs — so the detail is reachable without replaying the page's
/// `getHierarchyReportDetails` click handler.
export type CommissionDetailLink = {
  kind: 'NLD_COMMISSION_EARNING' | 'CHARGEBACK' | 'CHARGEBACK_DEBT'
  path: string
  statementId: string
}

export type NationalLifeCommissionEarningLink = {
  path: string
  statementId: string
}

const NLG_ORIGIN = 'https://www.nationallife.com'
const NLD_EARNING_PATH =
  '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning'
const NLD_ID_PATTERN = /^[A-Za-z0-9]+$/

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
  {
    // The chargeback statement's own DetailsLink, which opens the debt behind it.
    kind: 'CHARGEBACK_DEBT' as const,
    pattern:
      /href=['"]([^'"]*commissions-earning-report\/chargeback\/debt\?id=([A-Za-z0-9]+))['"]/i,
  },
]

/// Fields whose rendered markup is known to hold a drill-down anchor.
const LINK_FIELDS = [
  'NLDCommEarningAmt',
  'ESICommEarningAmt',
  'CommChargebackBalance',
  'PayStatement',
  'DetailsLink',
] as const

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

/// The parent grid is stored before the extension opens the child report. Keep
/// only the National Life earning links and normalize them to a path so the
/// server never hands the extension an arbitrary origin from raw carrier HTML.
export function extractNationalLifeCommissionEarningLinks(
  rows: readonly GridRow[],
): NationalLifeCommissionEarningLink[] {
  const links = new Map<string, NationalLifeCommissionEarningLink>()

  for (const row of rows) {
    for (const link of extractCommissionDetailLinks(row)) {
      if (link.kind !== 'NLD_COMMISSION_EARNING') continue
      const normalized = normalizeNationalLifeCommissionEarningPath(link.path)
      if (!normalized) continue
      links.set(link.statementId, { path: normalized, statementId: link.statementId })
    }
  }

  return [...links.values()]
}

export function normalizeNationalLifeCommissionEarningPath(value: string): string | null {
  let url: URL
  try {
    url = new URL(value, NLG_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== NLG_ORIGIN || url.pathname !== NLD_EARNING_PATH) return null
  const entries = [...url.searchParams.entries()]
  if (entries.length !== 1 || entries[0]?.[0] !== 'id') return null
  const statementId = entries[0][1]
  if (!NLD_ID_PATTERN.test(statementId)) return null
  return `${NLD_EARNING_PATH}?id=${encodeURIComponent(statementId)}`
}
