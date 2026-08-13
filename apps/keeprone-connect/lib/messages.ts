import { isGridKeyLabel } from './constants'
import { MAX_PORTAL_RECORDS, PAGE_SIZE } from './paging'

type JsonObject = Record<string, unknown>

export type RawGridRow = Record<string, unknown>

/// Mirrors LOCAL_CONNECTOR_MAX_ROW_BYTES and the record-key bound in the server's
/// `contracts.ts`. Deliberately a near-duplicate rather than a shared import: this is
/// a process boundary, and the page world is hostile enough that the background
/// deserves its own opinion about what it will forward.
const MAX_RAW_ROW_BYTES = 16 * 1024
const MAX_ROW_KEY_LENGTH = 128

export type PairConnectorMessage = {
  type: 'PAIR_CONNECTOR'
  code: string
  label: string
  baseUrl: string
}

export type StartSyncMessage = {
  type: 'START_NATIONAL_LIFE_SYNC'
  forceRefresh?: true
}

export type GetConnectorStatusMessage = {
  type: 'GET_CONNECTOR_STATUS'
}

export type UnpairConnectorMessage = {
  type: 'UNPAIR_CONNECTOR'
}

export type ExternalMessage =
  | PairConnectorMessage
  | StartSyncMessage
  | GetConnectorStatusMessage
  | UnpairConnectorMessage

export type BeginGridMessage = {
  type: 'BEGIN_GRID'
  gridKey: string
  token: string
  correlationId: string
  sequenceStart?: number
  offsetStart?: number
}

export type CapturePageMessage = {
  type: 'CAPTURE_PAGE'
  sourceKey: string
  token: string
  correlationId: string
}

export type BeginExportMessage = {
  type: 'BEGIN_EXPORT'
  sourceKey: 'INFORCE_CLIENTS'
  token: string
  correlationId: string
}

export type ProbeAuthMessage = {
  type: 'PROBE_AUTH'
  token: string
  correlationId: string
}

export type ProbeAuthAck = {
  ok: true
  type: 'AUTH_PROBED'
  token: string
  correlationId: string
  authenticated: boolean
}

export type PageCaptureAck = {
  ok: true
  type: 'PAGE_CAPTURED'
  sourceKey: string
  token: string
  correlationId: string
  records: RawGridRow[]
}

/// Ordem de parar onde está, mandada pelo background ao extrator.
///
/// O laço de paginação da página não tem como saber que o servidor recusou o
/// último lote: ele fala com o portal, não com o Keepr One. Sem esta mensagem o
/// `while (true)` segue puxando página atrás de página da National Life mesmo
/// depois do run ter morrido — o servidor para de receber, e o portal continua
/// sendo dirigido. Carrega os mesmos três campos de `BEGIN_GRID` porque tem de
/// provar que fala da extração que está rodando, e não de uma anterior.
export type AbortGridMessage = {
  type: 'ABORT_GRID'
  gridKey: string
  token: string
  correlationId: string
}

export type GridChunkMessage = {
  type: 'GRID_CHUNK'
  gridKey: string
  token: string
  correlationId: string
  sequence: number
  recordsTotal: number
  truncated: boolean
  records: RawGridRow[]
  sourceOffset?: number
  nextOffset?: number
}

export type GridDoneMessage = {
  type: 'GRID_DONE'
  gridKey: string
  token: string
  correlationId: string
}

export type GridErrorMessage = {
  type: 'GRID_ERROR'
  gridKey: string
  token: string
  correlationId: string
  code: 'TEMPLATE_UNAVAILABLE' | 'PORTAL_REQUEST_FAILED' | 'INVALID_PORTAL_RESPONSE'
}

export type ExportBeginMessage = {
  type: 'EXPORT_BEGIN'
  gridKey: 'INFORCE_CLIENTS'
  token: string
  correlationId: string
  fileName: string
  contentType: string
  expectedBytes: number
  expectedSha256: string
}

export type ExportChunkMessage = {
  type: 'EXPORT_CHUNK'
  gridKey: 'INFORCE_CLIENTS'
  token: string
  correlationId: string
  sequence: number
  bytes: number[]
}

export type ExportDoneMessage = {
  type: 'EXPORT_DONE'
  gridKey: 'INFORCE_CLIENTS'
  token: string
  correlationId: string
}

export type ExportErrorMessage = {
  type: 'EXPORT_ERROR'
  gridKey: 'INFORCE_CLIENTS'
  token: string
  correlationId: string
  code: 'TEMPLATE_UNAVAILABLE' | 'PORTAL_REQUEST_FAILED' | 'INVALID_EXPORT_RESPONSE'
}

