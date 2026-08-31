import { describe, expect, it } from 'vitest'
import { parseIgoApplicationDraftReceipt } from './igo-receipt'

describe('iGO Application draft receipt', () => {
  it('accepts a bounded provider read-back and unanswered questions', () => {
    expect(parseIgoApplicationDraftReceipt({
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft',
      confirmedValues: { insuredName: 'Keepr Test', birthDate: '1990-01-01', product: 'IUL', faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY' },
      changes: [],
      missingQuestions: [{ section: 'Medical', label: 'Has the client used tobacco?' }],
    })).toMatchObject({ externalApplicationId: 'IGO-123' })
  })

  it('rejects arbitrary fields and invalid hashes', () => {
    expect(parseIgoApplicationDraftReceipt({
      applicationId: 'app_1', payloadHash: 'not-a-hash', draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', confirmedValues: { insuredName: 'Keepr Test', birthDate: '1990-01-01', product: 'IUL', faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY' }, changes: [], missingQuestions: [],
    })).toBeNull()
    expect(parseIgoApplicationDraftReceipt({
      applicationId: 'app_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', confirmedValues: { insuredName: 'Keepr Test', birthDate: '1990-01-01', product: 'IUL', faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY' }, changes: [], missingQuestions: [],
      injected: true,
    })).toBeNull()
  })
})
