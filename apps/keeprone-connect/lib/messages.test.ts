import { describe, expect, it } from 'vitest'
import {
  parseAbortGridMessage,
  parseBeginGridMessage,
  parseBridgeMessage,
  parseExternalMessage,
  parseProbeAuthAck,
  parseProbeAuthMessage,
} from './messages'

describe('message validation', () => {
  it('accepts exact external messages and rejects extra properties', () => {
    const valid = {
      type: 'PAIR_CONNECTOR',
      code: 'abcdefgh',
      label: 'Meu navegador',
      baseUrl: 'https://app.keeprone.com',
    }
    expect(parseExternalMessage(valid)).toEqual(valid)
    expect(parseExternalMessage({ ...valid, secret: 'unexpected' })).toBeNull()
    expect(parseExternalMessage({ type: 'START_NATIONAL_LIFE_SYNC' })).toEqual({
      type: 'START_NATIONAL_LIFE_SYNC',
    })
    expect(parseExternalMessage({
      type: 'START_NATIONAL_LIFE_SYNC',
      forceRefresh: true,
    })).toEqual({ type: 'START_NATIONAL_LIFE_SYNC', forceRefresh: true })
    expect(parseExternalMessage({
      type: 'START_NATIONAL_LIFE_SYNC',
      forceRefresh: false,
    })).toBeNull()
    expect(parseExternalMessage({ type: 'GET_CONNECTOR_STATUS' })).toEqual({
      type: 'GET_CONNECTOR_STATUS',
    })
    expect(parseExternalMessage({ type: 'UNPAIR_CONNECTOR' })).toEqual({
      type: 'UNPAIR_CONNECTOR',
    })
  })

  const rawChunk = {
    type: 'GRID_CHUNK',
    gridKey: 'NEW_BUSINESS',
    token: 'a'.repeat(64),
    correlationId: '12345678-1234-4123-8123-123456789012',
    sequence: 0,
    recordsTotal: 1,
    truncated: false,
    records: [{ PolicyNo: 'P-1', InsuredName: '<b>Ana</b>', Nested: { a: [1, 2] } }],
  }

  it('accepts raw carrier rows without normalizing them', () => {
    expect(parseBridgeMessage(rawChunk)).toEqual(rawChunk)
  })

  it('accepts a grid key it has never seen before', () => {
    const chunk = { ...rawChunk, gridKey: 'PAID_COMMISSIONS' }
    expect(parseBridgeMessage(chunk)).toEqual(chunk)
  })

  it('rejects a grid key outside the label charset', () => {
    expect(parseBridgeMessage({ ...rawChunk, gridKey: 'new-business' })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, gridKey: 'X'.repeat(65) })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, gridKey: '' })).toBeNull()
  })

  it('rejects rows that are not plain objects', () => {
    expect(parseBridgeMessage({ ...rawChunk, records: [['P-1']] })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, records: ['P-1'] })).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, records: [null] })).toBeNull()
  })

  it('keeps the size limits on raw chunks', () => {
    const fatRow = { Blob: 'x'.repeat(17 * 1024) }
    expect(parseBridgeMessage({ ...rawChunk, records: [fatRow] })).toBeNull()
    const longKey = { ['k'.repeat(129)]: 'x' }
    expect(parseBridgeMessage({ ...rawChunk, records: [longKey] })).toBeNull()
    const tooMany = Array.from({ length: 201 }, () => ({ PolicyNo: 'P' }))
    expect(
      parseBridgeMessage({ ...rawChunk, records: tooMany, recordsTotal: 201 }),
    ).toBeNull()
    expect(parseBridgeMessage({ ...rawChunk, recordsTotal: 200_001 })).toBeNull()
  })

  it('rejects oversized and unknown bridge messages', () => {
    expect(
      parseBridgeMessage({
        type: 'GRID_DONE',
        gridKey: 'NEW_BUSINESS',
        token: 'short',
        correlationId: 'also-short',
      }),
    ).toBeNull()
    expect(parseBridgeMessage({ type: 'OTHER' })).toBeNull()
  })
})

describe('grid control messages', () => {
  const base = {
    gridKey: 'NEW_BUSINESS',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
  }

  it('accepts a well-formed order to begin and to abort', () => {
    expect(parseBeginGridMessage({ type: 'BEGIN_GRID', ...base })).toEqual({
      type: 'BEGIN_GRID',
      ...base,
    })
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base })).toEqual({
      type: 'ABORT_GRID',
      ...base,
    })
  })

  it('never confuses one order for the other', () => {
    // O extrator arma a bandeira de parada com o que este parser aceitar. Se ele
    // aceitasse um BEGIN_GRID, mandar começar viraria mandar parar.
    expect(parseAbortGridMessage({ type: 'BEGIN_GRID', ...base })).toBeNull()
    expect(parseBeginGridMessage({ type: 'ABORT_GRID', ...base })).toBeNull()
  })

  it('rejects an abort order that cannot identify an extraction', () => {
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, extra: 1 })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, token: 'short' })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, correlationId: 'tiny' })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID', ...base, gridKey: 'new business' })).toBeNull()
    expect(parseAbortGridMessage({ type: 'ABORT_GRID' })).toBeNull()
    expect(parseAbortGridMessage(null)).toBeNull()
  })
})

describe('authentication probe messages', () => {
  const probe = {
    type: 'PROBE_AUTH',
    token: 't'.repeat(32),
    correlationId: 'c'.repeat(16),
  }

  it('accepts only an exact probe and correlated result', () => {
    expect(parseProbeAuthMessage(probe)).toEqual(probe)
    expect(parseProbeAuthMessage({ ...probe, extra: true })).toBeNull()
    expect(parseProbeAuthAck({
      ok: true,
      type: 'AUTH_PROBED',
      token: probe.token,
      correlationId: probe.correlationId,
      authenticated: true,
    })).toMatchObject({ authenticated: true })
  })

  it('rejects an unbounded or ambiguous result', () => {
    expect(parseProbeAuthAck({
      ok: true,
      type: 'AUTH_PROBED',
      token: 'short',
      correlationId: probe.correlationId,
      authenticated: true,
    })).toBeNull()
    expect(parseProbeAuthAck({
      ok: true,
      type: 'AUTH_PROBED',
      token: probe.token,
      correlationId: probe.correlationId,
      authenticated: 'yes',
    })).toBeNull()
  })
})
