import { describe, expect, it } from 'vitest'
import { shouldInstrumentNationalLifePath } from './constants'

describe('National Life content-script boundary', () => {
  it('never instruments login, MFA, or authentication callbacks', () => {
    for (const pathname of [
      '/agent/auth/login',
      '/agent/auth/mfa',
      '/agent/auth/mfacallback',
      '/agent/auth/logincallback',
      '/agent/signin',
    ]) {
      expect(shouldInstrumentNationalLifePath(pathname)).toBe(false)
    }
  })

  it('instruments authenticated agent pages', () => {
    expect(shouldInstrumentNationalLifePath('/agent/')).toBe(true)
    expect(shouldInstrumentNationalLifePath('/agent/book-of-business/inforce-book/all-clients'))
      .toBe(true)
  })
})
