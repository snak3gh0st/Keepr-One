import { describe, expect, it } from 'vitest'
import { mapApplicationStatus, mapRequirementStatus } from './status-map'

describe('National Life status mapping', () => {
  it('normalizes known application statuses and preserves the original label', () => {
    expect(mapApplicationStatus('Underwriting')).toEqual({
      normalized: 'UNDERWRITING',
      original: 'Underwriting',
      recognized: true,
    })

    expect(mapApplicationStatus('Issued')).toEqual({
      normalized: 'ISSUED',
      original: 'Issued',
      recognized: true,
    })
  })

  it('falls back unknown application statuses to STARTED without pretending they are recognized', () => {
    expect(mapApplicationStatus('Unknown Carrier Value')).toEqual({
      normalized: 'STARTED',
      original: 'Unknown Carrier Value',
      recognized: false,
    })
  })

  it('normalizes known requirement statuses and preserves the original label', () => {
    expect(mapRequirementStatus('Outstanding')).toEqual({
      normalized: 'OPEN',
      original: 'Outstanding',
      recognized: true,
    })

    expect(mapRequirementStatus('Received')).toEqual({
      normalized: 'RECEIVED',
      original: 'Received',
      recognized: true,
    })

    expect(mapRequirementStatus('Waived')).toEqual({
      normalized: 'WAIVED',
      original: 'Waived',
      recognized: true,
    })
  })
})
