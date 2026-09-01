/// Shared protocol between Keepr One, KeeproneConnect and the remote browser.
///
/// This module deliberately has no database, Next.js or Chrome dependency. Both
/// executors validate the same envelope independently; the server remains the
/// authority that issues, expires and audits commands.

export const CONNECTOR_COMMAND_PROTOCOL_VERSION = 1 as const

export const CONNECTOR_CAPABILITIES = [
  'READ_GRID',
  'READ_PAGE',
  'READ_EXPORT',
  'READ_DOCUMENT',
  'FORESIGHT_INVENTORY',
  'FORESIGHT_CASE_DETAIL',
  'FORESIGHT_REPORT',
  'READ_APPLICATION_STATUS',
  'READ_UNDERWRITING_STATUS',
  'READ_DOCUMENT_REQUIREMENTS',
  'READ_POLICY_DETAIL',
  'READ_COMMISSIONS',
  'OPEN_APPLICATION',
  'OPEN_EAPP',
  'OPEN_POLICY',
  'OPEN_ILLUSTRATION',
  'FLEXLIFE_QUOTE',
  'GENERATE_ILLUSTRATION',
  'PREPARE_APPLICATION_DRAFT',
  'UPLOAD_APPLICATION_DOCUMENT',
  'SUBMIT_APPLICATION',
] as const

export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number]

export type ConnectorCapabilityRisk =
  | 'READ_ONLY'
  | 'NAVIGATION_ONLY'
  | 'GENERATES_CARRIER_ARTIFACT'
  | 'WRITES_CARRIER_DRAFT'
  | 'SUBMITS_TO_CARRIER'

export const CONNECTOR_COMMAND_EVENTS = [
  'COMMAND_ACCEPTED',
  'COMMAND_STARTED',
  'DATA_BATCH',
  'AUTH_REQUIRED',
  'MFA_REQUIRED',
  'AUTH_RETRY_REQUESTED',
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
  | { sourceKey: string; navigatePath: string }
  | { sourceKey: string; navigatePath: string; exportKey: 'DOWNLOAD_ALL' }
  | Record<string, never>
  | { caseKey: string }
  | { externalApplicationId: string }
  | { policyNumber: string }
  | { policyNumber: string; navigatePath: string }
  | { illustrationId: string }
  | { illustrationId: string; inputHash: string }
  | { applicationId: string; payloadHash: string }
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
  return connectorCapabilityRisk(capability) !== 'READ_ONLY' &&
    connectorCapabilityRisk(capability) !== 'NAVIGATION_ONLY'
}

/// The risk class is part of the protocol, not UI decoration. Both command
/// issuance and executor dispatch derive their confirmation gate from this
/// function so a newly added carrier write cannot accidentally run as a read.
export function connectorCapabilityRisk(
  capability: ConnectorCapability,
): ConnectorCapabilityRisk {
  switch (capability) {
    case 'OPEN_APPLICATION':
    case 'OPEN_EAPP':
    case 'OPEN_POLICY':
    case 'OPEN_ILLUSTRATION':
      return 'NAVIGATION_ONLY'
    case 'FLEXLIFE_QUOTE':
    case 'GENERATE_ILLUSTRATION':
      return 'GENERATES_CARRIER_ARTIFACT'
    case 'PREPARE_APPLICATION_DRAFT':
    case 'UPLOAD_APPLICATION_DOCUMENT':
      return 'WRITES_CARRIER_DRAFT'
    case 'SUBMIT_APPLICATION':
      return 'SUBMITS_TO_CARRIER'
    default:
      return 'READ_ONLY'
  }
}

export function isReadOnlyCapability(capability: ConnectorCapability): boolean {
  return [
    'READ_GRID',
    'READ_PAGE',
    'READ_EXPORT',
    'FORESIGHT_INVENTORY',
    'FORESIGHT_CASE_DETAIL',
    'FORESIGHT_REPORT',
    'READ_APPLICATION_STATUS',
    'READ_UNDERWRITING_STATUS',
    'READ_DOCUMENT_REQUIREMENTS',
    'READ_POLICY_DETAIL',
    'READ_COMMISSIONS',
    'OPEN_APPLICATION',
    'OPEN_EAPP',
    'OPEN_POLICY',
    'OPEN_ILLUSTRATION',
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

const POLICY_DETAIL_PATH =
  /^\/agent\/book-of-business\/inforce-book\/all-clients\/policy-details\?id=[a-f0-9]{32}$/

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
    case 'READ_PAGE':
      return has(['sourceKey', 'navigatePath']) && isIdentifier(value.sourceKey) &&
        typeof value.navigatePath === 'string' && value.navigatePath.length <= 256
        ? { sourceKey: value.sourceKey, navigatePath: value.navigatePath }
        : undefined
    case 'READ_EXPORT':
      return has(['sourceKey', 'navigatePath', 'exportKey']) &&
        isIdentifier(value.sourceKey) &&
        typeof value.navigatePath === 'string' && value.navigatePath.length <= 256 &&
        value.exportKey === 'DOWNLOAD_ALL'
        ? { sourceKey: value.sourceKey, navigatePath: value.navigatePath, exportKey: 'DOWNLOAD_ALL' }
        : undefined
    case 'READ_DOCUMENT':
      return has([]) ? {} : undefined
    case 'FORESIGHT_INVENTORY':
    case 'OPEN_EAPP':
      return has([]) ? {} : undefined
    case 'FORESIGHT_CASE_DETAIL':
    case 'FORESIGHT_REPORT':
      return has(['caseKey']) && isIdentifier(value.caseKey) ? { caseKey: value.caseKey } : undefined
    case 'READ_APPLICATION_STATUS':
    case 'READ_UNDERWRITING_STATUS':
    case 'READ_DOCUMENT_REQUIREMENTS':
    case 'OPEN_APPLICATION':
      return has(['externalApplicationId']) && isIdentifier(value.externalApplicationId)
        ? { externalApplicationId: value.externalApplicationId }
        : undefined
    case 'READ_POLICY_DETAIL':
      return has(['policyNumber', 'navigatePath']) &&
        isIdentifier(value.policyNumber) &&
        typeof value.navigatePath === 'string' &&
        POLICY_DETAIL_PATH.test(value.navigatePath)
        ? { policyNumber: value.policyNumber, navigatePath: value.navigatePath }
        : undefined
    case 'READ_COMMISSIONS':
    case 'OPEN_POLICY':
      return has(['policyNumber']) && isIdentifier(value.policyNumber)
        ? { policyNumber: value.policyNumber }
        : undefined
    case 'OPEN_ILLUSTRATION':
      return has(['caseKey']) && isIdentifier(value.caseKey) ? { caseKey: value.caseKey } : undefined
    case 'GENERATE_ILLUSTRATION':
      return has(['illustrationId', 'inputHash']) && isIdentifier(value.illustrationId) &&
        isHash(value.inputHash)
        ? { illustrationId: value.illustrationId, inputHash: value.inputHash }
        : undefined
    case 'FLEXLIFE_QUOTE':
      return has(['illustrationId', 'inputHash']) && isIdentifier(value.illustrationId) &&
        isHash(value.inputHash)
        ? { illustrationId: value.illustrationId, inputHash: value.inputHash }
        : undefined
    case 'PREPARE_APPLICATION_DRAFT':
      return has(['applicationId', 'payloadHash']) && isIdentifier(value.applicationId) &&
        isHash(value.payloadHash)
        ? { applicationId: value.applicationId, payloadHash: value.payloadHash }
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
