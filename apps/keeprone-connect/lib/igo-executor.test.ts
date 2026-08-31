// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  findIgoCaseRow,
  igoApplicationStages,
  igoBirthDateSegments,
  igoDraftMarker,
  igoMissingQuestions,
  igoProductTypeValue,
} from './igo-executor'
import type { IgoApplicationSnapshotV2 } from './igo-contract'

const snapshot = {
  schemaVersion: 2,
  applicationId: 'application_1',
  payloadHash: 'a'.repeat(64),
  dossier: {
    version: 2,
    insured: {
      firstName: 'Alex', lastName: 'Test', birthDate: '1990-01-09', sexAtBirth: 'MALE',
      email: 'alex@example.com', phone: '+13055550123',
    },
    address: { line1: '100 Main St', city: 'Miami', state: 'FL', postalCode: '33101' },
    owner: { sameAsInsured: true, relationship: 'SELF' },
    beneficiaries: [{ fullName: 'Taylor Test', relationship: 'SPOUSE', sharePercent: 100 }],
    coverage: {
      family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL',
      applicationType: 'FULL', illustrationId: 'illustration_1',
      illustrationInputHash: 'b'.repeat(64), faceAmount: 500_000,
      premiumMode: 'MONTHLY', plannedPremium: 300,
    },
    agent: { carrierNumber: 'AGENT123' },
    existingCoverage: { hasExisting: false, replacementExpected: false },
    documents: [{ documentId: 'doc_1', type: 'IDENTITY', contentHash: 'c'.repeat(64) }],
    consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
  },
} as const satisfies IgoApplicationSnapshotV2

describe('iGO Application draft executor targeting', () => {
  it('uses a deterministic non-submission marker and exact product family', () => {
    expect(igoDraftMarker(snapshot.applicationId)).toBe('K-BOT DRAFT APPLICATION_1 - DO NOT SUBMIT')
    expect(igoProductTypeValue(snapshot)).toBe('74,10')
    expect(igoProductTypeValue({
      ...snapshot,
      dossier: {
        ...snapshot.dossier,
        coverage: {
          ...snapshot.dossier.coverage,
          family: 'TERM', carrierProduct: 'NL 20-G', termDuration: '20-G',
        },
      },
    })).toBe('1,10')
    expect(igoBirthDateSegments('1990-01-09')).toEqual({ month: '01', day: '09', year: '1990' })
  })

  it('reuses one exact carrier row and refuses an ambiguous duplicate marker', () => {
    const marker = igoDraftMarker(snapshot.applicationId)
    document.body.innerHTML = `<table><tbody>
      <tr data-case-id="case-1"><td><h4><a class="open-client">Test, Alex</a></h4><span>${marker}</span></td><td><span class="case-status">Started</span></td><td><span>FlexLife (25)(LSW)</span></td></tr>
      <tr data-case-id="case-2"><td><h4><a class="open-client">Other, Person</a></h4><span>Another draft</span></td><td><span class="case-status">Started</span></td><td><span>NL 20-G</span></td></tr>
    </tbody></table>`
    expect(findIgoCaseRow(document, snapshot)).toMatchObject({ externalApplicationId: 'case-1', status: 'Started' })

    document.querySelector('tbody')!.insertAdjacentHTML('beforeend', `
      <tr data-case-id="case-3"><td><h4><a class="open-client">Test, Alex</a></h4><span>${marker}</span></td><td><span class="case-status">Started</span></td><td><span>FlexLife (25)(LSW)</span></td></tr>`)
    expect(() => findIgoCaseRow(document, snapshot)).toThrow('IGO_CASE_AMBIGUOUS')
  })

  it('surfaces subjective and identity questions instead of guessing answers', () => {
    const questions = igoMissingQuestions(snapshot)
    expect(questions).toContainEqual(expect.objectContaining({
      section: 'Pre-Qualification', label: 'Do any of these conditions apply?',
    }))
    expect(questions).toContainEqual(expect.objectContaining({
      section: 'Agent Information', label: 'Confirm the exact iGO Agent Number; do not infer or guess it',
    }))
    expect(questions).toContainEqual(expect.objectContaining({
      section: 'Primary Insured', label: 'SSN, ITIN, or None selection and identification number when applicable',
    }))
    expect(questions).toContainEqual(expect.objectContaining({
      section: 'Premium', label: 'Billing type, payment frequency, and planned modal premium',
    }))
    expect(questions).toContainEqual(expect.objectContaining({
      section: 'Notice and Consent - PI', label: 'Review the Notice and Consent; physician or provider contact is optional',
    }))
  })

  it('maps every observed draft stage and keeps Validate and Lock as a hard boundary', () => {
    const iulStages = igoApplicationStages('IUL')
    const termStages = igoApplicationStages('TERM')

    expect(iulStages.map((stage) => stage.section)).toEqual([
      'Pre-Qualification',
      'Agent Report',
      'Agent Report, Cont',
      'Agent Information',
      'Primary Insured',
      'Beneficiaries - PI',
      'Coverage Information',
      'Premium',
      'Existing Ins - PI',
      'Notice and Consent - PI',
      'Part 1 Validate And Lock Data',
    ])
    expect(iulStages.find((stage) => stage.section === 'Coverage Information')).toMatchObject({
      screenId: 'screen_button_NLG_Screens_CoverageInfo',
      mode: 'DRAFT',
    })
    expect(termStages.find((stage) => stage.section === 'Coverage Information')).toMatchObject({
      screenId: 'screen_button_NLG_Screens_CoverageInfoTL',
      mode: 'DRAFT',
    })
    expect(iulStages.at(-1)).toEqual({
      section: 'Part 1 Validate And Lock Data',
      screenId: 'screen_button_NLG_Screens_eSignHIPAA',
      mode: 'LOCK_BOUNDARY',
    })
    expect(termStages.at(-1)).toEqual(iulStages.at(-1))
  })
})
