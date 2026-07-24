import { describe, it, expect } from 'vitest'
import { nextAnnualReview, isReviewDue } from './annual-review'

describe('nextAnnualReview', () => {
  it('advances one calendar year without mutating the input', () => {
    const from = new Date('2026-03-15T00:00:00.000Z')
    const next = nextAnnualReview(from)
    expect(next.toISOString()).toBe('2027-03-15T00:00:00.000Z')
    expect(from.toISOString()).toBe('2026-03-15T00:00:00.000Z') // not mutated
  })

  it('rolls Feb 29 to Mar 1 in a non-leap year', () => {
    expect(nextAnnualReview(new Date('2024-02-29T00:00:00.000Z')).toISOString()).toBe(
      '2025-03-01T00:00:00.000Z',
    )
  })
})

describe('isReviewDue', () => {
  const now = new Date('2026-07-24T12:00:00.000Z')
  it('is due when the date has arrived or passed', () => {
    expect(isReviewDue(new Date('2026-07-24T00:00:00.000Z'), now)).toBe(true)
    expect(isReviewDue(new Date('2026-07-01T00:00:00.000Z'), now)).toBe(true)
  })
  it('is not due when still in the future', () => {
    expect(isReviewDue(new Date('2026-08-01T00:00:00.000Z'), now)).toBe(false)
  })
})
