import { describe, expect, it } from 'vitest'
import {
  LOCAL_CONNECTOR_MAX_RECORDS,
  inforceClientsEnvelopeSchema,
  newBusinessEnvelopeSchema,
} from './contracts'

const baseEnvelope = {
  schemaVersion: 1,
  runId: 'run_123',
  sequence: 0,
  observedAt: '2026-08-04T18:00:00.000Z',
  recordsTotal: 1,
  truncated: false,
}

describe('local connector contracts', () => {
  it('accepts only normalized NEW_BUSINESS records', () => {
    const result = newBusinessEnvelopeSchema.parse({
      ...baseEnvelope,
      gridKey: 'NEW_BUSINESS',
      records: [{ policyNo: 'NL-123', insuredName: 'Ada Lovelace' }],
    })

    expect(result.records[0].policyNo).toBe('NL-123')
  })

  it.each(['raw', 'headers'])('rejects forbidden %s payload fields', (field) => {
    expect(() =>
      newBusinessEnvelopeSchema.parse({
        ...baseEnvelope,
        gridKey: 'NEW_BUSINESS',
        records: [{ policyNo: 'NL-123', [field]: {} }],
      }),
    ).toThrow()
  })

  it('rejects markup and unknown envelope fields', () => {
    expect(() =>
      newBusinessEnvelopeSchema.parse({
        ...baseEnvelope,
        gridKey: 'NEW_BUSINESS',
        records: [{ policyNo: 'NL-123', insuredName: '<b>Ada</b>' }],
        carrierHtml: '<table />',
      }),
    ).toThrow()
  })

  it('bounds inforce row count', () => {
    expect(() =>
      inforceClientsEnvelopeSchema.parse({
        ...baseEnvelope,
        gridKey: 'INFORCE_CLIENTS',
        records: Array.from({ length: LOCAL_CONNECTOR_MAX_RECORDS + 1 }, (_, index) => ({
          policyNumber: `NL-${index}`,
        })),
      }),
    ).toThrow()
  })
})
