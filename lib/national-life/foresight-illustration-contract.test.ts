import { describe, expect, it } from 'vitest'
import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
  parseForesightIllustrationReceipt,
  parseForesightSolvedIllustrationReceipt,
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
    response: { ok: true, faceAmount: 100_000, monthlyPremium: 250 },
  },
}

describe('server-owned Foresight illustration snapshot', () => {
  it('builds the official request from explicit Foresight inputs, not a Rapid Solve response', () => {
    const snapshot = buildForesightIllustrationSnapshot({
      ...input,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 1,
          firstName: 'KeeprOne',
          lastName: 'Test',
          dateOfBirth: '1990-01-01',
          issueState: 'NY',
          gender: 'Male',
          rateClass: 'Standard_NT',
          faceAmount: 100_000,
          monthlyPremium: 250,
          deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
      },
    })

    expect(snapshot).toMatchObject({
      insured: { dateOfBirth: '1990-01-01', issueState: 'NY' },
      solve: { method: 'Specify_Amount', amount: 100_000 },
      faceAmount: 100_000,
      premium: { mode: 'Monthly', amount: 250 },
    })
  })

  it('seals a premium-solved scenario without pretending that its face amount is known', () => {
    expect(buildForesightIllustrationSnapshot({
      ...input,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 2,
          firstName: 'KeeprOne',
          lastName: 'Test',
          dateOfBirth: '1990-01-01',
          issueState: 'FL',
          gender: 'Male',
          rateClass: 'Standard_NT',
          solveBasis: 'PREMIUM',
          targetMonthlyPremium: 350,
          deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
      },
    })).toMatchObject({
      schemaVersion: 2,
      solve: { basis: 'PREMIUM', method: 'Based_on_Target_Premium', amount: 350 },
      faceAmount: null,
      premium: { mode: 'Monthly', amount: 350 },
    })
  })

  it('seals the selected National Life strategy into the immutable request', () => {
    expect(buildForesightIllustrationSnapshot({
      ...input,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 2,
          firstName: 'KeeprOne',
          lastName: 'Test',
          dateOfBirth: '1990-01-01',
          issueState: 'FL',
          gender: 'Male',
          rateClass: 'Standard_NT',
          solveBasis: 'PREMIUM',
          solveMethod: 'Minimum_DB_Max_Cash_Value',
          targetMonthlyPremium: 2_000,
          deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
      },
    })).toMatchObject({
      solve: { basis: 'PREMIUM', method: 'Minimum_DB_Max_Cash_Value', amount: 2_000 },
    })
  })

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
      faceAmount: 100_000,
      premium: { mode: 'Monthly', amount: 250 },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      deathBenefitOption: 'A_Level',
      allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
      riders: [
        'DeathBenefitProtection',
        'ABRTerminalIllness',
        'ABRChronicIllness',
        'ABRCriticalIllness',
        'ABRCriticalInjury',
        'ABRAlzheimersDisease',
      ],
      reports: ['NAIC_ILLUSTRATION'],
    })
  })

  it('hashes the canonical snapshot and changes the hash with a material input', () => {
    const first = buildForesightIllustrationSnapshot(input)
    const changed = buildForesightIllustrationSnapshot({
      ...input,
      rawPayload: {
        request: { ...(input.rawPayload.request), Amount: 200_000 },
        response: { ...input.rawPayload.response, faceAmount: 200_000 },
      },
    })
    expect(foresightIllustrationInputHash(first)).toMatch(/^[a-f0-9]{64}$/)
    expect(foresightIllustrationInputHash(changed)).not.toBe(foresightIllustrationInputHash(first))
  })

  it('accepts only an exact NAIC PDF receipt', () => {
    const receipt = {
      inputHash: 'a'.repeat(64),
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: 'KEEPRONE-20260826-CM123ILLUSTRATION',
      productCode: '956',
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: 'c'.repeat(64),
      documentBytes: 1_500_000,
      saved: true,
    }
    expect(parseForesightIllustrationReceipt(receipt)).toEqual(receipt)
    expect(parseForesightIllustrationReceipt({ ...receipt, reportCode: 'CLIENT_ILLUSTRATION' })).toBeNull()
    expect(parseForesightIllustrationReceipt({ ...receipt, extra: true })).toBeNull()
  })

  it('accepts a calculated IUL result only when it reports both values', () => {
    const receipt = {
      inputHash: 'a'.repeat(64),
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: 'KEEPRONE-20260827-CM123ILLUSTRATION',
      productCode: '956',
      solveBasis: 'DEATH_BENEFIT',
      faceAmount: 250_000,
      monthlyPremium: 350,
      annualPremium: 4_200,
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: 'c'.repeat(64),
      documentBytes: 1_500_000,
      saved: true,
    } as const
    expect(parseForesightSolvedIllustrationReceipt(receipt)).toEqual(receipt)
    expect(parseForesightSolvedIllustrationReceipt({ ...receipt, monthlyPremium: 0 })).toBeNull()
    expect(parseForesightSolvedIllustrationReceipt({ ...receipt, annualPremium: 0 })).toBeNull()
  })

  it('accepts only a bounded annual Quick Review table from Foresight', () => {
    const receipt = {
      inputHash: 'a'.repeat(64), caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: 'KEEPRONE-20260902-CM123ILLUSTRATION', productCode: '956',
      solveBasis: 'PREMIUM', faceAmount: 1_300_000, monthlyPremium: 2_000,
      annualPremium: 24_000, release: '5.3.65.31', reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: 'c'.repeat(64), documentBytes: 1_500_000, saved: true,
      quickReview: {
        evidence: {
          source: 'FORESIGHT_QUICK_VIEW', observedAt: '2026-09-02T18:00:00.000Z',
          sourceRows: [['Initial Face Amount', 'Target Premium'], ['1300000', '18501.6']],
        },
        summary: {
          initialFaceAmount: 1_300_000, lapseYear: 0, mecYear: 0, modalPremium: 2_000,
          minimumPremium: 6_511.92, deathBenefitProtectionPremium: 6_655.44,
          targetPremium: 18_501.6, mecPremium: 87_021, guidelineLevelPremium: 23_422,
          guidelineSinglePremium: 375_315,
        },
        annualProjection: [{
          policyYear: 1, age: 31, premiumOutlay: 24_000, weightedAverageInterestRate: 5.89,
          loan: 0, annualIncome: 0, accumulatedValue: 16_088.19,
          cashSurrenderValue: 6_088.19, netDeathBenefit: 1_316_188.19,
        }],
      },
    } as const
    expect(parseForesightSolvedIllustrationReceipt(receipt)).toEqual(receipt)
    expect(parseForesightSolvedIllustrationReceipt({
      ...receipt,
      quickReview: { ...receipt.quickReview, annualProjection: [] },
    })).toBeNull()
    expect(parseForesightSolvedIllustrationReceipt({
      ...receipt,
      quickReview: {
        ...receipt.quickReview,
        summary: { ...receipt.quickReview.summary, modalPremium: null },
      },
    })).toBeNull()
  })

  it.each([
    { ...input, productName: 'Term' },
    { ...input, rawPayload: {} },
    { ...input, rawPayload: { request: { ...input.rawPayload.request, ProductCode: '999' } } },
    { ...input, rawPayload: { request: { ...input.rawPayload.request, Allocation: 99 } } },
    { ...input, rawPayload: { request: { ...input.rawPayload.request, FirstName: '' } } },
    {
      ...input,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 1, firstName: 'KeeprOne', lastName: 'Test', dateOfBirth: '1990-01-01',
          issueState: 'FL', gender: 'Male', rateClass: 'Standard_NT', faceAmount: 100_000,
          monthlyPremium: 0, deathBenefitOption: 'A_Level', strategy: 'SP500PointToPointCapFocus',
        },
      },
    },
  ])('fails closed when the reviewed source is incomplete or unsupported', (candidate) => {
    expect(() => buildForesightIllustrationSnapshot(candidate)).toThrow('INVALID_FORESIGHT_INPUT')
  })
})
