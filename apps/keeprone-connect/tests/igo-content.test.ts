import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('../lib/igo-executor', async () => {
  const actual = await vi.importActual<typeof import('../lib/igo-executor')>('../lib/igo-executor')
  return { ...actual, executeIgoApplicationDraft: mocks.execute }
})

type Listener = (value: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | void
let listener: Listener | undefined

const snapshot = {
  schemaVersion: 2,
  applicationId: 'application_1',
  payloadHash: 'a'.repeat(64),
  dossier: {
    version: 2,
    insured: { firstName: 'Alex', lastName: 'Test', birthDate: '1990-01-01', sexAtBirth: 'MALE', email: 'alex@example.com', phone: '+13055550123' },
    address: { line1: '100 Main St', city: 'Miami', state: 'FL', postalCode: '33101' },
    owner: { sameAsInsured: true, relationship: 'SELF' },
    beneficiaries: [{ fullName: 'Taylor Test', relationship: 'SPOUSE', sharePercent: 100 }],
    coverage: { family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL', applicationType: 'FULL', illustrationId: 'illustration_1', illustrationInputHash: 'b'.repeat(64), faceAmount: 500_000, premiumMode: 'MONTHLY', plannedPremium: 300 },
    agent: { carrierNumber: 'AGENT123' },
    existingCoverage: { hasExisting: false, replacementExpected: false },
    documents: [{ documentId: 'doc_1', type: 'IDENTITY', contentHash: 'c'.repeat(64) }],
    consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
  },
} as const

beforeEach(() => {
  vi.resetModules()
  mocks.execute.mockReset()
  listener = undefined
  const fakeWindow = {}
  vi.stubGlobal('window', fakeWindow)
  Object.assign(fakeWindow, { top: fakeWindow })
  vi.stubGlobal('location', {
    origin: 'https://igoforms2.ipipeline.com',
    pathname: '/CossEnterpriseSuite/session/WebForms/CaseListResp.aspx',
  })
  vi.stubGlobal('defineContentScript', (config: unknown) => config)
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (value: Listener) => { listener = value } } },
  })
})

describe('iGO isolated-world executor', () => {
  it('returns only the correlated draft receipt and never exposes a submit operation', async () => {
    const receipt = {
      schemaVersion: 2,
      applicationId: 'application_1', payloadHash: 'a'.repeat(64), draftReadBackHash: 'd'.repeat(64),
      externalApplicationId: 'case-1', carrierStatus: 'Started', progress: 'CASE_CREATED',
      confirmedValues: { insuredName: 'Alex Test', birthDate: '1990-01-01', family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL' },
      changes: [],
      missingQuestions: [{ section: 'Pre-Qualification', label: 'Do any of these conditions apply?', allowedValues: ['Yes', 'No'] }],
    } as const
    mocks.execute.mockResolvedValue(receipt)
    const content = (await import('../entrypoints/igo.content')).default as unknown as { main(): void }
    content.main()
    const response = await new Promise<unknown>((resolve) => {
      const async = listener?.({
        type: 'EXECUTE_IGO_APPLICATION_DRAFT', token: 't'.repeat(64), correlationId: 'correlation-id-1',
        payloadHash: snapshot.payloadHash, snapshot,
      }, {}, resolve)
      expect(async).toBe(true)
    })
    expect(mocks.execute).toHaveBeenCalledWith({ payloadHash: snapshot.payloadHash, snapshot })
    expect(response).toEqual({
      ok: true,
      type: 'IGO_APPLICATION_DRAFT_SAVED',
      token: 't'.repeat(64),
      correlationId: 'correlation-id-1',
      receipt,
    })
    expect(JSON.stringify(response)).not.toContain('SUBMIT_APPLICATION')
  })
})
