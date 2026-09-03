import { describe, expect, it } from 'vitest'
import {
  parseExecuteForesightIllustrationMessage,
  parseForesightExecutionResponse,
} from './foresight-messages'

const snapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-TEST-20260826-ILL-123',
  insured: { firstName: 'KeeprOne', lastName: 'Test', dateOfBirth: '1990-01-01', issueState: 'FL' },
  product: { name: 'FlexLife', code: '956' },
  solve: { method: 'Specify_Amount', amount: 100_000 },
  faceAmount: 100_000,
  premium: { mode: 'Monthly', amount: 250 },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  deathBenefitOption: 'A_Level',
  allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
  riders: [
    'DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness',
    'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease',
  ],
  reports: ['NAIC_ILLUSTRATION'],
} as const

const message = {
  type: 'EXECUTE_FORESIGHT_ILLUSTRATION',
  token: 't'.repeat(32),
  correlationId: 'c'.repeat(16),
  inputHash: 'a'.repeat(64),
  snapshot,
} as const

const termSnapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_term_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-TEST-20260827-ILLTERM123',
  product: { carrierName: 'NL Term', kind: 'TERM' },
  insured: { firstName: 'KeeprOne', lastName: 'Term', dateOfBirth: '1990-01-01', issueState: 'FL' },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  faceAmount: 250_000,
  premiumMode: 'Monthly',
  termDuration: '20-G',
  reports: ['NAIC_ILLUSTRATION'],
} as const

const premiumSolvedSnapshot = {
  schemaVersion: 2,
  illustrationId: 'ill_premium_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-TEST-20260827-ILLPREMIUM123',
  insured: { firstName: 'KeeprOne', lastName: 'Premium', dateOfBirth: '1990-01-01', issueState: 'FL' },
  product: { name: 'FlexLife', code: '956' },
  solve: { basis: 'PREMIUM', method: 'Based_on_Target_Premium', amount: 350 },
  faceAmount: null,
  premium: { mode: 'Monthly', amount: 350 },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  deathBenefitOption: 'A_Level',
  allocations: [{ strategy: 'SP500PointToPointCapFocus', percentage: 100 }],
  riders: [
    'DeathBenefitProtection', 'ABRTerminalIllness', 'ABRChronicIllness',
    'ABRCriticalIllness', 'ABRCriticalInjury', 'ABRAlzheimersDisease',
  ],
  reports: ['NAIC_ILLUSTRATION'],
} as const

