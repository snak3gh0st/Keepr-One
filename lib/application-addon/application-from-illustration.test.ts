import { describe, expect, it } from 'vitest'
import {
  ApplicationFromIllustrationError,
  buildApplicationFromIllustrationSeed,
} from './application-from-illustration'

const common = {
  caseId: null,
  createdAt: new Date('2026-08-31T12:00:00.000Z'),
  documentReady: true,
}

describe('Application from official Illustration', () => {
  it('seeds an IUL Application with carrier-confirmed values', () => {
    const seed = buildApplicationFromIllustrationSeed({
      ...common,
      id: 'illustration-iul-1',
      productName: 'FlexLife',
      faceAmount: 250_000,
      premium: 350,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 2,
          firstName: 'Ana', lastName: 'Teste', dateOfBirth: '1990-01-01', issueState: 'FL',
          gender: 'Female', rateClass: 'Standard_NT', solveBasis: 'PREMIUM',
          targetMonthlyPremium: 300, deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
        foresightResult: {
          solveBasis: 'PREMIUM', requestedAmount: 300, confirmedFaceAmount: 250_000,
          confirmedMonthlyPremium: 350, confirmedAnnualPremium: 4_200,
        },
      },
    }, 'case-1')

    expect(seed.insuranceCase).toEqual({
      productType: 'IUL', targetCoverage: 250_000, monthlyBudget: 350,
    })
    expect(seed.dossier.coverage).toMatchObject({
      family: 'IUL',
      carrierProduct: 'FlexLife (25)(LSW)',
      illustrationId: 'illustration-iul-1',
      faceAmount: 250_000,
      plannedPremium: 350,
      premiumMode: 'MONTHLY',
    })
    expect(seed.dossier.coverage?.illustrationInputHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('seeds a Term Application from the official PDF result and duration', () => {
    const seed = buildApplicationFromIllustrationSeed({
      ...common,
      id: 'illustration-term-1',
      productName: 'LSW Term',
      faceAmount: 500_000,
      premium: 62.92,
      rawPayload: {
        foresightTermDraft: {
          schemaVersion: 1, carrierProduct: 'LSW Term', firstName: 'Bruno', lastName: 'Teste',
          dateOfBirth: '1985-03-02', issueState: 'FL', gender: 'Male', rateClass: 'Standard_Tobacco',
          faceAmount: 500_000, premiumMode: 'Monthly', termDuration: '20-G',
        },
        foresightTermResult: {
          source: 'OFFICIAL_PDF', premiumMode: 'Monthly', confirmedFaceAmount: 500_000,
          confirmedMonthlyPremium: 62.92, confirmedAnnualPremium: 755.04,
          requestedTermDuration: '20-G', confirmedTermDuration: '15-G',
        },
      },
    }, 'case-2')

    expect(seed.prospect.tobaccoStatus).toBe('YES')
    expect(seed.dossier.coverage).toMatchObject({
      family: 'TERM', carrierProduct: 'LSW 15-G', termDuration: '15-G',
      illustrationId: 'illustration-term-1', faceAmount: 500_000, plannedPremium: 62.92,
    })
  })

  it('refuses to start before the official PDF and values exist', () => {
    expect(() => buildApplicationFromIllustrationSeed({
      ...common,
      id: 'illustration-pending', productName: 'FlexLife', rawPayload: {},
      documentReady: false, faceAmount: null, premium: null,
    }, 'case-3')).toThrow(ApplicationFromIllustrationError)
  })
})
