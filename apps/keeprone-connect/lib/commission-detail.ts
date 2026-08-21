export type CommissionDetailTarget = {
  path: string
  statementId: string
}

const NLD_DETAIL_PATH =
  '/agent/compensation/commissions/paid-commissions/commissions-earning-report/nld-commission-earning'
const NLD_ID_PATTERN = /^[A-Za-z0-9]+$/

export function isSafeCommissionDetailPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = new RegExp(`^${NLD_DETAIL_PATH.replaceAll('/', '\\/')}\\?id=([A-Za-z0-9]+)$`).exec(value)
  return match !== null
}

export function parseCommissionDetailTargets(value: unknown): CommissionDetailTarget[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_COMMISSION_DETAIL_LINKS')
  }
  const links = (value as { links?: unknown }).links
  if (!Array.isArray(links) || links.length > 500) {
    throw new Error('INVALID_COMMISSION_DETAIL_LINKS')
  }

  const targets: CommissionDetailTarget[] = []
  const seen = new Set<string>()
  for (const entry of links) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('INVALID_COMMISSION_DETAIL_LINKS')
    }
    const path = (entry as { path?: unknown }).path
    const statementId = (entry as { statementId?: unknown }).statementId
    if (
      !isSafeCommissionDetailPath(path) ||
      typeof statementId !== 'string' ||
      !NLD_ID_PATTERN.test(statementId) ||
      !path.endsWith(`?id=${statementId}`)
    ) {
      throw new Error('INVALID_COMMISSION_DETAIL_LINKS')
    }
    if (seen.has(statementId)) continue
    seen.add(statementId)
    targets.push({ path, statementId })
  }
  return targets
}
