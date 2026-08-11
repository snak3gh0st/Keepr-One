/// Shared protocol between Keepr One, KeeproneConnect and the remote browser.
///
/// This module deliberately has no database, Next.js or Chrome dependency. Both
/// executors validate the same envelope independently; the server remains the
/// authority that issues, expires and audits commands.

export const CONNECTOR_COMMAND_PROTOCOL_VERSION = 1 as const

export const CONNECTOR_CAPABILITIES = [
  'READ_GRID',
  'FORESIGHT_INVENTORY',
  'FORESIGHT_CASE_DETAIL',
  'FORESIGHT_REPORT',
  'READ_APPLICATION_STATUS',
  'READ_UNDERWRITING_STATUS',
  'READ_DOCUMENT_REQUIREMENTS',
  'READ_POLICY_DETAIL',
  'READ_COMMISSIONS',
  'FLEXLIFE_QUOTE',
  'GENERATE_ILLUSTRATION',
  'PREPARE_APPLICATION_DRAFT',
  'UPLOAD_APPLICATION_DOCUMENT',
  'SUBMIT_APPLICATION',
] as const

export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number]

export const CONNECTOR_COMMAND_EVENTS = [
  'COMMAND_ACCEPTED',
  'COMMAND_STARTED',
  'DATA_BATCH',
  'AUTH_REQUIRED',
  'MFA_REQUIRED',
  'WAITING_FOR_CONFIRMATION',
  'COMMAND_COMPLETED',
  'COMMAND_FAILED',
] as const

export type ConnectorCommandEventType = (typeof CONNECTOR_COMMAND_EVENTS)[number]

export type ConnectorCommandState =
  | 'QUEUED'
  | 'RUNNING'
  | 'AUTH_REQUIRED'
  | 'WAITING_FOR_CONFIRMATION'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type ConnectorCommandTarget =
  | { kind: 'CASE'; id: string; carrierExternalId?: string }
  | { kind: 'APPLICATION'; id: string; carrierExternalId?: string }
  | { kind: 'POLICY'; id: string; carrierExternalId?: string }
  | { kind: 'ILLUSTRATION'; id: string; carrierExternalId?: string }

export type ConnectorCommandParams =
  | { gridKey: string; navigatePath: string }
  | Record<string, never>
  | { caseKey: string }
  | { externalApplicationId: string }
  | { policyNumber: string }
  | { illustrationId: string }
  | { applicationId: string }
  | { applicationId: string; documentId: string; contentHash: string }
  | { applicationId: string; payloadHash: string }

export type ConnectorCommand = {
  protocolVersion: typeof CONNECTOR_COMMAND_PROTOCOL_VERSION
  commandId: string
  runId: string
  capability: ConnectorCapability
  target: ConnectorCommandTarget | null
  params: ConnectorCommandParams
  idempotencyKey: string
  issuedAt: string
  expiresAt: string
  requiresConfirmation: boolean
}

export type ConnectorCommandEvent = {
  protocolVersion: typeof CONNECTOR_COMMAND_PROTOCOL_VERSION
  eventId: string
  commandId: string
  runId: string
  sequence: number
  type: ConnectorCommandEventType
  emittedAt: string
  payload: Record<string, unknown> | null
  error: { code: string; safeMessage: string } | null
}

export function isConnectorCapability(value: unknown): value is ConnectorCapability {
  return typeof value === 'string' && (CONNECTOR_CAPABILITIES as readonly string[]).includes(value)
}

export function requiresExplicitConfirmation(capability: ConnectorCapability): boolean {
  return (
    capability === 'UPLOAD_APPLICATION_DOCUMENT' ||
    capability === 'SUBMIT_APPLICATION'
  )
}

export function isReadOnlyCapability(capability: ConnectorCapability): boolean {
  return [
    'READ_GRID',
    'FORESIGHT_INVENTORY',
    'FORESIGHT_CASE_DETAIL',
    'FORESIGHT_REPORT',
    'READ_APPLICATION_STATUS',
    'READ_UNDERWRITING_STATUS',
    'READ_DOCUMENT_REQUIREMENTS',
    'READ_POLICY_DETAIL',
    'READ_COMMISSIONS',
  ].includes(capability)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  )
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false
  return Number.isFinite(Date.parse(value))
}

function parseTarget(value: unknown): ConnectorCommandTarget | null | undefined {
  if (value === null) return null
  if (!isObject(value)) return undefined
  if (!hasExactKeys(value, ['kind', 'id']) && !hasExactKeys(value, ['kind', 'id', 'carrierExternalId'])) {
    return undefined
  }
  if (
    (value.kind !== 'CASE' &&
      value.kind !== 'APPLICATION' &&
      value.kind !== 'POLICY' &&
      value.kind !== 'ILLUSTRATION') ||
    !isIdentifier(value.id) ||
    ('carrierExternalId' in value && !isIdentifier(value.carrierExternalId))
  ) {
    return undefined
  }
  return value as ConnectorCommandTarget
}

