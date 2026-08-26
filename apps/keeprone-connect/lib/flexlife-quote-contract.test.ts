import { describe, expect, it } from 'vitest'
import { parseFlexLifeQuoteSnapshot, sha256FlexLifeQuoteSnapshot } from './flexlife-quote-contract'

const snapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_quote_1',
  request: {
    IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
    IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
    Amount: 250000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
    Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
  },
} as const

describe('extension FlexLife quote trust boundary', () => {
  it('independently accepts and hashes the exact approved request', async () => {
    expect(parseFlexLifeQuoteSnapshot(snapshot)).toEqual(snapshot)
    await expect(sha256FlexLifeQuoteSnapshot(snapshot)).resolves.toBe(
      'be96cd11f9ca6da7bd5d9734386d5aec91e8c5c8ceeaf70a60e78874333a5558',
    )
  })

  it('rejects an unapproved endpoint field or carrier product', () => {
    expect(parseFlexLifeQuoteSnapshot({
      ...snapshot,
      request: { ...snapshot.request, endpoint: 'https://evil.example' },
    })).toBeNull()
    expect(parseFlexLifeQuoteSnapshot({
      ...snapshot,
      request: { ...snapshot.request, ProductCode: '999' },
    })).toBeNull()
  })
})
