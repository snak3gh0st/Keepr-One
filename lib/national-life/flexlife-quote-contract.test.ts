import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalFlexLifeQuoteSnapshot,
  flexLifeQuoteInputHash,
  parseFlexLifeQuoteSnapshot,
} from './flexlife-quote-contract'

const snapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_quote_1',
  request: {
    IssueState: 'FL',
    FirstName: 'KeeprOne',
    LastName: 'Test',
    DateOfBirth: '08/26/1981',
    IssueAge: 45,
    Gender: 'Male',
    RateClass: 'Standard_NT',
    SolveType: 'Specify_Amount',
    Amount: 250000,
    DeathBenefitOption: 'A_Level',
    Strategy: 'SP500PointToPointCapFocus',
    Allocation: 100,
    ProductCode: '956',
    PremiumMode: 'Monthly',
  },
} as const

describe('sealed FlexLife quote input', () => {
  it('accepts the exact carrier request and produces a stable independent hash', () => {
    expect(parseFlexLifeQuoteSnapshot(snapshot)).toEqual(snapshot)
    const canonical = canonicalFlexLifeQuoteSnapshot(snapshot)
    expect(canonical).toBe(
      '{"illustrationId":"ill_quote_1","request":{"Allocation":100,"Amount":250000,"DateOfBirth":"08/26/1981","DeathBenefitOption":"A_Level","FirstName":"KeeprOne","Gender":"Male","IssueAge":45,"IssueState":"FL","LastName":"Test","PremiumMode":"Monthly","ProductCode":"956","RateClass":"Standard_NT","SolveType":"Specify_Amount","Strategy":"SP500PointToPointCapFocus"},"schemaVersion":1}',
    )
    expect(flexLifeQuoteInputHash(snapshot)).toBe(
      createHash('sha256').update(canonical).digest('hex'),
    )
  })

  it('rejects mutable extras and a request outside the carrier allowlist', () => {
    expect(parseFlexLifeQuoteSnapshot({
      ...snapshot,
      request: { ...snapshot.request, password: 'secret' },
    })).toBeNull()
    expect(parseFlexLifeQuoteSnapshot({
      ...snapshot,
      request: { ...snapshot.request, ProductCode: '999' },
    })).toBeNull()
  })
})
