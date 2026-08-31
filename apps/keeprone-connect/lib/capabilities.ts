import { isGridKeyLabel } from './constants'
import { hasExactKeys } from './messages'
import { parseConnectorCommand, type ConnectorCommand } from './command-contract'

export type Capability = 'READ_GRID' | 'READ_PAGE' | 'READ_EXPORT' | 'READ_POLICY_DETAIL' |
  'FLEXLIFE_QUOTE' | 'GENERATE_ILLUSTRATION' | 'PREPARE_APPLICATION_DRAFT'

export type ConnectorCommandDispatch = {
  command: ConnectorCommand
  state: 'QUEUED' | 'RUNNING' | 'AUTH_REQUIRED'
  nextEventSequence: number
  lastEventType: string | null
}

export type StagePlan =
  | {
      capability: 'READ_GRID'
      params: { gridKey: string; navigatePath: string; mode?: 'COMMISSION_DETAILS' }
    }
  | { capability: 'READ_PAGE'; params: { sourceKey: string; navigatePath: string } }
  | { capability: 'READ_EXPORT'; params: { sourceKey: string; navigatePath: string; includeContactInformation: true } }

const IMPLEMENTED_CAPABILITIES = [
  'READ_GRID', 'READ_PAGE', 'READ_EXPORT', 'READ_POLICY_DETAIL', 'FLEXLIFE_QUOTE',
  'GENERATE_ILLUSTRATION', 'PREPARE_APPLICATION_DRAFT',
] as const
// A plan is server-authorized and each stage is independently bounded. Leave
// room for the source inventory to grow without making the 33rd source a hard
// client-side rollout failure.
const MAX_STAGES = 64
const MAX_NAVIGATE_PATH = 256


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
  if (path.length > MAX_NAVIGATE_PATH) return false
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
/// just this one page. This mirrors `policyDetailNavigatePath` /
/// `isSafePolicyDetailPath` in `lib/national-life/local-connector/capabilities.ts` on
/// the server, for the same reason `isSafeNavigatePath` above is duplicated rather than
/// shared: this is a trust boundary.
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
  if (query === undefined) return false
  const match = /^id=([^&#]*)$/.exec(query)
  const id = match?.[1]
  return id !== undefined && POLICY_DETAIL_ID_PATTERN.test(id)
}

export function parseStagePlan(value: unknown): StagePlan[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_STAGES) {
    throw new Error('INVALID_RUN_RESPONSE')
  }
  return value.map((entry): StagePlan => {
    if (!entry || typeof entry !== 'object' || !hasExactKeys(entry, ['capability', 'params'])) {
      throw new Error('INVALID_RUN_RESPONSE')
    }
    const { capability, params } = entry as { capability: unknown; params: unknown }
    if (
      typeof capability !== 'string' ||
      !(IMPLEMENTED_CAPABILITIES as readonly string[]).includes(capability)
    ) {
      throw new Error('UNKNOWN_CAPABILITY')
    }
    if (!params || typeof params !== 'object') throw new Error('INVALID_RUN_RESPONSE')
    const navigatePath = 'navigatePath' in params ? params.navigatePath : undefined
    if (typeof navigatePath !== 'string' || !isSafeNavigatePath(navigatePath)) {
      throw new Error('UNSAFE_NAVIGATE_PATH')
    }
    if (capability === 'READ_GRID') {
      const gridKey = 'gridKey' in params ? params.gridKey : undefined
      if (!isGridKeyLabel(gridKey)) throw new Error('INVALID_RUN_RESPONSE')
      if (gridKey === 'COMMISSIONS_EARNING_REPORT' && hasExactKeys(params, ['gridKey', 'navigatePath', 'mode'])) {
        if ((params as { mode?: unknown }).mode !== 'COMMISSION_DETAILS') {
          throw new Error('INVALID_RUN_RESPONSE')
        }
        return { capability, params: { gridKey, navigatePath, mode: 'COMMISSION_DETAILS' } }
      }
      if (!hasExactKeys(params, ['gridKey', 'navigatePath'])) throw new Error('INVALID_RUN_RESPONSE')
      return { capability, params: { gridKey, navigatePath } }
    }
    if (capability === 'READ_EXPORT') {
      if (!hasExactKeys(params, ['sourceKey', 'navigatePath', 'includeContactInformation'])) {
        throw new Error('INVALID_RUN_RESPONSE')
      }
      const sourceKey = 'sourceKey' in params ? params.sourceKey : undefined
      const includeContactInformation = 'includeContactInformation' in params
        ? params.includeContactInformation : undefined
      if (sourceKey !== 'INFORCE_CLIENTS' || includeContactInformation !== true) {
        throw new Error('INVALID_RUN_RESPONSE')
      }
      return { capability, params: { sourceKey, navigatePath, includeContactInformation: true } }
    }
    if (!hasExactKeys(params, ['sourceKey', 'navigatePath'])) throw new Error('INVALID_RUN_RESPONSE')
    const sourceKey = 'sourceKey' in params ? params.sourceKey : undefined
    if (!isGridKeyLabel(sourceKey)) throw new Error('INVALID_RUN_RESPONSE')
    return { capability: 'READ_PAGE', params: { sourceKey, navigatePath } }
  })
}