export type BridgeMessage =
  | GridChunkMessage | GridDoneMessage | GridErrorMessage
  | ExportBeginMessage | ExportChunkMessage | ExportDoneMessage | ExportErrorMessage

export type BridgeControlAck = {
  ok: true
  type: 'BEGIN_GRID_ACK' | 'BEGIN_EXPORT_ACK' | 'ABORT_GRID_ACK'
  gridKey: string
  token: string
  correlationId: string
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/// Takes `object`, not `JsonObject`: callers reach this after narrowing an
/// `unknown` with `typeof value === 'object'`, which yields `object` and carries no
/// index signature. The check only enumerates own keys, so the wider type costs
/// nothing and spares every call site a cast that would erase the narrowing.
export function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isShortString(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

/// Raw carrier rows are forwarded uninterpreted: the server owns every field name and
/// every meaning. The background only bounds what it will relay — a plain object whose
/// keys are short and whose serialized size fits the server's per-row cap.
export function isRawGridRow(value: unknown): value is RawGridRow {
  if (!isObject(value)) return false
  if (Object.keys(value).some((key) => key.length > MAX_ROW_KEY_LENGTH)) return false
  try {
    return JSON.stringify(value).length <= MAX_RAW_ROW_BYTES
  } catch {
    return false
  }
}

export function parseExternalMessage(value: unknown): ExternalMessage | null {
  if (!isObject(value) || typeof value.type !== 'string') return null
  if (value.type === 'START_NATIONAL_LIFE_SYNC') {
    if (hasExactKeys(value, ['type'])) return { type: value.type }
    return hasExactKeys(value, ['type', 'forceRefresh']) && value.forceRefresh === true
      ? { type: value.type, forceRefresh: true }
      : null
  }
  if (value.type === 'GET_CONNECTOR_STATUS' || value.type === 'UNPAIR_CONNECTOR') {
    return hasExactKeys(value, ['type']) ? { type: value.type } : null
  }
  if (value.type !== 'PAIR_CONNECTOR' || !hasExactKeys(value, ['type', 'code', 'label', 'baseUrl'])) {
    return null
  }
  if (
    !isShortString(value.code, 128, 8) ||
    !isShortString(value.label, 100) ||
    /[<>\u0000]/.test(value.label) ||
    !isShortString(value.baseUrl, 256)
  ) {
    return null
  }
  return { type: value.type, code: value.code.trim(), label: value.label.trim(), baseUrl: value.baseUrl }
}

/// `BEGIN_GRID` e `ABORT_GRID` têm exatamente a mesma forma e a mesma exigência:
/// identificar uma extração. Um parser só, com o tipo esperado como parâmetro,
/// para que afrouxar a validação de um nunca afrouxe a do outro por descuido.
function parseGridControlMessage<T extends string>(value: unknown, type: T) {
  if (
    !isObject(value) ||
    !(hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId']) ||
      hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId', 'sequenceStart', 'offsetStart'])) ||
    value.type !== type ||
    !isGridKeyLabel(value.gridKey) ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16)
  ) {
    return null
  }
  if ('sequenceStart' in value &&
    (!Number.isInteger(value.sequenceStart) || (value.sequenceStart as number) < 0 || (value.sequenceStart as number) > 10_000 ||
      !Number.isInteger(value.offsetStart) || (value.offsetStart as number) < 0 || (value.offsetStart as number) > MAX_PORTAL_RECORDS)) {
    return null
  }
  return value
}

export function parseBeginGridMessage(value: unknown): BeginGridMessage | null {
  return parseGridControlMessage(value, 'BEGIN_GRID') as BeginGridMessage | null
}

export function parseAbortGridMessage(value: unknown): AbortGridMessage | null {
  return parseGridControlMessage(value, 'ABORT_GRID') as AbortGridMessage | null
}

export function parseCapturePageMessage(value: unknown): CapturePageMessage | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['type', 'sourceKey', 'token', 'correlationId']) ||
    value.type !== 'CAPTURE_PAGE' ||
    !isGridKeyLabel(value.sourceKey) ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16)
  ) {
    return null
  }
  return value as CapturePageMessage
}

export function parseBeginExportMessage(value: unknown): BeginExportMessage | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['type', 'sourceKey', 'token', 'correlationId']) ||
    value.type !== 'BEGIN_EXPORT' ||
    value.sourceKey !== 'INFORCE_CLIENTS' ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16)
  ) return null
  return value as BeginExportMessage
}

export function parseProbeAuthMessage(value: unknown): ProbeAuthMessage | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['type', 'token', 'correlationId']) ||
    value.type !== 'PROBE_AUTH' ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16)
  ) {
    return null
  }
  return value as ProbeAuthMessage
}

