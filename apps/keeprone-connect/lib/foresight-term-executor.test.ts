import { describe, expect, it } from 'vitest'
import { buildForesightTermClientTarget } from './foresight-term-executor'
import { parseForesightTermIllustrationSnapshot } from './foresight-term-contract'

describe('Foresight Term client target', () => {
  it('writes the birth date in the US format required by the Term form', () => {
    const snapshot = parseForesightTermIllustrationSnapshot({
      schemaVersion: 1,
      illustrationId: 'ill_term_1',
      caseId: null,
      carrierCaseName: 'KEEPRONE-TERM-1',
      product: { carrierName: 'LSW Term', kind: 'TERM' },
      insured: {
        firstName: 'Paulo',
        lastName: 'Loureiro Campos',
        dateOfBirth: '1988-06-02',
        issueState: 'FL',
      },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      faceAmount: 1_000_000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
      reports: ['NAIC_ILLUSTRATION'],
    })

    expect(snapshot).not.toBeNull()
    expect(buildForesightTermClientTarget(snapshot!)).toEqual({
      firstName: 'Paulo',
      lastName: 'Loureiro Campos',
      birthDate: '06/02/1988',
    })
  })
})
