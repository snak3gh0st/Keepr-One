import { describe, expect, it } from 'vitest'
import { toPolicyBookSummary } from './policy-book-summary'

const row = {
  policyNumber: '774945500',
  policyStatus: 'Active',
  productName: 'LSW Level Term 20-G',
  policyIssueDate: '05/01/2024',
  levelPeriodEndDate: '05/01/2044',
  termConversionDate: '05/01/2039',
  anticipatedAnnualPremium: '880',
  targetPremium: null,
  accumulatedCashValue: null,
  insuredClientName: 'FLAVIA DEABREU MOSCARDI',
  insuredEmail: null,
  insuredPhoneNumber: null,
  insuredAddressLine1: '123 Main St',
  insuredAddressLine2: 'Apt 4',
  insuredCity: 'Orlando',
  insuredState: 'FL',
  insuredZipcode: '32801',
  ownerClientName: 'FLAVIA DEABREU MOSCARDI',
  ownerEmail: 'flavia@example.com',
  ownerPhoneNumber: '+14075551234',
  ownerAddressLine1: null,
  ownerAddressLine2: null,
  ownerCity: null,
  ownerState: null,
  ownerZipcode: null,
  employerName: null,
  fetchedAt: new Date('2026-09-11T23:57:48.957Z'),
}

describe('toPolicyBookSummary', () => {
  it('devolve nulo sem linha da seguradora', () => {
    expect(toPolicyBookSummary(null)).toBeNull()
  })

  it('monta o que a grade da seguradora já entregou', () => {
    const summary = toPolicyBookSummary(row)!

    expect(summary.asOf).toBe('2026-09-11T23:57:48.957Z')
    expect(summary.policy).toMatchObject({
      status: 'Active',
      productName: 'LSW Level Term 20-G',
      issueDate: '05/01/2024',
      levelPeriodEndDate: '05/01/2044',
      termConversionDate: '05/01/2039',
    })
    expect(summary.money).toEqual({
      anticipatedAnnualPremium: '880',
      targetPremium: null,
      accumulatedCashValue: null,
    })
  })

  it('junta o endereço em uma linha e ignora as partes ausentes', () => {
    const summary = toPolicyBookSummary(row)!

    expect(summary.insured.address).toBe('123 Main St, Apt 4, Orlando, FL 32801')
    // O dono não tem endereço nenhum: uma linha vazia seria pior que a ausência.
    expect(summary.owner.address).toBeNull()
  })

  it('trata string vazia da seguradora como ausência', () => {
    const summary = toPolicyBookSummary({
      ...row,
      insuredEmail: '   ',
      productName: '',
      anticipatedAnnualPremium: '',
    })!

    expect(summary.insured.email).toBeNull()
    expect(summary.policy.productName).toBeNull()
    expect(summary.money.anticipatedAnnualPremium).toBeNull()
  })

  it('não inventa nada quando a grade só trouxe o número', () => {
    const summary = toPolicyBookSummary({ policyNumber: '1', fetchedAt: new Date('2026-09-01T00:00:00.000Z') })!

    expect(summary.hasAnything).toBe(false)
    expect(summary.insured.name).toBeNull()
    expect(summary.money.anticipatedAnnualPremium).toBeNull()
  })

  it('diz que tem conteúdo quando algum campo veio', () => {
    expect(toPolicyBookSummary(row)!.hasAnything).toBe(true)
  })
})
