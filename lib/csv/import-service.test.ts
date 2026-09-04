import { describe, expect, it } from 'vitest'
import {
  deriveCommissionSourceId,
  deriveStatus,
  parseCsv,
  periodToDate,
  resolveImportProvider,
  resolvePolicyExternalId,
  safeParseCsv,
  shouldUpdateStatusChangedAt,
  statusChangedAtForCreate,
} from './import-service'

describe('parseCsv', () => {
  it('parses a header row into keyed objects', () => {
    const content = 'policyNumber,agentNpn,amount,period\nNLG-0002,1000003,45.50,2026-01'
    expect(parseCsv(content)).toEqual([
      { policyNumber: 'NLG-0002', agentNpn: '1000003', amount: '45.50', period: '2026-01' },
    ])
  })

  it('returns an empty array for a header-only file', () => {
    const content = 'policyNumber,agentNpn,amount,period'
    expect(parseCsv(content)).toEqual([])
  })
})

describe('safeParseCsv', () => {
  it('returns rows for well-formed CSV', () => {
    const content = 'policyNumber,agentNpn\nNLG-0002,1000003'
    const result = safeParseCsv(content)
    expect(result).toEqual({ rows: [{ policyNumber: 'NLG-0002', agentNpn: '1000003' }] })
  })

  it('returns an error instead of throwing for malformed CSV', () => {
    // An unclosed quote makes csv-parse throw synchronously.
    const content = 'policyNumber,agentNpn\n"NLG-0002,1000003'
    const result = safeParseCsv(content)
    expect('error' in result).toBe(true)
  })
})

describe('deriveStatus', () => {
  it('returns COMPLETED when there are no errors', () => {
    expect(deriveStatus(5, 0)).toBe('COMPLETED')
  })

  it('returns COMPLETED_WITH_ERRORS when some rows succeeded', () => {
    expect(deriveStatus(3, 2)).toBe('COMPLETED_WITH_ERRORS')
  })

  it('returns FAILED when every row errored', () => {
    expect(deriveStatus(0, 5)).toBe('FAILED')
  })
})

describe('shouldUpdateStatusChangedAt', () => {
  it('returns true when there is no existing policy (create case)', () => {
    expect(shouldUpdateStatusChangedAt(null, 'PENDING')).toBe(true)
  })

  it('returns true when the status differs from the existing policy', () => {
    expect(shouldUpdateStatusChangedAt({ status: 'PENDING' }, 'LAPSED')).toBe(true)
  })

  it('returns false when the status is unchanged', () => {
    expect(shouldUpdateStatusChangedAt({ status: 'INFORCE' }, 'INFORCE')).toBe(false)
  })
})

describe('statusChangedAtForCreate', () => {
  it('returns null when the incoming status is already LAPSED', () => {
    expect(statusChangedAtForCreate('LAPSED')).toBeNull()
  })

  it('returns null when the incoming status is already CANCELLED', () => {
    expect(statusChangedAtForCreate('CANCELLED')).toBeNull()
  })

  it('returns a Date for a non-terminal status like PENDING', () => {
    expect(statusChangedAtForCreate('PENDING')).toBeInstanceOf(Date)
  })

  it('returns a Date for a non-terminal status like INFORCE', () => {
    expect(statusChangedAtForCreate('INFORCE')).toBeInstanceOf(Date)
  })
})

describe('resolveImportProvider', () => {
  it('defaults a missing provider to MANUAL_IMPORT', () => {
    expect(resolveImportProvider(undefined)).toBe('MANUAL_IMPORT')
    expect(resolveImportProvider('  ')).toBe('MANUAL_IMPORT')
  })

  it('keeps an explicit provider', () => {
    expect(resolveImportProvider('NATIONAL_LIFE')).toBe('NATIONAL_LIFE')
  })
})

describe('resolvePolicyExternalId', () => {
  it('falls back to the policy number', () => {
    expect(resolvePolicyExternalId(null, 'NLG-0002')).toBe('NLG-0002')
  })

  it('prefers an explicit external id', () => {
    expect(resolvePolicyExternalId('POL-9', 'NLG-0002')).toBe('POL-9')
  })
})

describe('deriveCommissionSourceId', () => {
  const base = { amount: 100, occurrence: 1, policyNumber: 'NLG-0002', agentNpn: '1000003', period: '2026-01' }

  it('is deterministic for the same inputs', () => {
    expect(deriveCommissionSourceId(base)).toBe(deriveCommissionSourceId(base))
  })

  it('differs per row so distinct rows never collide', () => {
    expect(deriveCommissionSourceId(base)).not.toBe(deriveCommissionSourceId({ ...base, occurrence: 2 }))
  })

  it('prefers an explicit source transaction id', () => {
    expect(deriveCommissionSourceId({ ...base, sourceTransactionId: 'EVT-42' })).toBe('EVT-42')
  })
})

describe('periodToDate', () => {
  it('anchors a period to the first of the month (UTC)', () => {
    expect(periodToDate('2026-01').toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})
