import { GRID_KEYS, type GridKey } from './constants'
import { isNormalizedRecord, type NormalizedRecord } from './normalizers'

type JsonObject = Record<string, unknown>

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
  gridKey: GridKey
  token: string
  correlationId: string
}

export type GridChunkMessage = {
  type: 'GRID_CHUNK'
  gridKey: GridKey
  token: string
  correlationId: string
  sequence: number
  recordsTotal: number
  truncated: boolean
  records: NormalizedRecord[]
}

export type GridDoneMessage = {
  type: 'GRID_DONE'
  gridKey: GridKey
  token: string
  correlationId: string
}

export type GridErrorMessage = {
  type: 'GRID_ERROR'
  gridKey: GridKey
  token: string
  correlationId: string
  code: 'TEMPLATE_UNAVAILABLE' | 'PORTAL_REQUEST_FAILED' | 'INVALID_PORTAL_RESPONSE'
}

export type BridgeMessage = GridChunkMessage | GridDoneMessage | GridErrorMessage

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isShortString(value: unknown, max: number, min = 1): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isGridKey(value: unknown): value is GridKey {
  return typeof value === 'string' && GRID_KEYS.includes(value as GridKey)
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
    !isGridKey(value.gridKey) ||
    !isShortString(value.token, 128, 32) ||
    !isShortString(value.correlationId, 128, 16)
  ) {
    return null
  }
  return value as BeginGridMessage
}

export function parseBridgeMessage(value: unknown): BridgeMessage | null {
  if (!isObject(value) || !isGridKey(value.gridKey) || !isShortString(value.token, 128, 32)) {
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
    (value.recordsTotal as number) > 100_000 ||
    typeof value.truncated !== 'boolean' ||
    !Array.isArray(value.records) ||
    value.records.length > 1_000 ||
    !value.records.every((record) => isNormalizedRecord(value.gridKey as GridKey, record))
  ) {
    return null
  }
  return value as GridChunkMessage
}
