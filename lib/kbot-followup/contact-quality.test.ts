import { describe, expect, it } from 'vitest'
import { phoneIssue, reviewedPhone } from './contact-quality'

describe('contact review', () => {
  it('distinguishes missing numbers, missing country codes and invalid content', () => {
    expect(phoneIssue(null)).toBe('MISSING')
    expect(phoneIssue('(407) 555-0100')).toBe('COUNTRY_REQUIRED')
    expect(phoneIssue('call me')).toBe('INVALID')
    expect(phoneIssue('++14075550100')).toBe('INVALID')
    expect(phoneIssue('+1 (407) 555-0100')).toBeNull()
  })
  it('requires an explicit country choice before formatting national numbers', () => {
    expect(reviewedPhone('4075550100', '')).toBeNull()
    expect(reviewedPhone('4075550100', '1')).toBe('+14075550100')
    expect(reviewedPhone('11987654321', '55')).toBe('+5511987654321')
    expect(reviewedPhone('14075550100', '1')).toBeNull()
    expect(reviewedPhone('+44 20 7946 0000', '')).toBe('+442079460000')
    expect(reviewedPhone('4075550100 ext 2', '1')).toBeNull()
  })
})