describe('Foresight content messages', () => {
  it('accepts only a correlated and independently valid execution message', () => {
    expect(parseExecuteForesightIllustrationMessage(message)).toEqual(message)
    expect(parseExecuteForesightIllustrationMessage({ ...message, extra: true })).toBeNull()
    expect(parseExecuteForesightIllustrationMessage({ ...message, inputHash: 'bad' })).toBeNull()
  })

  it('validates the complete non-PII receipt', () => {
    const response = {
      ok: true,
      type: 'FORESIGHT_ILLUSTRATION_SAVED',
      token: message.token,
      correlationId: message.correlationId,
      receipt: {
        inputHash: message.inputHash,
        caseFingerprint: `case_${'b'.repeat(64)}`,
        carrierCaseName: snapshot.carrierCaseName,
        productCode: '956',
        release: '5.3.65.31',
        reportCode: 'NAIC_ILLUSTRATION',
        documentSha256: 'c'.repeat(64),
        documentBytes: 9,
        saved: true,
      },
      document: { contentType: 'application/pdf', pdfBase64: 'JVBERi0xLjcK' },
    }
    expect(parseForesightExecutionResponse(response, message)).toEqual(response)
    expect(() => parseForesightExecutionResponse({
      ...response,
      receipt: { ...response.receipt, inputHash: 'c'.repeat(64) },
    }, message)).toThrow('FORESIGHT_RESPONSE_INVALID')
  })

  it('accepts a Term command and receipt only for its named carrier', () => {
    const termMessage = { ...message, snapshot: termSnapshot }
    expect(parseExecuteForesightIllustrationMessage(termMessage)).toEqual(termMessage)
    const response = {
      ok: true,
      type: 'FORESIGHT_ILLUSTRATION_SAVED',
      token: termMessage.token,
      correlationId: termMessage.correlationId,
      receipt: {
        inputHash: termMessage.inputHash,
        caseFingerprint: `case_${'b'.repeat(64)}`,
        carrierCaseName: termSnapshot.carrierCaseName,
        carrierProduct: 'NL Term',
        requestedTermDuration: '20-G',
        confirmedTermDuration: '15-G',
        release: '5.3.65.31',
        reportCode: 'NAIC_ILLUSTRATION',
        documentSha256: 'c'.repeat(64),
        documentBytes: 9,
        saved: true,
      },
      document: { contentType: 'application/pdf', pdfBase64: 'JVBERi0xLjcK' },
    } as const
    expect(parseForesightExecutionResponse(response, termMessage)).toEqual(response)
    expect(() => parseForesightExecutionResponse({
      ...response,
      receipt: { ...response.receipt, carrierProduct: 'LSW Term' },
    }, termMessage)).toThrow('FORESIGHT_RESPONSE_INVALID')
    expect(() => parseForesightExecutionResponse({
      ...response,
      receipt: { ...response.receipt, requestedTermDuration: '30-G' },
    }, termMessage)).toThrow('FORESIGHT_RESPONSE_INVALID')
  })

  it('requires the Foresight-calculated result for a premium-solved IUL', () => {
    const premiumMessage = { ...message, snapshot: premiumSolvedSnapshot }
    const response = {
      ok: true,
      type: 'FORESIGHT_ILLUSTRATION_SAVED',
      token: premiumMessage.token,
      correlationId: premiumMessage.correlationId,
      receipt: {
        inputHash: premiumMessage.inputHash,
        caseFingerprint: `case_${'b'.repeat(64)}`,
        carrierCaseName: premiumSolvedSnapshot.carrierCaseName,
        productCode: '956',
        solveBasis: 'PREMIUM',
        faceAmount: 250_000,
        monthlyPremium: 350,
        annualPremium: 4_200,
        quickReview: {
          evidence: {
            source: 'FORESIGHT_QUICK_VIEW', observedAt: '2026-09-02T18:00:00.000Z',
            sourceRows: [['Initial Face Amount', 'Target Premium'], ['$250,000.00', '$4,000.00']],
          },
          summary: {
            initialFaceAmount: 250_000, lapseYear: 0, mecYear: 0, modalPremium: 350,
            minimumPremium: 100, deathBenefitProtectionPremium: 120, targetPremium: 4_000,
            mecPremium: 20_000, guidelineLevelPremium: 5_000, guidelineSinglePremium: 80_000,
          },
          annualProjection: [{
            policyYear: 1, age: 31, premiumOutlay: 4_200, weightedAverageInterestRate: 5.5,
            loan: 0, annualIncome: 0, accumulatedValue: 3_000, cashSurrenderValue: 2_000,
            netDeathBenefit: 252_000,
          }],
        },
        release: '5.3.65.31',
        reportCode: 'NAIC_ILLUSTRATION',
        documentSha256: 'c'.repeat(64),
        documentBytes: 9,
        saved: true,
      },
      document: { contentType: 'application/pdf', pdfBase64: 'JVBERi0xLjcK' },
    } as const

    expect(parseForesightExecutionResponse(response, premiumMessage)).toEqual(response)
    expect(() => parseForesightExecutionResponse({
      ...response,
      receipt: { ...response.receipt, faceAmount: 0 },
    }, premiumMessage)).toThrow('FORESIGHT_RESPONSE_INVALID')
    expect(() => parseForesightExecutionResponse({
      ...response,
      receipt: {
        ...response.receipt,
        quickReview: { ...response.receipt.quickReview, annualProjection: [] },
      },
    }, premiumMessage)).toThrow('FORESIGHT_RESPONSE_INVALID')
    expect(() => parseForesightExecutionResponse({
      ...response,
      receipt: {
        ...response.receipt,
        quickReview: {
          ...response.receipt.quickReview,
          summary: { ...response.receipt.quickReview.summary, modalPremium: null },
        },
      },
    }, premiumMessage)).toThrow('FORESIGHT_RESPONSE_INVALID')
  })
})
