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
      ok: null,
      issueAge: 45,
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'NonTobacco',
      strategy: 'S&P 500 Annual Point-to-Point',
      solveType: null,
      deathBenefitOption: 'Level',
      premiumMode: null,
      productCode: null,
      allocation: null,
      faceAmount: 421546,
      monthlyPremium: 300,
      annualPremium: 3600,
      lapseYear: null,
    })
  })

  it('returns nulls rather than inventing values when the payload predates a field', () => {
    expect(summarizeQuotePayload({ request: {}, response: {} })).toEqual({
      ok: null,
      issueAge: null,
      issueState: null,
      gender: null,
      rateClass: null,
      strategy: null,
      solveType: null,
      deathBenefitOption: null,
      premiumMode: null,
      productCode: null,
      allocation: null,
      faceAmount: null,
      monthlyPremium: null,
      annualPremium: null,
      lapseYear: null,
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

// Shape copied from a real row in production, 2026-07-31.
const realPayload = {
  request: {
    Amount: 300,
    Gender: 'Male',
    IssueAge: 38,
    LastName: 'Teste',
    Strategy: 'SP500PointToPointCapFocus',
    FirstName: 'Paulo',
    RateClass: 'Standard_NT',
    SolveType: 'Min_DB_Max_Cash_Value',
    Allocation: 100,
    IssueState: 'FL',
    DateOfBirth: '06/02/1988',
    PremiumMode: 'Monthly',
    ProductCode: '956',
    DeathBenefitOption: 'A_Level',
  },
  response: {
    ok: true,
    lapseYear: null,
    faceAmount: 215473,
    annualPremium: 3600,
    monthlyPremium: 300,
  },
}

describe('summarizeQuotePayload — campos do resumo', () => {
  it('reads back everything the summary screen shows', () => {
    const facts = summarizeQuotePayload(realPayload)

    expect(facts.solveType).toBe('Min_DB_Max_Cash_Value')
    expect(facts.deathBenefitOption).toBe('A_Level')
    expect(facts.productCode).toBe('956')
    expect(facts.premiumMode).toBe('Monthly')
    expect(facts.allocation).toBe(100)
    expect(facts.faceAmount).toBe(215473)
    expect(facts.monthlyPremium).toBe(300)
    expect(facts.annualPremium).toBe(3600)
    expect(facts.ok).toBe(true)
  })

  // This stored row predates the fix that tells "carrier confirmed never
  // lapses" apart from "not known" (see the LapseYear doc comment in
  // lib/national-life/rapid-solve.ts). Its raw payload already has
  // `lapseYear: null`, and null is the only honest reading of it now: a
  // pre-fix null could have started life as either a real carrier "does not
  // lapse" (LapseYear: 0) or an unparseable answer, and that distinction was
  // destroyed before this fix existed — nothing at read time can recover it.
  it('reads a pre-fix stored null as "not known", never as a fabricated "never"', () => {
    expect(summarizeQuotePayload(realPayload).lapseYear).toBeNull()
  })

  // Carrier behaviour: a real projected lapse year.
  it('keeps a real lapse year distinct from the other two states', () => {
    expect(
      summarizeQuotePayload({ ...realPayload, response: { ...realPayload.response, lapseYear: 12 } })
        .lapseYear,
    ).toBe(12)
  })

  // Carrier behaviour: the carrier confirmed the policy never lapses. Stored
  // by the parser as the literal 'NEVER', never as a raw 0 — this function
  // must not re-derive that from a stored 0, because by the time a payload is
  // stored, only the parse site is allowed to have made that call.
  it('keeps "does not lapse" distinct from a year and from not-known', () => {
    expect(
      summarizeQuotePayload({
        ...realPayload,
        response: { ...realPayload.response, lapseYear: 'NEVER' },
      }).lapseYear,
    ).toBe('NEVER')
  })

  // A refusal is a real answer. It must not read as a quote of zero.
  it('reports a refusal as a refusal', () => {
    const facts = summarizeQuotePayload({
      request: realPayload.request,
      response: { ok: false },
    })
    expect(facts.ok).toBe(false)
    expect(facts.faceAmount).toBeNull()
  })

  // Rows written before a field existed must open, not crash.
  it('survives a payload it has never seen', () => {
    const facts = summarizeQuotePayload({ nothing: 'familiar' })
    expect(facts.solveType).toBeNull()
    expect(facts.faceAmount).toBeNull()
    expect(facts.ok).toBeNull()
  })
})
