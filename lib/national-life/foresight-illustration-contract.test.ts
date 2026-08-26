import { describe, expect, it } from 'vitest'
import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
} from './foresight-illustration-contract'

const input = {
  id: 'cm123illustration',
  caseId: null,
  createdAt: new Date('2026-08-26T17:00:00.000Z'),
  productName: 'FlexLife',
  rawPayload: {
    request: {
      IssueState: 'FL',
      FirstName: 'KeeprOne',
      LastName: 'Test',
      DateOfBirth: '01/01/1990',
      Gender: 'Male',
      RateClass: 'Standard_NT',
      SolveType: 'Specify_Amount',
      Amount: 100_000,
      DeathBenefitOption: 'A_Level',
      Strategy: 'SP500PointToPointCapFocus',
      Allocation: 100,
      ProductCode: '956',
    },
  },
}

describe('server-owned Foresight illustration snapshot', () => {
  it('builds a versioned immutable FlexLife snapshot without an InsuranceCase', () => {
    expect(buildForesightIllustrationSnapshot(input)).toEqual({
      schemaVersion: 1,
      illustrationId: 'cm123illustration',
      caseId: null,
      carrierCaseName: 'KEEPRONE-20260826-CM123ILLUSTRATION',
      insured: {
        firstName: 'KeeprOne',
        lastName: 'Test',
        dateOfBirth: '1990-01-01',
        issueState: 'FL',
      },
      product: { name: 'FlexLife', code: '956' },
      solve: { method: 'Specify_Amount', amount: 100_000 },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      deathBenefitOption: 'A_Level',
      allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
      riders: [],
      reports: ['CLIENT_ILLUSTRATION'],
    })
  })

  it('hashes the canonical snapshot and changes the hash with a material input', () => {
    const first = buildForesightIllustrationSnapshot(input)
    const changed = buildForesightIllustrationSnapshot({
      ...input,
      rawPayload: {
        request: { ...(input.rawPayload.request), Amount: 200_000 },
      },
    })
    expect(foresightIllustrationInputHash(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(foresightIllustrationInputHash(changed)).not.toBe(foresightIllustrationInputHash(first))
  })

  it.each([
    { ...input, productName: 'Term' },
    { ...input, rawPayload: {} },
    { ...input, rawPayload: { request: { ...input.rawPayload.request, ProductCode: '999' } } },
    { ...input, rawPayload: { request: { ...input.rawPayload.request, Allocation: 99 } } },
    { ...input, rawPayload: { request: { ...input.rawPayload.request, FirstName: '' } } },
  ])('fails closed when the reviewed source is incomplete or unsupported', (candidate) => {
    expect(() => buildForesightIllustrationSnapshot(candidate)).toThrow('INVALID_FORESIGHT_INPUT')
  })
})
