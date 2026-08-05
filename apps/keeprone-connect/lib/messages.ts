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

export type BridgeMessage = GridChunkMessage | GridDoneMessage | GridErrorMessage

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
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
function isRawGridRow(value: unknown): value is RawGridRow {
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
  if (
    value.type === 'START_NATIONAL_LIFE_SYNC' ||
    value.type === 'GET_CONNECTOR_STATUS' ||
    value.type === 'UNPAIR_CONNECTOR'
  ) {
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

export function parseBeginGridMessage(value: unknown): BeginGridMessage | null {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['type', 'gridKey', 'token', 'correlationId']) ||
    value.type !== 'BEGIN_GRID' ||
    !isGridKeyLabel(value.gridKey) ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16)
  ) {
    return null
  }
  return value as BeginGridMessage
}

export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  if (!isObject(value) || !isGridKeyLabel(value.gridKey) || !isShortString(value.token, 128, 32)) {
    return null
  }
  if (!isShortString(value.correlationId, 128, 16) || typeof value.type !== 'string') return null

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
    !hasExactKeys(value, [
      'type',
      'gridKey',
      'token',
      'correlationId',
      'sequence',
      'recordsTotal',
      'truncated',
      'records',
    ]) ||
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
  return value as GridChunkMessage
}
