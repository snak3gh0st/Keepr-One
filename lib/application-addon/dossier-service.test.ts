import { describe, expect, it, vi } from 'vitest'
import type { ApplicationDossierV2 } from './dossier-contract'
import { reviewApplicationDossier, saveApplicationDossier } from './dossier-service'

const dossier: ApplicationDossierV2 = {
  version: 2,
  insured: {
    firstName: 'Alex', lastName: 'Teste', birthDate: '1998-08-27', sexAtBirth: 'MALE',
    email: 'alex@example.com', phone: '+13055550123',
  },
  address: { line1: '100 Main St', city: 'Miami', state: 'FL', postalCode: '33101' },
  owner: { sameAsInsured: true, relationship: 'SELF' },
  beneficiaries: [{ fullName: 'Taylor Teste', relationship: 'SPOUSE', sharePercent: 100 }],
  coverage: {
    family: 'IUL', carrierProduct: 'FlexLife (25)(LSW)', issueState: 'FL',
    applicationType: 'FULL', illustrationId: 'illustration_1', illustrationInputHash: 'b'.repeat(64),
    faceAmount: 500_000, premiumMode: 'MONTHLY', plannedPremium: 300,
  },
  agent: { carrierNumber: 'AGENT123' },
  existingCoverage: { hasExisting: false, replacementExpected: false },
  documents: [{ documentId: 'doc_1', type: 'IDENTITY', contentHash: 'a'.repeat(64) }],
  consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
}

describe('Application dossier service', () => {
  it('saves a complete dossier ready for review and invalidates an older review', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const result = await saveApplicationDossier({ update }, {
      applicationId: 'app_1', agentId: 'agent_1', dossier,
    })
    expect(result.readiness.ready).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      applicationId: 'app_1', agentId: 'agent_1',
      automationState: 'READY_FOR_REVIEW',
      reviewedAt: null,
      reviewedByUserId: null,
    }))
  })

  it('keeps an incomplete dossier collecting', async () => {
    const update = vi.fn().mockResolvedValue(undefined)
    const result = await saveApplicationDossier({ update }, {
      applicationId: 'app_1', agentId: 'agent_1',
      dossier: { ...dossier, documents: [] },
    })
    expect(result.readiness.ready).toBe(false)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ automationState: 'COLLECTING' }))
  })

  it('reviews only an owned, complete dossier with the paid add-on', async () => {
    const updateReview = vi.fn().mockResolvedValue(undefined)
    const repository = {
      findOwned: vi.fn().mockResolvedValue({ id: 'app_1', dossier }),
      updateReview,
    }
    const result = await reviewApplicationDossier(repository, {
      applicationId: 'app_1', agentId: 'agent_1', userId: 'user_1',
      entitled: true, now: new Date('2026-08-30T12:00:00.000Z'),
    })
    expect(result.dossierHash).toMatch(/^[a-f0-9]{64}$/)
    expect(updateReview).toHaveBeenCalledWith(expect.objectContaining({
      automationState: 'READY_TO_PREPARE',
      reviewedByUserId: 'user_1',
      dossierHash: result.dossierHash,
    }))
  })

  it('fails closed without entitlement or ownership', async () => {
    await expect(reviewApplicationDossier({
      findOwned: vi.fn(), updateReview: vi.fn(),
    }, {
      applicationId: 'app_1', agentId: 'agent_1', userId: 'user_1', entitled: false,
    })).rejects.toThrow('K_BOT_APPLICATION_ADDON_REQUIRED')

    await expect(reviewApplicationDossier({
      findOwned: vi.fn().mockResolvedValue(null), updateReview: vi.fn(),
    }, {
      applicationId: 'app_1', agentId: 'agent_1', userId: 'user_1', entitled: true,
    })).rejects.toThrow('APPLICATION_NOT_FOUND')
  })
})
