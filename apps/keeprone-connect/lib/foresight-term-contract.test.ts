import { describe, expect, it } from 'vitest'
import {
  parseForesightTermIllustrationSnapshot,
  sha256ForesightTermSnapshot,
} from './foresight-term-contract'

const snapshot = {
  schemaVersion: 1,
  illustrationId: 'ill_term_123',
  caseId: 'case_123',
  carrierCaseName: 'KEEPRONE-20260827-ILLTERM123',
  product: { carrierName: 'LSW Term', kind: 'TERM' },
  insured: { firstName: 'KeeprOne', lastName: 'Smoke', dateOfBirth: '1990-01-01', issueState: 'FL' },
  underwriting: { gender: 'Male', rateClass: 'Standard_NT' },
  faceAmount: 250_000,
  premiumMode: 'Monthly',
  termDuration: '20-G',
  reports: ['NAIC_ILLUSTRATION'],
} as const

describe('Foresight Term snapshot', () => {
  it('accepts only the sealed carrier, duration and carrier-calculated premium mode', async () => {
    expect(parseForesightTermIllustrationSnapshot(snapshot)).toEqual(snapshot)
    expect(parseForesightTermIllustrationSnapshot({ ...snapshot, termDuration: '25-G' })).toBeNull()
    expect(parseForesightTermIllustrationSnapshot({ ...snapshot, premiumMode: 'Annual' })).toBeNull()
    expect(parseForesightTermIllustrationSnapshot({ ...snapshot, product: { carrierName: 'Term', kind: 'TERM' } })).toBeNull()

    const hash = await sha256ForesightTermSnapshot(snapshot)
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    await expect(sha256ForesightTermSnapshot({ ...snapshot, faceAmount: 300_000 })).resolves.not.toBe(hash)
  })
})
