import {
  NATIONAL_LIFE_GRIDS,
  type NationalLifeGridKey,
} from '@/lib/national-life/portal-grid-client'
import {
  CONNECTOR_CAPABILITIES,
  type ConnectorCapability,
} from '@/lib/national-life/connector-command-contract'
import { isRoutedGrid } from './raw-ingest'
import {
  NATIONAL_LIFE_AUTOMATIC_GRID_KEYS,
  NATIONAL_LIFE_DISCOVERY_PAGE_KEYS,
} from '../read-coverage'

const READ_GRID_KEYS = new Set<NationalLifeGridKey>(NATIONAL_LIFE_AUTOMATIC_GRID_KEYS)
const READ_PAGE_KEYS = new Set<NationalLifeGridKey>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)

export type LocalConnectorCapabilityName = ConnectorCapability

/// The Chrome extension ships this closed subset. The larger protocol catalogue
/// is deliberately not executable until a released browser executor validates it.
export const EXECUTABLE_LOCAL_CONNECTOR_CAPABILITIES = ['READ_GRID', 'READ_PAGE', 'READ_EXPORT'] as const satisfies readonly LocalConnectorCapabilityName[]

/// Named for planning and UI copy only. The extension's IMPLEMENTED_CAPABILITIES
/// must stay the closed set of what the device can actually run — do not add these
/// there until each capability ships with a parser and executor.
export const PLANNED_LOCAL_CONNECTOR_CAPABILITIES = CONNECTOR_CAPABILITIES

export type PlannedLocalConnectorCapability =
  (typeof PLANNED_LOCAL_CONNECTOR_CAPABILITIES)[number]

/// Distinguishable from the device's own mistakes on purpose: every case this
/// carries is a server-side misconfiguration, so the run route must answer 500
/// rather than blame the caller's request.
export class LocalConnectorPlanError extends Error {
  constructor(
    readonly code: 'GRID_NOT_ROUTED',
    readonly gridKey: NationalLifeGridKey,
  ) {
    super(`No ingest destination for grid ${gridKey}`)
  }
}

export type ReadGridParams = {
  gridKey: NationalLifeGridKey
  navigatePath: string
  mode?: 'COMMISSION_DETAILS'
}

export type ReadGridStagePlan = {
  capability: 'READ_GRID'
  params: ReadGridParams
}

export type ReadPageStagePlan = {
  capability: 'READ_PAGE'
  params: { sourceKey: NationalLifeGridKey; navigatePath: string }
}

export type ReadExportStagePlan = {
  capability: 'READ_EXPORT'
  params: {
    sourceKey: 'INFORCE_CLIENTS'
    navigatePath: string
    includeContactInformation: true
  }
}

export type LocalConnectorStagePlan = ReadGridStagePlan | ReadPageStagePlan | ReadExportStagePlan

/// The extension refuses anything outside the agent tree. Every portal grid hits the
/// same endpoint — only the page you open first differs — so one capability covers
/// them all, and adding a grid is a deploy rather than a Chrome Web Store review —
/// a deploy that must give the grid an ingest route as well as a catalogue entry,
/// since planning refuses a grid raw-ingest cannot land anywhere (see below).
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

/// READ_POLICY_DETAIL's target is not a static catalogue entry: the page is fixed but
/// the portal assigns an opaque id per policy (`policy-details?id=<32-hex>`, captured
/// live against the portal 2026-08-17). `isSafeNavigatePath` above stays a closed
/// catalogue check that rejects every `?` on purpose — loosening it to allow query
/// strings generally would let a compromised plan attach `?` to any static route, not
/// just this one page. This is a narrow, separate allowlist instead: exactly the known
/// policy-details path, exactly one `id` param, exactly 32 lowercase hex characters —
/// the shape the portal's own links use, nothing looser.
const POLICY_DETAIL_ROUTE = '/agent/book-of-business/inforce-book/all-clients/policy-details'
const POLICY_DETAIL_ID_PATTERN = /^[0-9a-f]{32}$/

export function policyDetailNavigatePath(id: string): string {
  if (!POLICY_DETAIL_ID_PATTERN.test(id)) throw new Error('UNSAFE_ENTITY_ID')
  return `${POLICY_DETAIL_ROUTE}?id=${id}`
}

