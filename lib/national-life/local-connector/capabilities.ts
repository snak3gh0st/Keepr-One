import 'server-only'
import {
  NATIONAL_LIFE_GRIDS,
  type NationalLifeGridKey,
} from '@/lib/national-life/portal-grid-client'

export type LocalConnectorCapabilityName = 'READ_GRID'

export type ReadGridParams = {
  gridKey: NationalLifeGridKey
  navigatePath: string
}

export type LocalConnectorStagePlan = {
  capability: 'READ_GRID'
  params: ReadGridParams
}

/// The extension refuses anything outside the agent tree. Every portal grid hits the
/// same endpoint — only the page you open first differs — so one capability covers
/// them all, and adding a grid is a deploy rather than a Chrome Web Store review.
///
/// The whitelist regex is the load-bearing check: only `[A-Za-z0-9/_-]` survives,
/// so no character a URL parser could special-case (`:`, `@`, `\`, `%`, whitespace,
/// non-ASCII look-alikes of `.` or `/`) can ever reach one. That closes off scheme
/// smuggling (`javascript:`, `https:`), backslash-as-separator tricks, and percent-
/// encoded traversal (`%2e%2e`) without needing to enumerate them by hand.
export function isSafeNavigatePath(path: string): boolean {
  if (!path.startsWith('/agent/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('..')) return false
  if (path.includes('?') || path.includes('#')) return false
  return /^[A-Za-z0-9/_-]+$/.test(path)
}

export function planReadGridStages(
  gridKeys: readonly NationalLifeGridKey[],
): LocalConnectorStagePlan[] {
  return gridKeys.map((gridKey) => {
    // Types are gone at runtime: a key that isn't an own property of the catalogue
    // (an unknown grid, or an inherited/prototype name like `toString`) must fail
    // loudly here rather than resolve to `undefined` or a function and blow up
    // inside `isSafeNavigatePath` with an opaque TypeError.
    if (!Object.hasOwn(NATIONAL_LIFE_GRIDS, gridKey)) {
      throw new Error(`Unknown grid key ${String(gridKey)}`)
    }
    const navigatePath = NATIONAL_LIFE_GRIDS[gridKey]
    if (!isSafeNavigatePath(navigatePath)) {
      throw new Error(`Unsafe navigate path for grid ${gridKey}`)
    }
    return { capability: 'READ_GRID', params: { gridKey, navigatePath } }
  })
}
