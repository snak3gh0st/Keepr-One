import { describe, expect, it } from 'vitest'
import { parseBridgeMessage, parseExternalMessage } from './messages'
import { normalizeNewBusiness } from './normalizers'

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
    expect(parseExternalMessage({ type: 'GET_CONNECTOR_STATUS' })).toEqual({
      type: 'GET_CONNECTOR_STATUS',
    })
    expect(parseExternalMessage({ type: 'UNPAIR_CONNECTOR' })).toEqual({
      type: 'UNPAIR_CONNECTOR',
    })
  })

  it('requires exact, normalized chunk records', () => {
    const record = normalizeNewBusiness({ PolicyNo: 'P-1' })
    const chunk = {
      type: 'GRID_CHUNK',
      gridKey: 'NEW_BUSINESS',
      token: 'a'.repeat(64),
      correlationId: '12345678-1234-4123-8123-123456789012',
      sequence: 0,
      recordsTotal: 1,
      truncated: false,
      records: [record],
    }
    expect(parseBridgeMessage(chunk)).toEqual(chunk)
    expect(parseBridgeMessage({ ...chunk, records: [{ ...record, raw: { PolicyNo: 'P-1' } }] })).toBeNull()
    expect(parseBridgeMessage({ ...chunk, records: [{ ...record, insuredName: '<b>Ana</b>' }] })).toBeNull()
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
