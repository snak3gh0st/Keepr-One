import { hasExactKeys } from './messages'

export type StagePlan = {
  capability: 'READ_GRID'
  params: { gridKey: string; navigatePath: string }
}

const IMPLEMENTED = new Set(['READ_GRID'])
const MAX_STAGES = 32

/// The server picks which capability runs and with what parameters, but the catalogue
/// lives here. A compromised backend can reorder our own operations; it cannot invent
/// one, and it cannot point us outside the agent tree.
///
/// This mirrors `isSafeNavigatePath` in
/// `lib/national-life/local-connector/capabilities.ts` on the server. The two are
/// intentionally near-duplicates rather than a shared import: this is a trust
/// boundary, and each side validating independently — instead of trusting the
/// other's judgment — is the point.
///
/// The whitelist regex is the load-bearing check: only `[A-Za-z0-9/_-]` survives, so
/// no character a URL parser could special-case (`:`, `@`, `\`, `%`, whitespace,
/// non-ASCII look-alikes of `.` or `/`, control characters) can ever reach one. That
/// closes off scheme smuggling (`javascript:`, `https:`), backslash-as-separator
/// tricks, percent-encoded traversal (`%2e%2e`, `%2f`), and embedded-authority tricks
/// (`@evil.com`) without needing to enumerate them by hand. Because `.` itself is not
/// in the whitelist, `path.includes('..')` below is redundant with the regex — it is
/// kept anyway so the traversal intent stays legible at the call site.
function isSafeNavigatePath(path: string): boolean {
  if (typeof path !== 'string') return false
  if (!path.startsWith('/agent/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('..')) return false
  if (path.includes('?') || path.includes('#')) return false
  return /^[A-Za-z0-9/_-]+$/.test(path)
}

export function parseStagePlan(value: unknown): StagePlan[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STAGES) {
    throw new Error('INVALID_RUN_RESPONSE')
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || !hasExactKeys(entry, ['capability', 'params'])) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    const { capability, params } = entry as { capability: unknown; params: unknown }
    if (typeof capability !== 'string' || !IMPLEMENTED.has(capability)) {
      throw new Error('UNKNOWN_CAPABILITY')
    }
    if (!params || typeof params !== 'object' || !hasExactKeys(params, ['gridKey', 'navigatePath'])) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    const { gridKey, navigatePath } = params as { gridKey: unknown; navigatePath: unknown }
    if (typeof gridKey !== 'string' || gridKey.length === 0 || gridKey.length > 64) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    if (typeof navigatePath !== 'string' || !isSafeNavigatePath(navigatePath)) {
      throw new Error('UNSAFE_NAVIGATE_PATH')
    }
    return { capability: 'READ_GRID', params: { gridKey, navigatePath } }
  })
}
