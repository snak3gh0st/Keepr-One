import { describe, expect, it } from 'vitest'
import {
  LOCAL_CONNECTOR_MAX_RECORDS,
  inforceClientsEnvelopeSchema,
  localConnectorRawStageEnvelopeSchema,
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

describe('local connector raw stage envelope', () => {
  it('accepts a raw carrier row untouched', () => {
    const envelope = localConnectorRawStageEnvelopeSchema.parse({
      schemaVersion: 2,
      runId: 'run_1',
      gridKey: 'NEW_BUSINESS',
      sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z',
      recordsTotal: 1,
      truncated: false,
      records: [{ PolicyNo: 'X1', SomeColumnWeDoNotKnowAbout: 42, Nested: { a: 1 } }],
    })
    expect(envelope.records[0].SomeColumnWeDoNotKnowAbout).toBe(42)
  })

  it('rejects more records than the page cap', () => {
    const records = Array.from({ length: 201 }, (_, i) => ({ PolicyNo: `X${i}` }))
    expect(() =>
      localConnectorRawStageEnvelopeSchema.parse({
        schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 201, truncated: false, records,
      }),
    ).toThrow()
  })

  it('rejects a grid key outside the server allowlist', () => {
    expect(() =>
      localConnectorRawStageEnvelopeSchema.parse({
        schemaVersion: 2, runId: 'run_1', gridKey: 'NOT_A_GRID', sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 0, truncated: false, records: [],
      }),
    ).toThrow()
  })

  it('rejects recordsTotal below the page it carries', () => {
    expect(() =>
      localConnectorRawStageEnvelopeSchema.parse({
        schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 0, truncated: false,
        records: [{ PolicyNo: 'X1' }],
      }),
    ).toThrow()
  })
})
