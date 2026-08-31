import { describe, expect, it } from 'vitest'
import { parseIgoApplicationSnapshot } from './igo-contract'

const base = {
  schemaVersion: 2,
  applicationId: 'application_1',
  payloadHash: 'a'.repeat(64),
  dossier: {
    version: 2,
    insured: {
      firstName: 'Alex',
      lastName: 'Test',
      birthDate: '1990-01-01',
      sexAtBirth: 'MALE',
      email: 'alex@example.com',
      phone: '+13055550123',
    },
    address: {
      line1: '100 Main St',
      city: 'Miami',
      state: 'FL',
      postalCode: '33101',
    },
    owner: { sameAsInsured: true, relationship: 'SELF' },
    beneficiaries: [
      { fullName: 'Taylor Test', relationship: 'SPOUSE', sharePercent: 100 },
    ],
    coverage: {
      family: 'IUL',
      carrierProduct: 'FlexLife (25)(LSW)',
      issueState: 'FL',
      applicationType: 'FULL',
      illustrationId: 'illustration_1',
      illustrationInputHash: 'b'.repeat(64),
      faceAmount: 500_000,
      premiumMode: 'MONTHLY',
      plannedPremium: 300,
    },
    agent: { carrierNumber: 'AGENT123' },
    existingCoverage: { hasExisting: false, replacementExpected: false },
    documents: [
      { documentId: 'doc_1', type: 'IDENTITY', contentHash: 'c'.repeat(64) },
    ],
    consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
  },
} as const

describe('iGO Application execution contract', () => {
  it('accepts one exact IUL carrier product linked to the reviewed Illustration', () => {
    expect(parseIgoApplicationSnapshot(base)).toEqual(base)
  })

  it('accepts Term only when carrier product and duration agree', () => {
    const term = {
      ...base,
      dossier: {
        ...base.dossier,
        coverage: {
          ...base.dossier.coverage,
          family: 'TERM',
          carrierProduct: 'NL 20-G',
          termDuration: '20-G',
        },
      },
    } as const
    expect(parseIgoApplicationSnapshot(term)).toEqual(term)
    expect(parseIgoApplicationSnapshot({
      ...term,
      dossier: {
        ...term.dossier,
        coverage: { ...term.dossier.coverage, termDuration: '30-G' },
      },
    })).toBeNull()
  })

  it('rejects generic family-only coverage and an IUL term duration', () => {
    expect(parseIgoApplicationSnapshot({
      ...base,
      dossier: {
        ...base.dossier,
        coverage: {
          family: 'TERM',
          faceAmount: 500_000,
          premiumMode: 'MONTHLY',
          plannedPremium: 300,
        },
      },
    })).toBeNull()
    expect(parseIgoApplicationSnapshot({
      ...base,
      dossier: {
        ...base.dossier,
        coverage: { ...base.dossier.coverage, termDuration: '20-G' },
      },
    })).toBeNull()
  })

  it('rejects missing or invalid DOB before any age-dependent iGO screen', () => {
    expect(parseIgoApplicationSnapshot({
      ...base,
      dossier: {
        ...base.dossier,
        insured: { ...base.dossier.insured, birthDate: '' },
      },
    })).toBeNull()
    expect(parseIgoApplicationSnapshot({
      ...base,
      dossier: {
        ...base.dossier,
        insured: { ...base.dossier.insured, birthDate: '02/31/1990' },
      },
    })).toBeNull()
  })

  it('rejects missing state, agent number, or reviewed Illustration identity', () => {
    for (const coverage of [
      { ...base.dossier.coverage, issueState: '' },
      { ...base.dossier.coverage, illustrationId: '' },
      { ...base.dossier.coverage, illustrationInputHash: '' },
    ]) {
      expect(parseIgoApplicationSnapshot({
        ...base,
        dossier: { ...base.dossier, coverage },
      })).toBeNull()
    }
    expect(parseIgoApplicationSnapshot({
      ...base,
      dossier: { ...base.dossier, agent: { carrierNumber: '' } },
    })).toBeNull()
  })
})
