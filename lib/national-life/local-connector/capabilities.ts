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

/// Two stages must never share a `navigatePath`, and the plan must not repeat a grid.
///
/// A repeated grid key would give two stages the same stage-receipt coordinates
/// (`runId`, `gridKey`, `sequence`), so the second stage's chunks collide with the
/// first's. And two stages on the same path are worse: the device advances stages with
/// a tab navigation, so an unchanged path means no new document, and the extension's
/// MAIN-world script keeps the DataTable template it captured for the previous stage —
/// it would page the previous grid and upload those rows under the new grid's key.
/// Silent mislabeling, not an error.
///
/// Deduping the keys handles the reachable case; the path check is the backstop for a
/// catalogue edit that points two distinct keys at one page. Both fail here, while
/// planning, rather than on a device mid-run.
export function planReadGridStages(
  gridKeys: readonly NationalLifeGridKey[],
): LocalConnectorStagePlan[] {
  const seenPaths = new Map<string, NationalLifeGridKey>()
  return [...new Set(gridKeys)].map((gridKey) => {
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
    const owner = seenPaths.get(navigatePath)
    if (owner) {
      throw new Error(`Duplicate navigate path for grids ${owner} and ${gridKey}`)
    }
    seenPaths.set(navigatePath, gridKey)
    return { capability: 'READ_GRID', params: { gridKey, navigatePath } }
  })
}
