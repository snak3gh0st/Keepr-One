import { describe, expect, it } from 'vitest'
import { resolveApplicationIllustrationLink } from './illustration-link'

const flexLife = {
  id: 'illustration_iul_1',
  caseId: 'case_1',
  createdAt: new Date('2026-08-31T12:00:00.000Z'),
  productName: 'FlexLife',
  rawPayload: {
    foresightDraft: {
      schemaVersion: 1,
      firstName: 'Alex',
      lastName: 'Test',
      dateOfBirth: '1990-01-01',
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'Standard_NT',
      faceAmount: 500_000,
      monthlyPremium: 300,
      deathBenefitOption: 'A_Level',
      strategy: 'SP500PointToPointCapFocus',
    },
  },
}

const term = {
  id: 'illustration_term_1',
  caseId: 'case_1',
  createdAt: new Date('2026-08-31T12:00:00.000Z'),
  productName: 'NL Term',
  rawPayload: {
    foresightTermDraft: {
      schemaVersion: 1,
      carrierProduct: 'NL Term',
      firstName: 'Alex',
      lastName: 'Test',
      dateOfBirth: '1990-01-01',
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'Standard_NT',
      faceAmount: 500_000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
    },
  },
}

describe('Application Illustration link', () => {
  it('derives the hash server-side for the exact FlexLife iGO product', () => {
    expect(resolveApplicationIllustrationLink(flexLife, {
      family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL',
    })).toEqual({
      illustrationId: 'illustration_iul_1',
      illustrationInputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('derives a Term link only when carrier, duration, and state match', () => {
    expect(resolveApplicationIllustrationLink(term, {
      family: 'TERM', carrierProduct: 'NL 20-G', termDuration: '20-G', issueState: 'FL',
    })).toEqual({
      illustrationId: 'illustration_term_1',
      illustrationInputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(() => resolveApplicationIllustrationLink(term, {
      family: 'TERM', carrierProduct: 'NL 30-G', termDuration: '30-G', issueState: 'FL',
    })).toThrow('APPLICATION_ILLUSTRATION_MISMATCH')
    expect(() => resolveApplicationIllustrationLink(term, {
      family: 'TERM', carrierProduct: 'LSW 20-G', termDuration: '20-G', issueState: 'FL',
    })).toThrow('APPLICATION_ILLUSTRATION_MISMATCH')
  })

  it('accepts carrier-confirmed values even when a premium solve changed the requested premium', () => {
    expect(resolveApplicationIllustrationLink({ ...flexLife, faceAmount: 500_000, premium: 325 }, {
      family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL',
      faceAmount: 500_000, plannedPremium: 325, premiumMode: 'MONTHLY',
    })).toEqual({
      illustrationId: 'illustration_iul_1',
      illustrationInputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })

  it('rejects a cross-case Illustration before producing a link', () => {
    expect(() => resolveApplicationIllustrationLink({ ...flexLife, caseId: 'case_2' }, {
      family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL', expectedCaseId: 'case_1',
    })).toThrow('APPLICATION_ILLUSTRATION_MISMATCH')
  })
})