/// Dispatch gate for the next command transport. The browser accepts only
/// commands it can execute today, even if the server's wider catalog includes
/// Foresight and application capabilities for the remote browser or a future
/// extension release.
export function parseExecutableConnectorCommand(value: unknown): ConnectorCommand {
  const command = parseConnectorCommand(value)
  if (!command) throw new Error('INVALID_COMMAND')
  if (!(IMPLEMENTED_CAPABILITIES as readonly string[]).includes(command.capability)) {
    throw new Error('UNKNOWN_CAPABILITY')
  }
  if (command.capability === 'READ_POLICY_DETAIL') {
    if (
      command.target?.kind !== 'POLICY' ||
      !('policyNumber' in command.params) ||
      !('navigatePath' in command.params) ||
      !isSafePolicyDetailPath(command.params.navigatePath)
    ) {
      throw new Error('INVALID_COMMAND')
    }
    return command
  }
  if (command.capability === 'GENERATE_ILLUSTRATION' || command.capability === 'FLEXLIFE_QUOTE') {
    if (
      command.target?.kind !== 'ILLUSTRATION' ||
      !('illustrationId' in command.params) ||
      !('inputHash' in command.params) ||
      command.params.illustrationId !== command.target.id ||
      !/^[a-f0-9]{64}$/.test(command.params.inputHash)
    ) throw new Error('INVALID_COMMAND')
    return command
  }
  if (command.capability === 'PREPARE_APPLICATION_DRAFT') {
    if (
      command.target?.kind !== 'APPLICATION' ||
      !('applicationId' in command.params) ||
      !('payloadHash' in command.params) ||
      command.params.applicationId !== command.target.id ||
      !/^[a-f0-9]{64}$/.test(command.params.payloadHash)
    ) throw new Error('INVALID_COMMAND')
    return command
  }
  if (command.capability !== 'READ_GRID' && command.capability !== 'READ_PAGE' && command.capability !== 'READ_EXPORT') {
    throw new Error('UNKNOWN_CAPABILITY')
  }
  const params = command.params
  if (!('navigatePath' in params)) throw new Error('INVALID_COMMAND')
  if (command.capability === 'READ_GRID') {
    if (!('gridKey' in params) || !isGridKeyLabel(params.gridKey)) throw new Error('INVALID_COMMAND')
  } else if (!('sourceKey' in params) || !isGridKeyLabel(params.sourceKey)) {
    throw new Error('INVALID_COMMAND')
  }
  if (!isSafeNavigatePath(params.navigatePath)) throw new Error('UNSAFE_NAVIGATE_PATH')
  return command
}

export function parseConnectorCommandDispatch(value: unknown): ConnectorCommandDispatch {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !hasExactKeys(value, [
    'command', 'state', 'nextEventSequence', 'lastEventType',
  ])) throw new Error('INVALID_COMMAND')
  const record = value as Record<string, unknown>
  const command = parseExecutableConnectorCommand(record.command)
  if (
    record.state !== 'QUEUED' &&
    record.state !== 'RUNNING' &&
    record.state !== 'AUTH_REQUIRED'
  ) throw new Error('INVALID_COMMAND')
  if (
    !Number.isInteger(record.nextEventSequence) ||
    (record.nextEventSequence as number) < 1 ||
    (record.nextEventSequence as number) > 10_000
  ) throw new Error('INVALID_COMMAND')
  if (
    record.lastEventType !== null &&
    (typeof record.lastEventType !== 'string' || record.lastEventType.length > 64)
  ) throw new Error('INVALID_COMMAND')
  return {
    command,
    state: record.state,
    nextEventSequence: record.nextEventSequence as number,
    lastEventType: record.lastEventType as string | null,
  }
}
