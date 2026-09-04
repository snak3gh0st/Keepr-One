import { describe, expect, it } from 'vitest'
import { PolicyRowSchema, CommissionRowSchema } from './schemas'

describe('PolicyRowSchema', () => {
  it('accepts a valid row and coerces numeric/date fields', () => {
    const result = PolicyRowSchema.safeParse({
      clientName: 'Cliente Exemplo',
      clientEmail: 'cliente@example.com',
      agentNpn: '1000003',
      carrier: 'National Life Group',
      product: 'Term 20',
      policyNumber: 'NLG-0002',
      faceAmount: '250000',
      premium: '45.50',
      status: 'INFORCE',
      effectiveDate: '2026-01-15',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.faceAmount).toBe(250000)
      expect(result.data.premium).toBe(45.5)
    }
  })

  it('rejects a row missing policyNumber', () => {
    const result = PolicyRowSchema.safeParse({
      clientName: 'Cliente Exemplo',
      agentNpn: '1000003',
      carrier: 'National Life Group',
      product: 'Term 20',
      faceAmount: '250000',
      premium: '45.50',
      status: 'INFORCE',
    })
    expect(result.success).toBe(false)
  })

  it('accepts an optional lastPaymentDate', () => {
    const result = PolicyRowSchema.safeParse({
      clientName: 'Cliente Exemplo',
      agentNpn: '1000003',
      carrier: 'National Life Group',
      product: 'Term 20',
      policyNumber: 'NLG-0002',
      faceAmount: '250000',
      premium: '45.50',
      status: 'INFORCE',
      lastPaymentDate: '2026-06-01',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.lastPaymentDate).toBe('2026-06-01')
    }
  })

  it('accepts a row with no lastPaymentDate at all', () => {
    const result = PolicyRowSchema.safeParse({
      clientName: 'Cliente Exemplo',
      agentNpn: '1000003',
      carrier: 'National Life Group',
      product: 'Term 20',
      policyNumber: 'NLG-0002',
      faceAmount: '250000',
      premium: '45.50',
      status: 'INFORCE',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.lastPaymentDate).toBeUndefined()
    }
  })
})

describe('CommissionRowSchema', () => {
  it('accepts a valid row', () => {
    const result = CommissionRowSchema.safeParse({
      policyNumber: 'NLG-0002',
      agentNpn: '1000003',
      amount: '45.50',
      period: '2026-01',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a non-numeric amount', () => {
    const result = CommissionRowSchema.safeParse({
      policyNumber: 'NLG-0002',
      agentNpn: '1000003',
      amount: 'not-a-number',
      period: '2026-01',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty string amount', () => {
    const result = CommissionRowSchema.safeParse({
      policyNumber: 'NLG-0002',
      agentNpn: '1000003',
      amount: '',
      period: '2026-01',
    })
    expect(result.success).toBe(false)
  })

  it('rejects Infinity as amount', () => {
    const result = CommissionRowSchema.safeParse({
      policyNumber: 'NLG-0002',
      agentNpn: '1000003',
      amount: 'Infinity',
      period: '2026-01',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a provider-sourced row with a chargeback transaction type', () => {
    const result = CommissionRowSchema.safeParse({
      policyNumber: 'NLG-0002',
      agentNpn: '1000003',
      amount: '45.50',
      period: '2026-01',
      transactionType: 'CHARGEBACK',
      sourceProvider: 'NATIONAL_LIFE',
      sourceTransactionId: 'EVT-42',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.transactionType).toBe('CHARGEBACK')
      expect(result.data.sourceTransactionId).toBe('EVT-42')
    }
  })

  it('rejects an unknown transaction type at the row level', () => {
    const result = CommissionRowSchema.safeParse({
      policyNumber: 'NLG-0002',
      agentNpn: '1000003',
      amount: '45.50',
      period: '2026-01',
      transactionType: 'BONUS',
    })
    expect(result.success).toBe(false)
  })
})

describe('PolicyRowSchema provenance columns', () => {
  it('still parses a row with no provenance columns', () => {
    const result = PolicyRowSchema.safeParse({
      clientName: 'Cliente Exemplo',
      agentNpn: '1000003',
      carrier: 'National Life Group',
      product: 'Term 20',
      policyNumber: 'NLG-0002',
      faceAmount: '250000',
      premium: '45.50',
      status: 'INFORCE',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sourceProvider).toBeUndefined()
    }
  })

  it('captures optional source provider identifiers', () => {
    const result = PolicyRowSchema.safeParse({
      clientName: 'Cliente Exemplo',
      agentNpn: '1000003',
      carrier: 'National Life Group',
      product: 'Term 20',
      policyNumber: 'NLG-0002',
      faceAmount: '250000',
      premium: '45.50',
      status: 'INFORCE',
      sourceProvider: 'NATIONAL_LIFE',
      sourceExternalId: 'POL-NLG-0002',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sourceProvider).toBe('NATIONAL_LIFE')
      expect(result.data.sourceExternalId).toBe('POL-NLG-0002')
    }
  })
})

describe('business calendar validation', () => {
  it.each(['2026-00', '2026-13'])('rejects invalid period %s', (period) => {
    expect(CommissionRowSchema.safeParse({ policyNumber: 'P', agentNpn: '123', amount: '100', period }).success).toBe(false)
  })
  it.each(['not-a-date', '2026-02-29', '2026-04-31', '2026-13-01'])('rejects invalid policy date %s', (effectiveDate) => {
    expect(PolicyRowSchema.safeParse({ clientName: 'Test', agentNpn: '123', carrier: 'C', product: 'P', policyNumber: 'P', faceAmount: '100', premium: '10', status: 'INFORCE', effectiveDate }).success).toBe(false)
  })
})