export function parseProbeAuthAck(value: unknown): ProbeAuthAck | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['ok', 'type', 'token', 'correlationId', 'authenticated']) ||
    value.ok !== true ||
    value.type !== 'AUTH_PROBED' ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16) ||
    typeof value.authenticated !== 'boolean'
  ) {
    return null
  }
  return value as ProbeAuthAck
}

export function parsePageCaptureAck(value: unknown): PageCaptureAck | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['ok', 'type', 'sourceKey', 'token', 'correlationId', 'records']) ||
    value.ok !== true ||
    value.type !== 'PAGE_CAPTURED' ||
    !isGridKeyLabel(value.sourceKey) ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16) ||
    !Array.isArray(value.records) ||
    value.records.length > MAX_PORTAL_RECORDS ||
    !value.records.every(isRawGridRow)
  ) {
    return null
  }
  return value as PageCaptureAck
}

export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  if (!isObject(value) || !isGridKeyLabel(value.gridKey) || !isShortString(value.token, 128, 32)) {
    return null
  }
  if (!isShortString(value.correlationId, 128, 16) || typeof value.type !== 'string') return null

  if (value.type === 'EXPORT_DONE') {
    return value.gridKey === 'INFORCE_CLIENTS' &&
      hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId'])
      ? value as ExportDoneMessage : null
  }
  if (value.type === 'EXPORT_ERROR') {
    const codes = ['TEMPLATE_UNAVAILABLE', 'PORTAL_REQUEST_FAILED', 'INVALID_EXPORT_RESPONSE']
    return value.gridKey === 'INFORCE_CLIENTS' &&
      hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId', 'code']) &&
      typeof value.code === 'string' && codes.includes(value.code)
      ? value as ExportErrorMessage : null
  }
  if (value.type === 'EXPORT_BEGIN') {
    return value.gridKey === 'INFORCE_CLIENTS' &&
      hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId', 'fileName', 'contentType', 'expectedBytes', 'expectedSha256']) &&
      typeof value.fileName === 'string' && /^NLG_InforceClientInfo_[0-9]{8}\.xlsx$/.test(value.fileName) &&
      value.contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
      Number.isSafeInteger(value.expectedBytes) && (value.expectedBytes as number) > 0 && (value.expectedBytes as number) <= 25 * 1024 * 1024 &&
      typeof value.expectedSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.expectedSha256)
      ? value as ExportBeginMessage : null
  }
  if (value.type === 'EXPORT_CHUNK') {
    return value.gridKey === 'INFORCE_CLIENTS' &&
      hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId', 'sequence', 'bytes']) &&
      Number.isSafeInteger(value.sequence) && (value.sequence as number) >= 0 && (value.sequence as number) <= 25 &&
      Array.isArray(value.bytes) && value.bytes.length > 0 && value.bytes.length <= 1024 * 1024 &&
      value.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      ? value as ExportChunkMessage : null
  }

  if (value.type === 'GRID_DONE') {
    return hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId'])
      ? (value as GridDoneMessage)
      : null
  }
  if (value.type === 'GRID_ERROR') {
    const codes = ['TEMPLATE_UNAVAILABLE', 'PORTAL_REQUEST_FAILED', 'INVALID_PORTAL_RESPONSE']
    return hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId', 'code']) &&
      typeof value.code === 'string' &&
      codes.includes(value.code)
      ? (value as GridErrorMessage)
      : null
  }
  if (
    value.type !== 'GRID_CHUNK' ||
    !(hasExactKeys(value, [
      'type',
      'gridKey',
      'token',
      'correlationId',
      'sequence',
      'recordsTotal',
      'truncated',
      'records',
    ]) || hasExactKeys(value, [
      'type',
      'gridKey',
      'token',
      'correlationId',
      'sequence',
      'recordsTotal',
      'truncated',
      'records',
      'sourceOffset',
      'nextOffset',
    ])) ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.sequence as number) > 10_000 ||
    !Number.isInteger(value.recordsTotal) ||
    (value.recordsTotal as number) < 0 ||
    (value.recordsTotal as number) > MAX_PORTAL_RECORDS ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.records) ||
    value.records.length > PAGE_SIZE ||
    !value.records.every(isRawGridRow)
  ) {
    return null
  }
  if (('sourceOffset' in value || 'nextOffset' in value) &&
    (!Number.isInteger(value.sourceOffset) || (value.sourceOffset as number) < 0 || (value.sourceOffset as number) > MAX_PORTAL_RECORDS ||
      !Number.isInteger(value.nextOffset) || (value.nextOffset as number) < (value.sourceOffset as number) || (value.nextOffset as number) > MAX_PORTAL_RECORDS)) {
    return null
  }
  return value as GridChunkMessage
}
