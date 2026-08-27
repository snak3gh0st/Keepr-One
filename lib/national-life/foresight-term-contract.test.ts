import { describe, expect, it } from 'vitest'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
  parseForesightTermIllustrationReceipt,
} from './foresight-term-contract'

const source = {
  id: 'ill_term_1',
  caseId: null,
  createdAt: new Date('2026-08-27T16:00:00.000Z'),
  productName: 'LSW Term',
  rawPayload: {
    foresightTermDraft: {
      schemaVersion: 1,
      carrierProduct: 'LSW Term',
      firstName: 'KeeprOne',
      lastName: 'Term',
      dateOfBirth: '1981-08-26',
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'Standard_NT',
      faceAmount: 250000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
    },
  },
}

describe('Foresight Term illustration contract', () => {
  it('seals a carrier-specific Term request without an agent-supplied premium', () => {
    expect(buildForesightTermIllustrationSnapshot(source)).toEqual({
      schemaVersion: 1,
      illustrationId: 'ill_term_1',
      caseId: null,
      carrierCaseName: 'KEEPRONE-20260827-ILLTERM1',
      product: { carrierName: 'LSW Term', kind: 'TERM' },
      insured: {
        firstName: 'KeeprOne',
        lastName: 'Term',
        dateOfBirth: '1981-08-26',
        issueState: 'FL',
      },
      underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
      faceAmount: 250000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
      reports: ['NAIC_ILLUSTRATION'],
    })
  })

  it('changes the approved input hash when the Term duration changes', () => {
    const first = buildForesightTermIllustrationSnapshot(source)
    const changed = buildForesightTermIllustrationSnapshot({
      ...source,
      rawPayload: {
        foresightTermDraft: { ...source.rawPayload.foresightTermDraft, termDuration: '30-G' },
      },
    })

    expect(foresightTermIllustrationInputHash(first)).not.toBe(foresightTermIllustrationInputHash(changed))
  })

  it('accepts a Term receipt only when the named carrier and official PDF are exact', () => {
    const receipt = {
      inputHash: 'a'.repeat(64),
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName: 'KEEPRONE-20260827-ILLTERM123',
      carrierProduct: 'LSW Term',
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: 'c'.repeat(64),
      documentBytes: 1500,
      saved: true,
    }
    expect(parseForesightTermIllustrationReceipt(receipt)).toEqual(receipt)
    expect(parseForesightTermIllustrationReceipt({ ...receipt, carrierProduct: 'Term' })).toBeNull()
    expect(parseForesightTermIllustrationReceipt({ ...receipt, extra: true })).toBeNull()
  })
})
