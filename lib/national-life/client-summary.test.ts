import { describe, expect, it } from 'vitest'
import { buildClientSummary } from './client-summary'

function projectionRow(overrides: Partial<Record<string, number | null>> & { policyYear: number; age: number }) {
  return {
    premiumOutlay: 3600,
    weightedAverageInterestRate: 6.1,
    loan: null,
    annualIncome: null,
    accumulatedValue: 10_000,
    cashSurrenderValue: 8_000,
    netDeathBenefit: 500_000,
    ...overrides,
  }
}

const quickReview = {
  summary: {
    initialFaceAmount: 500_000,
    lapseYear: null,
    mecYear: null,
    modalPremium: 300,
    minimumPremium: null,
    deathBenefitProtectionPremium: null,
    targetPremium: 4_200,
    mecPremium: null,
    guidelineLevelPremium: null,
    guidelineSinglePremium: null,
  },
  annualProjection: [1, 5, 10, 20, 30].map((policyYear) =>
    projectionRow({
      policyYear,
      age: 39 + policyYear,
      accumulatedValue: policyYear * 12_000,
      cashSurrenderValue: policyYear * 10_000,
      netDeathBenefit: 500_000 + policyYear * 1_000,
    })),
}

const verifiedIllustration = {
  insuredName: 'Maria Silva',
  productName: '956',
  documentFetchedAt: new Date('2026-09-01T12:00:00Z'),
  documentMimeType: 'application/pdf',
  rawPayload: {
    foresightResult: {
      solveBasis: 'PREMIUM',
      requestedAmount: 300,
      confirmedFaceAmount: 500_000,
      confirmedMonthlyPremium: 300,
      confirmedAnnualPremium: 3_600,
      quickReview,
    },
  },
}

describe('client summary eligibility', () => {
  it('builds from an illustration whose PDF arrived and whose result is verified', () => {
    const summary = buildClientSummary(verifiedIllustration)
    expect(summary).not.toBeNull()
    expect(summary).toMatchObject({
      kind: 'PROJECTED',
      insuredName: 'Maria Silva',
      productLabel: 'FlexLife',
      faceAmount: 500_000,
      monthlyPremium: 300,
      annualPremium: 3_600,
    })
  })

  it('refuses an illustration whose official PDF has not arrived', () => {
    expect(buildClientSummary({
      ...verifiedIllustration, documentFetchedAt: null,
    })).toBeNull()
  })

  it('refuses a stored document that is not the carrier PDF', () => {
    expect(buildClientSummary({
      ...verifiedIllustration, documentMimeType: 'text/html',
    })).toBeNull()
  })

  it('refuses an illustration with no verified carrier result', () => {
    expect(buildClientSummary({
      ...verifiedIllustration, rawPayload: { foresightRequest: { faceAmount: 500_000 } },
    })).toBeNull()
  })


  it('refuses a projection too short to draw a curve from', () => {
    expect(buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: { ...quickReview, annualProjection: [projectionRow({ policyYear: 1, age: 40 })] },
        },
      },
    })).toBeNull()
  })
})

describe('client summary contents', () => {
  it('charts only the years the carrier gave a death benefit for', () => {
    const summary = buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: {
            ...quickReview,
            annualProjection: [
              ...quickReview.annualProjection,
              projectionRow({ policyYear: 40, age: 79, netDeathBenefit: null }),
            ],
          },
        },
      },
    })
    expect(summary?.kind === 'PROJECTED' && summary.coverage.map((point) => point.policyYear))
      .toEqual([1, 5, 10, 20, 30])
  })

  it('picks years 5, 10 and 20 plus the last projected year as the milestones', () => {
    const summary = buildClientSummary(verifiedIllustration)
    expect(summary?.kind === 'PROJECTED' && summary.milestones).toEqual([
      { policyYear: 5, age: 44, netDeathBenefit: 505_000, cashSurrenderValue: 50_000 },
      { policyYear: 10, age: 49, netDeathBenefit: 510_000, cashSurrenderValue: 100_000 },
      { policyYear: 20, age: 59, netDeathBenefit: 520_000, cashSurrenderValue: 200_000 },
      { policyYear: 30, age: 69, netDeathBenefit: 530_000, cashSurrenderValue: 300_000 },
    ])
  })

  it('never repeats a milestone when the last projected year is already one', () => {
    const summary = buildClientSummary({
      ...verifiedIllustration,
      rawPayload: {
        foresightResult: {
          ...verifiedIllustration.rawPayload.foresightResult,
          quickReview: {
            ...quickReview,
            annualProjection: quickReview.annualProjection.filter((row) => row.policyYear <= 20),
          },
        },
      },
    })
    expect(summary?.kind === 'PROJECTED' && summary.milestones.map((m) => m.policyYear))
      .toEqual([5, 10, 20])
  })

  it('falls back to a neutral name rather than printing an empty line to the client', () => {
    expect(buildClientSummary({ ...verifiedIllustration, insuredName: null })?.insuredName)
      .toBe('Prepared for you')
  })
})

describe('Term summaries', () => {
  function termIllustration(confirmedTermDuration: string, requested = confirmedTermDuration) {
    return {
      insuredName: 'Ale Teste',
      productName: 'NL Term',
      documentFetchedAt: new Date('2026-09-01T12:00:00Z'),
      documentMimeType: 'application/pdf',
      rawPayload: {
        foresightTermDraft: {
          schemaVersion: 1,
          firstName: 'Ale', lastName: 'Teste', dateOfBirth: '1989-03-12',
          issueState: 'FL', gender: 'Male', rateClass: 'Standard_NT',
          faceAmount: 500_000, premiumMode: 'Monthly', termDuration: requested,
        },
        foresightTermResult: {
          source: 'OFFICIAL_PDF',
          premiumMode: 'Monthly',
          confirmedFaceAmount: 500_000,
          confirmedMonthlyPremium: 62.92,
          confirmedAnnualPremium: 755.04,
          requestedTermDuration: requested,
          confirmedTermDuration,
        },
      },
    }
  }

  it('summarises Term from the four numbers the carrier confirmed', () => {
    const summary = buildClientSummary(termIllustration('20-G'))
    expect(summary).toMatchObject({
      kind: 'LEVEL_TERM',
      insuredName: 'Ale Teste',
      productLabel: 'NL Term',
      faceAmount: 500_000,
      monthlyPremium: 62.92,
      annualPremium: 755.04,
      durationLabel: 'Level premium guaranteed for 20 years',
    })
  })

  // The one thing a client holding an ART policy most needs to read, and the
  // reason a level coverage band is never drawn for Term.
  it('says plainly that an annually renewable premium rises each year', () => {
    const summary = buildClientSummary(termIllustration('ART'))
    expect(summary?.kind === 'LEVEL_TERM' && summary.durationLabel)
      .toBe('Annually renewable — the premium increases each year')
  })

  it('carries no projection to draw', () => {
    expect(buildClientSummary(termIllustration('30-G'))).not.toHaveProperty('coverage')
  })

  it('produces nothing for a Term result written before durations were confirmed', () => {
    const illustration = termIllustration('20-G')
    const { confirmedTermDuration, ...withoutDuration } = illustration.rawPayload.foresightTermResult
    void confirmedTermDuration
    expect(buildClientSummary({
      ...illustration,
      rawPayload: { ...illustration.rawPayload, foresightTermResult: withoutDuration },
    })).toBeNull()
  })

  it('still requires the official PDF to have arrived', () => {
    expect(buildClientSummary({
      ...termIllustration('20-G'), documentFetchedAt: null,
    })).toBeNull()
  })
})
