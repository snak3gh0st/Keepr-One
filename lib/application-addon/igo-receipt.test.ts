import { describe, expect, it } from 'vitest'
import { parseIgoApplicationDraftReceipt } from './igo-receipt'

describe('iGO Application draft receipt', () => {
  it('accepts a bounded provider read-back and unanswered questions', () => {
    expect(parseIgoApplicationDraftReceipt({
      schemaVersion: 2,
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft',
      progress: 'APPLICATION_PARTIAL',
      confirmedValues: {
        insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'IUL',
        carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL',
        applicationType: 'FULL', agentNumber: 'AGENT123', illustrationId: 'illustration_1',
        faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY',
      },
      changes: [],
      missingQuestions: [{ section: 'Medical', label: 'Has the client used tobacco?' }],
    })).toMatchObject({ externalApplicationId: 'IGO-123' })
  })

  it('rejects arbitrary fields and invalid hashes', () => {
    expect(parseIgoApplicationDraftReceipt({
      schemaVersion: 2,
      applicationId: 'app_1', payloadHash: 'not-a-hash', draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', progress: 'DRAFT_READY', confirmedValues: { insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL', applicationType: 'FULL', agentNumber: 'AGENT123', illustrationId: 'illustration_1', faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY' }, changes: [], missingQuestions: [],
    })).toBeNull()
    expect(parseIgoApplicationDraftReceipt({
      schemaVersion: 2,
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', progress: 'DRAFT_READY', confirmedValues: { insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL', applicationType: 'FULL', agentNumber: 'AGENT123', illustrationId: 'illustration_1', faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY' }, changes: [], missingQuestions: [],
      injected: true,
    })).toBeNull()
  })

  it('rejects a Term read-back whose exact product and duration disagree', () => {
    expect(parseIgoApplicationDraftReceipt({
      schemaVersion: 2,
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', progress: 'DRAFT_READY',
      confirmedValues: { insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'TERM', carrierProduct: 'NL 20-G', termDuration: '30-G', issueState: 'FL', applicationType: 'FULL', agentNumber: 'AGENT123', illustrationId: 'illustration_1', faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY' },
      changes: [], missingQuestions: [],
    })).toBeNull()
  })

  it('accepts an honest case-created receipt while iGO waits for user answers', () => {
    expect(parseIgoApplicationDraftReceipt({
      schemaVersion: 2,
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: '480ff6ea-ce9d-4409-a124-d8f99ba6d2b3', carrierStatus: 'Started',
      progress: 'CASE_CREATED',
      confirmedValues: {
        insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'IUL',
        carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL',
      },
      changes: [],
      missingQuestions: [{
        section: 'Pre-Qualification',
        label: 'Do any of these conditions apply?',
        allowedValues: ['Yes', 'No'],
      }],
    })).toMatchObject({ progress: 'CASE_CREATED' })
  })

  it('rejects a receipt that claims DRAFT_READY before carrier read-back is complete', () => {
    expect(parseIgoApplicationDraftReceipt({
      schemaVersion: 2,
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', progress: 'DRAFT_READY',
      confirmedValues: {
        insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'IUL',
        carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL',
      },
      changes: [], missingQuestions: [],
    })).toBeNull()
  })
})
