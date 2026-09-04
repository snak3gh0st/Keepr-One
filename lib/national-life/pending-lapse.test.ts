import { describe, expect, it } from 'vitest'
import { isCanonicalPendingLapse } from './pending-lapse'

describe('isCanonicalPendingLapse', () => {
  it('accepts canonical Pending Lapse casing without accepting whitespace-padded values', () => {
    expect(isCanonicalPendingLapse('Pending Lapse')).toBe(true)
    expect(isCanonicalPendingLapse('pending lapse')).toBe(true)
    expect(isCanonicalPendingLapse(' Pending Lapse ')).toBe(false)
    expect(isCanonicalPendingLapse(null)).toBe(false)
  })
})
