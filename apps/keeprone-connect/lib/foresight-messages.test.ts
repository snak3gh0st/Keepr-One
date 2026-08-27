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
  })
})
