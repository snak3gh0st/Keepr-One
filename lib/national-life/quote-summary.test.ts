import { describe, expect, it } from 'vitest'
import { summarizeQuotePayload } from './quote-summary'

const payload = {
  request: {
    IssueState: 'FL',
    IssueAge: 45,
    Gender: 'Male',
    RateClass: 'NonTobacco',
    Strategy: 'S&P 500 Annual Point-to-Point',
    DeathBenefitOption: 'Level',
  },
  response: { faceAmount: 421546, annualPremium: 3600, monthlyPremium: 300 },
}

describe('summarizeQuotePayload', () => {
  it('pulls the question the carrier was asked, not just its answer', () => {
    expect(summarizeQuotePayload(payload)).toEqual({
      issueAge: 45,
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'NonTobacco',
      strategy: 'S&P 500 Annual Point-to-Point',
      annualPremium: 3600,
    })
  })

  it('returns nulls rather than inventing values when the payload predates a field', () => {
    expect(summarizeQuotePayload({ request: {}, response: {} })).toEqual({
      issueAge: null,
      issueState: null,
      gender: null,
      rateClass: null,
      strategy: null,
      annualPremium: null,
    })
  })

  it('survives a payload that is not shaped like a quote at all', () => {
    for (const value of [null, undefined, 'nope', 42, []]) {
      expect(summarizeQuotePayload(value).issueAge).toBeNull()
    }
  })

  it('ignores a value of the wrong type instead of rendering it', () => {
    expect(
      summarizeQuotePayload({ request: { IssueAge: 'quarenta' }, response: { annualPremium: {} } }),
    ).toMatchObject({ issueAge: null, annualPremium: null })
  })
})