export function isSafePolicyDetailPath(path: string): boolean {
  const [base, ...rest] = path.split('?')
  if (base !== POLICY_DETAIL_ROUTE || rest.length !== 1) return false
  const query = rest[0]
  const match = /^id=([^&#]*)$/.exec(query)
  return match !== null && POLICY_DETAIL_ID_PATTERN.test(match[1])
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
///
/// The same principle covers routing. A grid the catalogue knows but `planRawIngest`
/// cannot land anywhere would produce a run whose first stage throws inside the ingest
/// transaction — a server misconfiguration reported to the device as a malformed
/// request, leaving a RUNNING run to die at the TTL. The routed set comes from
/// raw-ingest so the two cannot drift.
export function planReadGridStages(
  gridKeys: readonly NationalLifeGridKey[],
): ReadGridStagePlan[] {
  const seenPaths = new Map<string, NationalLifeGridKey>()
  return [...new Set(gridKeys)].map((gridKey) => {
    // Types are gone at runtime: a key that isn't an own property of the catalogue
    // (an unknown grid, or an inherited/prototype name like `toString`) must fail
    // loudly here rather than resolve to `undefined` or a function and blow up
    // inside `isSafeNavigatePath` with an opaque TypeError.
    if (!Object.hasOwn(NATIONAL_LIFE_GRIDS, gridKey)) {
      throw new Error(`Unknown grid key ${String(gridKey)}`)
    }
    if (!READ_GRID_KEYS.has(gridKey)) {
      throw new Error(`Source ${gridKey} requires READ_PAGE`)
    }
    const navigatePath = NATIONAL_LIFE_GRIDS[gridKey]
    if (!isSafeNavigatePath(navigatePath)) {
      throw new Error(`Unsafe navigate path for grid ${gridKey}`)
    }
    const owner = seenPaths.get(navigatePath)
    if (owner) {
      throw new Error(`Duplicate navigate path for grids ${owner} and ${gridKey}`)
    }
    if (!isRoutedGrid(gridKey)) {
      throw new LocalConnectorPlanError('GRID_NOT_ROUTED', gridKey)
    }
    seenPaths.set(navigatePath, gridKey)
    return {
      capability: 'READ_GRID',
      params: {
        gridKey,
        navigatePath,
        ...(gridKey === 'COMMISSIONS_EARNING_REPORT' ? { mode: 'COMMISSION_DETAILS' as const } : {}),
      },
    }
  })
}

export function planReadPageStages(
  sourceKeys: readonly NationalLifeGridKey[],
): ReadPageStagePlan[] {
  return [...new Set(sourceKeys)].map((sourceKey) => {
    if (!Object.hasOwn(NATIONAL_LIFE_GRIDS, sourceKey)) {
      throw new Error(`Unknown source key ${String(sourceKey)}`)
    }
    if (!READ_PAGE_KEYS.has(sourceKey)) {
      throw new Error(`Source ${sourceKey} requires READ_GRID`)
    }
    const navigatePath = NATIONAL_LIFE_GRIDS[sourceKey]
    if (!isSafeNavigatePath(navigatePath)) {
      throw new Error(`Unsafe navigate path for source ${sourceKey}`)
    }
    if (!isRoutedGrid(sourceKey)) {
      throw new LocalConnectorPlanError('GRID_NOT_ROUTED', sourceKey)
    }
    return { capability: 'READ_PAGE', params: { sourceKey, navigatePath } }
  })
}

export function planReadExportStages(
  sourceKeys: readonly NationalLifeGridKey[],
): ReadExportStagePlan[] {
  return [...new Set(sourceKeys)].map((sourceKey) => {
    if (sourceKey !== 'INFORCE_CLIENTS') {
      throw new Error(`Source ${sourceKey} has no official export collector`)
    }
    const navigatePath = NATIONAL_LIFE_GRIDS[sourceKey]
    if (!isSafeNavigatePath(navigatePath)) {
      throw new Error(`Unsafe navigate path for source ${sourceKey}`)
    }
    if (!isRoutedGrid(sourceKey)) {
      throw new LocalConnectorPlanError('GRID_NOT_ROUTED', sourceKey)
    }
    return {
      capability: 'READ_EXPORT',
      params: { sourceKey, navigatePath, includeContactInformation: true },
    }
  })
}
