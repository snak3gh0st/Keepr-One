import { describe, expect, it } from 'vitest'
import {
  LOCAL_CONNECTOR_MAX_ROW_BYTES,
  localConnectorRawStageEnvelopeSchema,
} from './contracts'

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
    expect(envelope.records[0].Nested).toEqual({ a: 1 })
  })

  it('accepts exactly the page cap of records', () => {
    const records = Array.from({ length: 200 }, (_, i) => ({ PolicyNo: `X${i}` }))
    const envelope = localConnectorRawStageEnvelopeSchema.parse({
      schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 200, truncated: false, records,
    })
    expect(envelope.records).toHaveLength(200)
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

  it('accepts a deeply-nested row now that shape is unconstrained', () => {
    const envelope = localConnectorRawStageEnvelopeSchema.parse({
      schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
      observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 1, truncated: false,
      records: [{ PolicyNo: 'X1', Deep: { a: { b: { c: [1, 2, { d: 'e' }] } } } }],
    })
    expect(envelope.records[0].Deep).toEqual({ a: { b: { c: [1, 2, { d: 'e' }] } } })
  })

  it('rejects a row exceeding the per-row size cap', () => {
    expect(() =>
      localConnectorRawStageEnvelopeSchema.parse({
        schemaVersion: 2, runId: 'run_1', gridKey: 'NEW_BUSINESS', sequence: 0,
        observedAt: '2026-08-04T00:00:00.000Z', recordsTotal: 1, truncated: false,
        records: [{ PolicyNo: 'X1', Big: 'x'.repeat(LOCAL_CONNECTOR_MAX_ROW_BYTES) }],
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
