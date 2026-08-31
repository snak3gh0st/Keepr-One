import { describe, expect, it } from 'vitest'
import {
  parseExecuteIgoApplicationDraftMessage,
  parseIgoApplicationDraftResponse,
} from './igo-messages'

const snapshot = {
  schemaVersion: 2,
  applicationId: 'application_1',
  payloadHash: 'a'.repeat(64),
  dossier: {
    version: 2,
    insured: {
      firstName: 'Alex', lastName: 'Test', birthDate: '1990-01-01', sexAtBirth: 'MALE',
      email: 'alex@example.com', phone: '+13055550123',
    },
    address: { line1: '100 Main St', city: 'Miami', state: 'FL', postalCode: '33101' },
    owner: { sameAsInsured: true, relationship: 'SELF' },
    beneficiaries: [{ fullName: 'Taylor Test', relationship: 'SPOUSE', sharePercent: 100 }],
    coverage: {
      family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL',
      applicationType: 'FULL', illustrationId: 'illustration_1',
      illustrationInputHash: 'b'.repeat(64), faceAmount: 500_000,
      premiumMode: 'MONTHLY', plannedPremium: 300,
    },
    agent: { carrierNumber: 'AGENT123' },
    existingCoverage: { hasExisting: false, replacementExpected: false },
    documents: [{ documentId: 'doc_1', type: 'IDENTITY', contentHash: 'c'.repeat(64) }],
    consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
  },
} as const

const message = {
  type: 'EXECUTE_IGO_APPLICATION_DRAFT',
  token: 't'.repeat(64),
  correlationId: 'correlation-id-1',
  payloadHash: 'a'.repeat(64),
  snapshot,
} as const

describe('iGO Application content messages', () => {
  it('accepts only an exact sealed execution message', () => {
    expect(parseExecuteIgoApplicationDraftMessage(message)).toEqual(message)
    expect(parseExecuteIgoApplicationDraftMessage({
      ...message,
      payloadHash: 'b'.repeat(64),
    })).toBeNull()
    expect(parseExecuteIgoApplicationDraftMessage({ ...message, submit: true })).toBeNull()
  })

  it('accepts a case-created receipt with explicit missing questions', () => {
    const receipt = {
      schemaVersion: 2,
      applicationId: 'application_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'd'.repeat(64),
      externalApplicationId: '480ff6ea-ce9d-4409-a124-d8f99ba6d2b3', carrierStatus: 'Started',
      progress: 'CASE_CREATED',
      confirmedValues: {
        insuredName: 'Alex Test', birthDate: '1990-01-01', family: 'IUL',
        carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL',
      },
      changes: [],
      missingQuestions: [{
        section: 'Pre-Qualification', label: 'Do any of these conditions apply?',
        allowedValues: ['Yes', 'No'],
      }],
    } as const
    expect(parseIgoApplicationDraftResponse({
      ok: true,
      type: 'IGO_APPLICATION_DRAFT_SAVED',
      token: message.token,
      correlationId: message.correlationId,
      receipt,
    }, message)).toMatchObject({ ok: true, receipt: { progress: 'CASE_CREATED' } })
  })

  it('rejects a mismatched response and allows only bounded fail-closed codes', () => {
    expect(() => parseIgoApplicationDraftResponse({
      ok: false,
      type: 'IGO_APPLICATION_DRAFT_FAILED',
      token: message.token,
      correlationId: 'another-correlation',
      code: 'IGO_SCHEMA_MISMATCH',
    }, message)).toThrow('IGO_RESPONSE_INVALID')
    expect(parseIgoApplicationDraftResponse({
      ok: false,
      type: 'IGO_APPLICATION_DRAFT_FAILED',
      token: message.token,
      correlationId: message.correlationId,
      code: 'IGO_SCHEMA_MISMATCH',
    }, message)).toMatchObject({ ok: false, code: 'IGO_SCHEMA_MISMATCH' })
  })
})