function parseParams(
  capability: ConnectorCapability,
  value: unknown,
): ConnectorCommandParams | undefined {
  if (!isObject(value)) return undefined
  const has = (keys: readonly string[]) => hasExactKeys(value, keys)
  switch (capability) {
    case 'READ_GRID':
      return has(['gridKey', 'navigatePath']) && isIdentifier(value.gridKey) &&
        typeof value.navigatePath === 'string' && value.navigatePath.length <= 256
        ? { gridKey: value.gridKey, navigatePath: value.navigatePath }
        : undefined
    case 'FORESIGHT_INVENTORY':
      return has([]) ? {} : undefined
    case 'FORESIGHT_CASE_DETAIL':
    case 'FORESIGHT_REPORT':
      return has(['caseKey']) && isIdentifier(value.caseKey) ? { caseKey: value.caseKey } : undefined
    case 'READ_APPLICATION_STATUS':
    case 'READ_UNDERWRITING_STATUS':
    case 'READ_DOCUMENT_REQUIREMENTS':
      return has(['externalApplicationId']) && isIdentifier(value.externalApplicationId)
        ? { externalApplicationId: value.externalApplicationId }
        : undefined
    case 'READ_POLICY_DETAIL':
    case 'READ_COMMISSIONS':
      return has(['policyNumber']) && isIdentifier(value.policyNumber)
        ? { policyNumber: value.policyNumber }
        : undefined
    case 'GENERATE_ILLUSTRATION':
    case 'FLEXLIFE_QUOTE':
      return has(['illustrationId']) && isIdentifier(value.illustrationId)
        ? { illustrationId: value.illustrationId }
        : undefined
    case 'PREPARE_APPLICATION_DRAFT':
      return has(['applicationId']) && isIdentifier(value.applicationId)
        ? { applicationId: value.applicationId }
        : undefined
    case 'UPLOAD_APPLICATION_DOCUMENT':
      return has(['applicationId', 'documentId', 'contentHash']) &&
        isIdentifier(value.applicationId) &&
        isIdentifier(value.documentId) &&
        isHash(value.contentHash)
        ? { applicationId: value.applicationId, documentId: value.documentId, contentHash: value.contentHash }
        : undefined
    case 'SUBMIT_APPLICATION':
      return has(['applicationId', 'payloadHash']) &&
        isIdentifier(value.applicationId) &&
        isHash(value.payloadHash)
        ? { applicationId: value.applicationId, payloadHash: value.payloadHash }
        : undefined
  }
}

export function parseConnectorCommand(value: unknown): ConnectorCommand | null {
  if (!isObject(value) || !hasExactKeys(value, [
    'protocolVersion',
    'commandId',
    'runId',
    'capability',
    'target',
    'params',
    'idempotencyKey',
    'issuedAt',
    'expiresAt',
    'requiresConfirmation',
  ])) return null
  if (
    value.protocolVersion !== CONNECTOR_COMMAND_PROTOCOL_VERSION ||
    !isIdentifier(value.commandId) ||
    !isIdentifier(value.runId) ||
    !isConnectorCapability(value.capability) ||
    !isIdentifier(value.idempotencyKey) ||
    !isTimestamp(value.issuedAt) ||
    !isTimestamp(value.expiresAt) ||
    typeof value.requiresConfirmation !== 'boolean'
  ) return null
  const target = parseTarget(value.target)
  const params = parseParams(value.capability, value.params)
  if (target === undefined || !params) return null
  if (value.requiresConfirmation !== requiresExplicitConfirmation(value.capability)) return null
  return {
    protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
    commandId: value.commandId,
    runId: value.runId,
    capability: value.capability,
    target,
    params,
    idempotencyKey: value.idempotencyKey,
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    requiresConfirmation: value.requiresConfirmation,
  }
}

export function parseConnectorCommandEvent(value: unknown): ConnectorCommandEvent | null {
  if (!isObject(value) || !hasExactKeys(value, [
    'protocolVersion',
    'eventId',
    'commandId',
    'runId',
    'sequence',
    'type',
    'emittedAt',
    'payload',
    'error',
  ])) return null
  if (
    value.protocolVersion !== CONNECTOR_COMMAND_PROTOCOL_VERSION ||
    !isIdentifier(value.eventId) ||
    !isIdentifier(value.commandId) ||
    !isIdentifier(value.runId) ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    typeof value.type !== 'string' ||
    !(CONNECTOR_COMMAND_EVENTS as readonly string[]).includes(value.type) ||
    !isTimestamp(value.emittedAt) ||
    (value.payload !== null && !isObject(value.payload)) ||
    (value.error !== null &&
      (!isObject(value.error) ||
        !hasExactKeys(value.error, ['code', 'safeMessage']) ||
        !isIdentifier(value.error.code) ||
        typeof value.error.safeMessage !== 'string' ||
        value.error.safeMessage.length > 500))
  ) return null
  return value as ConnectorCommandEvent
}
