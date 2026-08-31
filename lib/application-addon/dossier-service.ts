import {
  applicationDossierReadiness,
  parseApplicationDossier,
  parseApplicationDossierDraft,
  sha256ApplicationDossier,
  type ApplicationDossierDraftV1,
} from './dossier-contract'

type ApplicationAutomationState = 'COLLECTING' | 'READY_FOR_REVIEW' | 'READY_TO_PREPARE'

export type ApplicationDossierRepository = {
  update(input: {
    applicationId: string
    agentId: string
    intakeVersion: 1
    dossier: ApplicationDossierDraftV1
    automationState: ApplicationAutomationState
    reviewedAt: null
    reviewedByUserId: null
    consentedAt: null
    dossierHash: null
  }): Promise<void>
}

export type ApplicationDossierReviewRepository = {
  findOwned(input: { applicationId: string; agentId: string }): Promise<{
    id: string
    dossier: unknown
  } | null>
  updateReview(input: {
    applicationId: string
    agentId: string
    automationState: 'READY_TO_PREPARE'
    dossierHash: string
    reviewedAt: Date
    reviewedByUserId: string
    consentedAt: Date
  }): Promise<void>
}

export async function saveApplicationDossier(
  repository: ApplicationDossierRepository,
  input: { applicationId: string; agentId: string; dossier: unknown },
) {
  const dossier = parseApplicationDossierDraft(input.dossier)
  const readiness = applicationDossierReadiness(dossier)
  await repository.update({
    applicationId: input.applicationId,
    agentId: input.agentId,
    intakeVersion: 1,
    dossier,
    automationState: readiness.ready ? 'READY_FOR_REVIEW' : 'COLLECTING',
    reviewedAt: null,
    reviewedByUserId: null,
    consentedAt: null,
    dossierHash: null,
  })
  return { dossier, readiness }
}

export async function reviewApplicationDossier(
  repository: ApplicationDossierReviewRepository,
  input: {
    applicationId: string
    agentId: string
    userId: string
    entitled: boolean
    now?: Date
  },
) {
  if (!input.entitled) throw new Error('K_BOT_APPLICATION_ADDON_REQUIRED')
  const application = await repository.findOwned({
    applicationId: input.applicationId,
    agentId: input.agentId,
  })
  if (!application) throw new Error('APPLICATION_NOT_FOUND')
  const dossier = parseApplicationDossier(application.dossier)
  const readiness = applicationDossierReadiness(dossier)
  if (!readiness.ready) throw new Error('APPLICATION_DOSSIER_INCOMPLETE')
  const dossierHash = sha256ApplicationDossier(dossier)
  const now = input.now ?? new Date()
  await repository.updateReview({
    applicationId: input.applicationId,
    agentId: input.agentId,
    automationState: 'READY_TO_PREPARE',
    dossierHash,
    reviewedAt: now,
    reviewedByUserId: input.userId,
    consentedAt: now,
  })
  return { dossierHash, reviewedAt: now }
}
