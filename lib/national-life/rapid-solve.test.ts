import { describe, expect, it } from 'vitest'
import {
  ISSUE_STATES,
  RAPID_SOLVE_PREMIUM_MODE,
  RAPID_SOLVE_PRODUCT_CODE,
  RATE_CLASSES,
  SOLVE_TYPES,
  STRATEGIES,
  buildRapidSolveRequest,
  issueAgeFrom,
  parseRapidSolveResponse,
  toCarrierDate,
} from './rapid-solve'

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe('issueAgeFrom — age nearest birthday', () => {
  it('is age last birthday just after a birthday', () => {
    expect(issueAgeFrom(utc(1986, 3, 10), utc(2026, 3, 20))).toBe(40)
  })

  it('rounds up once the next birthday is closer', () => {
    // Seven months past the 40th: an underwriter calls this 41.
    expect(issueAgeFrom(utc(1986, 3, 10), utc(2026, 10, 20))).toBe(41)
  })

  it('is exact on the birthday itself', () => {
    expect(issueAgeFrom(utc(1986, 3, 10), utc(2026, 3, 10))).toBe(40)
  })

  it('handles a date before this year birthday', () => {
    expect(issueAgeFrom(utc(1986, 11, 10), utc(2026, 1, 5))).toBe(39)
  })

  it('handles a leap-day birth without throwing', () => {
    expect(issueAgeFrom(utc(2000, 2, 29), utc(2026, 6, 1))).toBeGreaterThan(25)
  })
})

describe('toCarrierDate', () => {
  it('uses the MM/DD/YYYY the carrier picker submits, not ISO', () => {
    expect(toCarrierDate(utc(1986, 3, 7))).toBe('03/07/1986')
  })
})

describe('buildRapidSolveRequest', () => {
  const input = {
    issueState: 'FL',
    firstName: 'Ana',
    lastName: 'Souza',
    dateOfBirth: utc(1986, 3, 10),
    gender: 'F',
    rateClass: 'NonTobacco',
    solveType: SOLVE_TYPES.SPECIFY_AMOUNT,
    amount: 250_000,
    deathBenefitOption: 'Level',
    strategy: 'S&P',
    allocation: 100,
  }

  it('sends the fields the carrier bundle names', () => {
    expect(buildRapidSolveRequest(input, utc(2026, 3, 20))).toEqual({
      IssueState: 'FL',
      FirstName: 'Ana',
      LastName: 'Souza',
      DateOfBirth: '03/10/1986',
      IssueAge: 40,
      Gender: 'F',
      RateClass: 'NonTobacco',
      SolveType: 'Specify_Amount',
      Amount: 250_000,
      DeathBenefitOption: 'Level',
      Strategy: 'S&P',
      Allocation: 100,
      ProductCode: RAPID_SOLVE_PRODUCT_CODE,
      PremiumMode: RAPID_SOLVE_PREMIUM_MODE,
    })
  })

  it('carries the product and mode the carrier hardcodes', () => {
    const request = buildRapidSolveRequest(input, utc(2026, 3, 20))
    expect(request.ProductCode).toBe('956')
    expect(request.PremiumMode).toBe('Monthly')
  })

  // Read off the buttons' data-value, which is what the request carries. The
  // ids that look like these values ended one release in carrier refusals.
  it('sends the solve type values the carrier accepts, not the button ids', () => {
    expect(Object.values(SOLVE_TYPES)).toEqual([
      'Specify_Amount',
      'Based_on_Target_Premium',
      'Min_DB_Max_Cash_Value',
    ])
    expect(Object.values(SOLVE_TYPES)).not.toContain('Premium-DeathBenefitFocus')
  })

  it('offers only the two rate classes the screen has', () => {
    expect(Object.values(RATE_CLASSES)).toEqual(['Standard_NT', 'Standard_Tobacco'])
  })

  // A capped probe reported one strategy off a page with exactly sixty values.
  // Hardcoding it would have left two thirds of the dropdown unreachable.
  it('offers all three index strategies', () => {
    expect(Object.values(STRATEGIES)).toEqual([
      'SP500PointToPointCapFocus',
      'SP500PointToPointParFocus',
      'SP500PointToPointOnePercentFloor',
    ])
  })

  // New York is not on the carrier's list. A prospect there has to be turned
  // away before the request, not after a refusal.
  it('does not offer New York', () => {
    expect(ISSUE_STATES).not.toContain('NY')
    expect(ISSUE_STATES).toContain('FL')
    expect(ISSUE_STATES).toHaveLength(50)
  })

  it('lets a caller name the product, for when 956 is not the one wanted', () => {
    const request = buildRapidSolveRequest({ ...input, productCode: '957' }, utc(2026, 3, 20))
    expect(request.ProductCode).toBe('957')
  })

  it('sends allocation as an integer, as the bundle parses it', () => {
    const request = buildRapidSolveRequest({ ...input, allocation: 99.7 }, utc(2026, 3, 20))
    expect(request.Allocation).toBe(99)
  })
})

describe('parseRapidSolveResponse', () => {
  it('reads a successful quote', () => {
    expect(
      parseRapidSolveResponse({
        Success: true,
        FaceAmount: 250000,
        AnnualPremium: 3600,
        MonthlyPremium: 300,
        LapseYear: 0,
      }),
    ).toEqual({
      ok: true,
      faceAmount: 250000,
      annualPremium: 3600,
      monthlyPremium: 300,
      // 0 means "does not lapse" to the carrier, not year zero.
      lapseYear: null,
    })
  })

  it('keeps a real lapse year', () => {
    const result = parseRapidSolveResponse({
      Success: true,
      FaceAmount: 1,
      AnnualPremium: 1,
      MonthlyPremium: 1,
      LapseYear: 2061,
    })
    expect(result).toMatchObject({ ok: true, lapseYear: 2061 })
  })

  it('treats a body that says Success false as a failure, despite HTTP 200', () => {
    expect(parseRapidSolveResponse({ Success: false, Message: 'Idade fora do produto' })).toEqual({
      ok: false,
      message: 'Idade fora do produto',
    })
  })

  it('falls back to a readable message when the carrier gives none', () => {
    const result = parseRapidSolveResponse({ Success: false })
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toMatch(/illustration/i)
  })

  it('refuses a success with no figures rather than showing zeros as an answer', () => {
    expect(parseRapidSolveResponse({ Success: true })).toEqual({
      ok: false,
      message: 'A seguradora respondeu sem valores.',
    })
  })

  it('parses figures that arrive as display strings', () => {
    expect(
      parseRapidSolveResponse({
        Success: true,
        FaceAmount: '$250,000',
        AnnualPremium: '3,600.00',
        MonthlyPremium: '300',
        LapseYear: '2061',
      }),
    ).toEqual({
      ok: true,
      faceAmount: 250000,
      annualPremium: 3600,
      monthlyPremium: 300,
      lapseYear: 2061,
    })
  })

  it('does not throw on a non-object body', () => {
    expect(parseRapidSolveResponse(null).ok).toBe(false)
    expect(parseRapidSolveResponse('<html>error</html>').ok).toBe(false)
  })
})
