import { describe, expect, it } from 'vitest'
import { toNationalLifePromotionPaymentEvidence } from './promotion-payment-evidence'

const validRow = {
  PolicyNumber: ' ls 1473219 ',
  CompensationType: 'First year Compensation',
  TransactionType: 'Standard',
  PaymentDate: '08/25/2026',
  WritingAgtNumber: ' 12-345 ',
  IncomeClass: 'Life',
  ProductType: 'Indexed Universal Life',
  InsuredName: 'Private Client',
}

describe('National Life promotion payment evidence', () => {
  it('maps a standard first-year Life earning and canonicalizes its identifiers', () => {
    const evidence = toNationalLifePromotionPaymentEvidence(validRow)

    expect(evidence).toEqual({
      policyNumber: 'LS1473219',
      writingAgentNumber: '12345',
      paymentDate: new Date('2026-08-25T00:00:00.000Z'),
      paymentDateRaw: '08/25/2026',
      compensationType: 'First year Compensation',
      transactionType: 'Standard',
      incomeClass: 'Life',
      productType: 'Indexed Universal Life',
      lifeEvidenceField: 'IncomeClass',
    })
  })

  it('accepts a persisted NationalLifeReportRow and can prove Life through ProductType', () => {
    const evidence = toNationalLifePromotionPaymentEvidence({
      id: 'report-row-1',
      raw: {
        ...validRow,
        CompensationType: '  FIRST-YEAR   compensation ',
        TransactionType: ' standard ',
        IncomeClass: 'Other',
        ProductType: ' life ',
      },
      amounts: { GrossCommEarned: '$100.00' },
    })

    expect(evidence).toMatchObject({
      compensationType: 'First year Compensation',
      transactionType: 'Standard',
      incomeClass: 'Other',
      productType: 'life',
      lifeEvidenceField: 'ProductType',
    })
  })

  it('does not return the raw row or incidental PII', () => {
    const evidence = toNationalLifePromotionPaymentEvidence(validRow)

    expect(evidence).not.toHaveProperty('raw')
    expect(JSON.stringify(evidence)).not.toContain('Private Client')
  })

  it.each([
    ['renewal', { CompensationType: 'Renewal Compensation' }],
    ['abbreviated first year', { CompensationType: 'FYC' }],
    ['excess', { TransactionType: 'Excess' }],
    ['missing Life classification', { IncomeClass: 'Annuity', ProductType: 'Annuity' }],
  ])('rejects %s rows', (_label, override) => {
    expect(toNationalLifePromotionPaymentEvidence({ ...validRow, ...override })).toBeNull()
  })

  it.each(['02/29/2025', '13/01/2026', '2026-02-30', 'August 25, 2026', ''])
    ('rejects an invalid or ambiguous PaymentDate: %s', (PaymentDate) => {
      expect(toNationalLifePromotionPaymentEvidence({ ...validRow, PaymentDate })).toBeNull()
    })

  it('accepts a valid ISO date-only value without timezone drift', () => {
    const evidence = toNationalLifePromotionPaymentEvidence({
      ...validRow,
      PaymentDate: '2026-08-25',
    })

    expect(evidence?.paymentDate.toISOString()).toBe('2026-08-25T00:00:00.000Z')
    expect(evidence?.paymentDateRaw).toBe('2026-08-25')
  })

  it.each([
    ['PolicyNumber', { PolicyNumber: '' }],
    ['WritingAgtNumber', { WritingAgtNumber: null }],
    ['CompensationType', { CompensationType: null }],
    ['TransactionType', { TransactionType: null }],
    ['PaymentDate', { PaymentDate: null }],
  ])('fails closed without %s', (_field, override) => {
    expect(toNationalLifePromotionPaymentEvidence({ ...validRow, ...override })).toBeNull()
  })

  it.each([null, undefined, [], 'not a row', { raw: null }])
    ('rejects a non-row payload', (value) => {
      expect(toNationalLifePromotionPaymentEvidence(value)).toBeNull()
    })
})
