import { describe, expect, it } from 'vitest'
import {
  applicationDossierReadiness,
  applicationDossierReadinessV2,
  parseApplicationDossier,
  parseApplicationDossierV2,
  parseApplicationDossierDraft,
  parseApplicationDossierDraftV2,
  sha256ApplicationDossierV2,
  sha256ApplicationDossier,
} from './dossier-contract'

const completeDossier = {
  version: 1,
  insured: {
    firstName: 'Alex',
    lastName: 'Teste',
    birthDate: '1998-08-27',
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
    { fullName: 'Taylor Teste', relationship: 'SPOUSE', sharePercent: 100 },
  ],
  coverage: {
    product: 'IUL',
    faceAmount: 500_000,
    premiumMode: 'MONTHLY',
    plannedPremium: 300,
  },
  existingCoverage: { hasExisting: false, replacementExpected: false },
  documents: [
    { documentId: 'doc_1', type: 'IDENTITY', contentHash: 'a'.repeat(64) },
  ],
  consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
} as const

const completeDossierV2 = {
  ...completeDossier,
  version: 2,
  coverage: {
    family: 'TERM',
    carrierProduct: 'NL 20-G',
    termDuration: '20-G',
    issueState: 'FL',
    applicationType: 'FULL',
    illustrationId: 'illustration_1',
    illustrationInputHash: 'b'.repeat(64),
    faceAmount: 500_000,
    premiumMode: 'MONTHLY',
    plannedPremium: 300,
  },
  agent: { carrierNumber: 'AGENT123' },
} as const

describe('application dossier contract', () => {
  it('accepts a bounded complete dossier and reports it ready', () => {
    const dossier = parseApplicationDossier(completeDossier)
    expect(applicationDossierReadiness(dossier)).toEqual({ ready: true, missing: [] })
  })

  it('requires beneficiary shares to total exactly 100', () => {
    const dossier = parseApplicationDossier({
      ...completeDossier,
      beneficiaries: [{ ...completeDossier.beneficiaries[0], sharePercent: 60 }],
    })
    expect(applicationDossierReadiness(dossier)).toEqual({
      ready: false,
      missing: ['BENEFICIARY_SHARES'],
    })
  })

  it('accepts a progressive draft and names its missing sections', () => {
    const draft = parseApplicationDossierDraft({
      version: 1,
      insured: { firstName: 'Alex', lastName: 'Teste' },
      coverage: { product: 'TERM' },
    })
    const readiness = applicationDossierReadiness(draft)
    expect(readiness.ready).toBe(false)
    expect(readiness.missing).toEqual(expect.arrayContaining([
      'INSURED_BIRTH_DATE',
      'INSURED_CONTACT',
      'ADDRESS',
      'OWNER',
      'BENEFICIARIES',
      'COVERAGE_VALUES',
    ]))
  })

  it('requires owner identity when the owner is not the insured', () => {
    const dossier = parseApplicationDossier({
      ...completeDossier,
      owner: { sameAsInsured: false, relationship: 'BUSINESS' },
    })
    expect(applicationDossierReadiness(dossier).missing).toContain('OWNER_NAME')
  })

  it('requires reviewed identity evidence and both consents', () => {
    const dossier = parseApplicationDossier({
      ...completeDossier,
      documents: [],
      consent: { clientAuthorizedCollection: false, agentAttestedAccuracy: false },
    })
    expect(applicationDossierReadiness(dossier).missing).toEqual([
      'IDENTITY_DOCUMENT',
      'CLIENT_AUTHORIZATION',
      'AGENT_ATTESTATION',
    ])
  })

  it('produces the same hash for semantically identical key order', () => {
    const dossier = parseApplicationDossier(completeDossier)
    const reordered = parseApplicationDossier(JSON.parse(JSON.stringify(completeDossier)))
    expect(sha256ApplicationDossier(dossier)).toBe(sha256ApplicationDossier(reordered))
  })

  it('rejects carrier-unsafe free-form and malformed values', () => {
    expect(() => parseApplicationDossier({
      ...completeDossier,
      insured: { ...completeDossier.insured, birthDate: '08/27/1998' },
    })).toThrow()
    expect(() => parseApplicationDossier({
      ...completeDossier,
      coverage: { ...completeDossier.coverage, faceAmount: -1 },
    })).toThrow()
  })

  it('requires an exact Term carrier product, matching duration, state, agent, and Illustration', () => {
    expect(parseApplicationDossierV2(completeDossierV2)).toEqual(completeDossierV2)
    expect(() => parseApplicationDossierV2({
      ...completeDossierV2,
      coverage: { ...completeDossierV2.coverage, termDuration: '30-G' },
    })).toThrow()
    expect(() => parseApplicationDossierV2({
      ...completeDossierV2,
      coverage: { product: 'TERM', faceAmount: 500_000, premiumMode: 'MONTHLY', plannedPremium: 300 },
    })).toThrow()
  })

  it('requires an exact IUL product and rejects Term duration on IUL', () => {
    const iul = {
      ...completeDossierV2,
      coverage: {
        ...completeDossierV2.coverage,
        family: 'IUL',
        carrierProduct: 'FlexLife (25)(LSW)',
        termDuration: undefined,
      },
    }
    delete iul.coverage.termDuration
    expect(parseApplicationDossierV2(iul)).toEqual(iul)
    expect(() => parseApplicationDossierV2({
      ...iul,
      coverage: { ...iul.coverage, termDuration: '20-G' },
    })).toThrow()
  })

  it('hashes the exact carrier execution target', () => {
    const hash = sha256ApplicationDossierV2(parseApplicationDossierV2(completeDossierV2))
    const changed = sha256ApplicationDossierV2(parseApplicationDossierV2({
      ...completeDossierV2,
      coverage: { ...completeDossierV2.coverage, carrierProduct: 'NL 30-G', termDuration: '30-G' },
    }))
    expect(changed).not.toBe(hash)
  })

  it('keeps product target gaps visible while collecting a v2 draft', () => {
    const draft = parseApplicationDossierDraftV2({
      version: 2,
      insured: { firstName: 'Alex', lastName: 'Test' },
      coverage: { family: 'TERM' },
    })
    expect(applicationDossierReadinessV2(draft)).toEqual(expect.objectContaining({
      ready: false,
      missing: expect.arrayContaining([
        'INSURED_BIRTH_DATE',
        'CARRIER_PRODUCT',
        'TERM_DURATION',
        'ISSUE_STATE',
        'ILLUSTRATION_LINK',
        'AGENT_NUMBER',
      ]),
    }))
  })
})
