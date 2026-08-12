import { describe, expect, it } from 'vitest'
import {
  matchesNationalLifeStagePath,
  shouldInstrumentNationalLifePath,
} from './constants'

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

  it('accepts only the known in-force route redirect as a legacy alias', () => {
    expect(matchesNationalLifeStagePath(
      'INFORCE_CLIENTS',
      '/agent/book-of-business/inforce-book/all-clients',
      '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'INFORCE_CLIENTS',
      '/agent/other-page',
      '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
    )).toBe(false)
  })

  it('accepts the paid-commission menu redirect only for that stage', () => {
    expect(matchesNationalLifeStagePath(
      'PAID_COMMISSIONS',
      '/agent/compensation/commissions/paid-commissions',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'COMMISSIONS_EARNING_REPORT',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
    )).toBe(true)
    expect(matchesNationalLifeStagePath(
      'PROJECTED_COMMISSIONS',
      '/agent/compensation/commissions/projected-commissions',
      '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
    )).toBe(false)
  })
})
