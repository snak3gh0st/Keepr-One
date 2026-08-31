"use server";

import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import type { ApplicationStatus } from '@prisma/client'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { canAccessCase } from '@/lib/case-access'
import { computeNeedsAnalysis, type NeedsAnalysisInput } from '@/lib/needs-analysis'
import { revalidatePath } from 'next/cache'
import {
  CrmDomainError,
  cancelFollowUp as cancelCrmFollowUp,
  completeFollowUp as completeCrmFollowUp,
  advanceCaseCrmToSystemStage,
  rescheduleFollowUp as rescheduleCrmFollowUp,
  scheduleFollowUp as scheduleCrmFollowUp,
  parseCrmLocalDateTime,
} from '@/lib/crm'
import { saveApplicationDossier, reviewApplicationDossier } from '@/lib/application-addon/dossier-service'
import { prismaApplicationDossierRepository } from '@/lib/application-addon/dossier-prisma'
import { getKBotApplicationEntitlement } from '@/lib/application-addon/entitlement-prisma'
import type { ApplicationDossierMissingItem } from '@/lib/application-addon/dossier-contract'
import { validateApplicationDocument } from '@/lib/application-addon/document-service'
import { planApplicationDraftCommand } from '@/lib/application-addon/command-plan'
import {
  approveConnectorCommand,
  issueConnectorCommand,
  prismaConnectorCommandRepository,
} from '@/lib/national-life/connector-command-service'
import { isNationalLifeLocalConnectorEnabled } from '@/lib/national-life/local-connector/config'
import { getServerI18n } from '@/lib/i18n/server'

type ActionResult = { ok: true } | { ok: false; message: string }
type FailureResult = { ok: false; message: string }

export type ApplicationDossierActionResult =
  | { ok: true; ready: boolean; missing: ApplicationDossierMissingItem[]; dossierHash?: string }
  | { ok: false; message: string }

async function agentScopeIds(): Promise<{ agentId: string; scope: string[] }> {
  const agent = await getCurrentAgent()
  return { agentId: agent.id, scope: await getAgentScopeIds(agent.id) }
}

async function localizedMessage(portuguese: string, english: string) {
  const { copy } = await getServerI18n()
  return copy(portuguese, english)
}

async function actionError(portuguese: string, english: string): Promise<FailureResult> {
  return { ok: false, message: await localizedMessage(portuguese, english) }
}

async function crmActionError(error: unknown): Promise<ActionResult> {
  if (error instanceof CrmDomainError) {
    const englishByCode: Partial<Record<CrmDomainError['code'], string>> = {
      ACCESS_DENIED: 'This case is outside your portfolio.',
      CASE_NOT_FOUND: 'Case not found or outside your portfolio.',
      FOLLOW_UP_ALREADY_SCHEDULED: 'This lead already has a scheduled follow-up. Reschedule the current one.',
      FOLLOW_UP_NOT_FOUND: 'Follow-up not found or outside your portfolio.',
      FOLLOW_UP_NOT_SCHEDULED: 'Only pending follow-ups can be changed.',
      VALIDATION_ERROR: 'Review the follow-up information and try again.',
    }
    return { ok: false, message: await localizedMessage(error.message, englishByCode[error.code] ?? 'The action could not be completed.') }
  }
  console.error('CRM follow-up action error', error)
  return actionError('Não foi possível concluir a ação. Tente novamente.', 'The action could not be completed. Try again.')
}

function parseCrmWallClock(value: string) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('invalid')
    return parseCrmLocalDateTime(value)
  } catch {
    throw new CrmDomainError('VALIDATION_ERROR', 'Data ou horário de follow-up inválido.')
  }
}

function revalidateCrmFollowUp(caseId: string) {
  revalidatePath(`/agent/cases/${caseId}`)
  revalidatePath('/agent/cases')
  revalidatePath('/agent')
  revalidatePath('/agent/activities')
}

export async function scheduleCaseFollowUp(input: {
  caseId: string; title: string; scheduledAt: string
}): Promise<ActionResult> {
  try {
    const { scope } = await agentScopeIds()
    const agent = await getCurrentAgent()
    await scheduleCrmFollowUp({
      caseId: input.caseId, title: input.title,
      scheduledAt: parseCrmWallClock(input.scheduledAt),
      actorUserId: agent.userId, scopeAgentIds: scope,
    })
    revalidateCrmFollowUp(input.caseId)
    return { ok: true }
  } catch (error) {
    return crmActionError(error)
  }
}

export async function rescheduleCaseFollowUp(input: {
  caseId: string; followUpId: string; title: string; scheduledAt: string
}): Promise<ActionResult> {
  try {
    const { scope } = await agentScopeIds()
    const agent = await getCurrentAgent()
    await rescheduleCrmFollowUp({
      followUpId: input.followUpId, title: input.title,
      scheduledAt: parseCrmWallClock(input.scheduledAt),
      actorUserId: agent.userId, scopeAgentIds: scope,
    })
    revalidateCrmFollowUp(input.caseId)
    return { ok: true }
  } catch (error) {
    return crmActionError(error)
  }
}

export async function completeCaseFollowUp(input: {
  caseId: string; followUpId: string
}): Promise<ActionResult> {
  try {
    const { scope } = await agentScopeIds()
    const agent = await getCurrentAgent()
    await completeCrmFollowUp({ followUpId: input.followUpId, actorUserId: agent.userId, scopeAgentIds: scope })
    revalidateCrmFollowUp(input.caseId)
    return { ok: true }
  } catch (error) {
    return crmActionError(error)
  }
}

export async function cancelCaseFollowUp(input: {
  caseId: string; followUpId: string
}): Promise<ActionResult> {
  try {
    const { scope } = await agentScopeIds()
    const agent = await getCurrentAgent()
    await cancelCrmFollowUp({ followUpId: input.followUpId, actorUserId: agent.userId, scopeAgentIds: scope })
    revalidateCrmFollowUp(input.caseId)
    return { ok: true }
  } catch (error) {
    return crmActionError(error)
  }
}

// Standard life-application document checklist. These are Keepr One-owned tracking
// items, not carrier-authoritative requirements — when a vendor feed is wired,
// its requirements sync in via provider/externalId alongside these.
const STANDARD_REQUIREMENTS = [
  'Formulário de aplicação assinado',
  'Documento de identidade',
  'Exame médico / paramédico',
  'Autorização HIPAA',
  'Comprovante de pagamento inicial',
]

// An application is "active" until it terminates. Only one active application
// per case — a declined/withdrawn one can be superseded by a fresh start.
const ACTIVE_APPLICATION: ApplicationStatus[] = ['DRAFT', 'STARTED', 'SUBMITTED', 'UNDERWRITING', 'APPROVED', 'ISSUED']

type LockedInsuranceCase = {
  id: string
  assignedAgentId: string
}

export async function startApplication(caseId: string): Promise<ActionResult> {
  const { scope } = await agentScopeIds()
  const agent = await getCurrentAgent()

  const result = await prisma.$transaction(async (tx): Promise<ActionResult> => {
    // Serialize application starts for this case. The active-application check
    // must happen after this row lock; otherwise two simultaneous requests can
    // both observe an empty application list and create duplicates.
    const [insuranceCase] = await tx.$queryRaw<LockedInsuranceCase[]>`
      SELECT "id", "assignedAgentId"
      FROM "InsuranceCase"
      WHERE "id" = ${caseId}
      FOR UPDATE
    `

    if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
      return actionError('Caso não encontrado ou fora da sua carteira.', 'Case not found or outside your portfolio.')
    }

    const activeApplication = await tx.application.findFirst({
      where: { caseId, status: { in: ACTIVE_APPLICATION } },
      select: { id: true },
    })
    if (activeApplication) {
      return actionError('Já existe uma aplicação em andamento para este caso.', 'An application is already in progress for this case.')
    }

    await tx.application.create({
      data: {
        caseId,
        status: 'STARTED',
        requirements: { create: STANDARD_REQUIREMENTS.map((title) => ({ title })) },
      },
    })
    await tx.caseTimelineEvent.create({
      data: {
        caseId,
        type: 'APPLICATION_STARTED',
        title: 'Aplicação iniciada',
        body: `Checklist padrão criado com ${STANDARD_REQUIREMENTS.length} requirements.`,
      },
    })
    await advanceCaseCrmToSystemStage(tx, {
      caseId,
      systemKey: 'APPLICATION',
      actorUserId: agent.userId,
    })

    return { ok: true }
  })

  if (!result.ok) return result

  revalidatePath(`/agent/cases/${caseId}`)
  revalidatePath('/agent/cases')
  revalidatePath('/agent')
  revalidatePath('/agent/activities')
  return result
}

export async function saveKBotApplicationDossier(
  applicationId: string,
  dossier: unknown,
): Promise<ApplicationDossierActionResult> {
  try {
    const agent = await getCurrentAgent()
    const reviewedDocuments = await prisma.applicationDocument.findMany({
      where: {
        applicationId,
        reviewedAt: { not: null },
        application: { insuranceCase: { assignedAgentId: agent.id } },
      },
      select: { id: true, type: true, contentHash: true },
    })
    const safeDossier = dossier && typeof dossier === 'object' && !Array.isArray(dossier)
      ? {
          ...(dossier as Record<string, unknown>),
          documents: reviewedDocuments.map((document) => ({
            documentId: document.id,
            type: document.type,
            contentHash: document.contentHash,
          })),
        }
      : dossier
    const result = await saveApplicationDossier(prismaApplicationDossierRepository, {
      applicationId,
      agentId: agent.id,
      dossier: safeDossier,
    })
    const application = await prisma.application.findFirst({
      where: { id: applicationId, insuranceCase: { assignedAgentId: agent.id } },
      select: { caseId: true },
    })
    if (application) revalidatePath(`/agent/cases/${application.caseId}`)
    return { ok: true, ready: result.readiness.ready, missing: result.readiness.missing }
  } catch (error) {
    console.error('K_BOT_APPLICATION_DOSSIER_SAVE_FAILED', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return actionError('Não foi possível salvar estas informações agora.', 'This information could not be saved right now.')
  }
}

export async function uploadKBotApplicationDocument(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const type = String(formData.get('type') ?? '')
  const file = formData.get('file')
  if (!(file instanceof File)) return actionError('Escolha um documento.', 'Choose a document.')
  const agent = await getCurrentAgent()
  const application = await prisma.application.findFirst({
    where: { id: applicationId, insuranceCase: { assignedAgentId: agent.id } },
    select: { id: true, caseId: true },
  })
  if (!application) return actionError('Aplicação não encontrada.', 'Application not found.')

  let temporaryPath: string | null = null
  let finalPath: string | null = null
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const validated = validateApplicationDocument({
      type,
      filename: file.name,
      mimeType: file.type,
      bytes,
    })
    const documentId = `appdoc_${randomUUID()}`
    const storageKey = join('applications', agent.id, application.id, `${documentId}-${validated.filename}`)
    const uploadsDir = process.env.UPLOADS_DIR?.trim() || './uploads'
    finalPath = join(uploadsDir, storageKey)
    temporaryPath = `${finalPath}.uploading`
    await mkdir(join(uploadsDir, 'applications', agent.id, application.id), { recursive: true })
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporaryPath, finalPath)
    temporaryPath = null
    await prisma.$transaction([
      prisma.applicationDocument.create({
        data: {
          id: documentId,
          applicationId: application.id,
          type: validated.type,
          filename: validated.filename,
          storedPath: storageKey,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          contentHash: validated.contentHash,
          uploadedByUserId: agent.userId,
        },
      }),
      prisma.application.update({
        where: { id: application.id },
        data: {
          automationState: 'COLLECTING',
          dossierHash: null,
          reviewedAt: null,
          reviewedByUserId: null,
          consentedAt: null,
        },
      }),
    ])
    revalidatePath(`/agent/cases/${application.caseId}`)
    return { ok: true }
  } catch (error) {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    if (finalPath) await unlink(finalPath).catch(() => undefined)
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    const message = code === 'APPLICATION_DOCUMENT_TOO_LARGE'
      ? await localizedMessage('O documento deve ter no máximo 10 MB.', 'The document must be no larger than 10 MB.')
      : code === 'APPLICATION_DOCUMENT_TYPE_NOT_ALLOWED'
        ? await localizedMessage('Envie um PDF, PNG ou JPG.', 'Upload a PDF, PNG, or JPG.')
        : await localizedMessage('Não foi possível salvar o documento agora.', 'The document could not be saved right now.')
    return { ok: false, message }
  }
}

export async function reviewKBotApplicationDocument(documentId: string): Promise<ActionResult> {
  const agent = await getCurrentAgent()
  const document = await prisma.applicationDocument.findFirst({
    where: {
      id: documentId,
      application: { insuranceCase: { assignedAgentId: agent.id } },
    },
    select: { id: true, applicationId: true, application: { select: { caseId: true } } },
  })
  if (!document) return actionError('Documento não encontrado.', 'Document not found.')
  const now = new Date()
  await prisma.$transaction([
    prisma.applicationDocument.update({
      where: { id: document.id },
      data: { reviewedAt: now, reviewedByUserId: agent.userId },
    }),
    prisma.application.update({
      where: { id: document.applicationId },
      data: {
        automationState: 'COLLECTING',
        dossierHash: null,
        reviewedAt: null,
        reviewedByUserId: null,
        consentedAt: null,
      },
    }),
  ])
  const refreshed = await prisma.application.findFirst({
    where: { id: document.applicationId, insuranceCase: { assignedAgentId: agent.id } },
    select: {
      dossier: true,
      documents: {
        where: { reviewedAt: { not: null } },
        select: { id: true, type: true, contentHash: true },
      },
    },
  })
  if (refreshed?.dossier && typeof refreshed.dossier === 'object' && !Array.isArray(refreshed.dossier)) {
    await saveApplicationDossier(prismaApplicationDossierRepository, {
      applicationId: document.applicationId,
      agentId: agent.id,
      dossier: {
        ...(refreshed.dossier as Record<string, unknown>),
        documents: refreshed.documents.map((item) => ({
          documentId: item.id,
          type: item.type,
          contentHash: item.contentHash,
        })),
      },
    })
  }
  revalidatePath(`/agent/cases/${document.application.caseId}`)
  return { ok: true }
}

export async function reviewKBotApplicationDossier(
  applicationId: string,
): Promise<ApplicationDossierActionResult> {
  try {
    const agent = await getCurrentAgent()
    const entitlement = await getKBotApplicationEntitlement(agent.id)
    const reviewed = await reviewApplicationDossier(prismaApplicationDossierRepository, {
      applicationId,
      agentId: agent.id,
      userId: agent.userId,
      entitled: entitlement.entitled,
    })
    const application = await prisma.application.findFirst({
      where: { id: applicationId, insuranceCase: { assignedAgentId: agent.id } },
      select: { caseId: true },
    })
    if (application) revalidatePath(`/agent/cases/${application.caseId}`)
    return { ok: true, ready: true, missing: [], dossierHash: reviewed.dossierHash }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    const message = code === 'K_BOT_APPLICATION_ADDON_REQUIRED'
      ? await localizedMessage('Ative o add-on K-Bot Application para preparar este caso no iGO.', 'Activate the K-Bot Application add-on to prepare this case in iGO.')
      : code === 'APPLICATION_DOSSIER_INCOMPLETE'
        ? await localizedMessage('Complete as informações obrigatórias antes de revisar.', 'Complete the required information before reviewing.')
        : await localizedMessage('Não foi possível concluir a revisão agora.', 'The review could not be completed right now.')
    return { ok: false, message }
  }
}

export async function prepareKBotApplicationDraft(
  applicationId: string,
): Promise<ActionResult> {
  if (!isNationalLifeLocalConnectorEnabled()) {
    return actionError('Conecte o K-Bot neste navegador para preparar a Application.', 'Connect K-Bot in this browser to prepare the Application.')
  }
  const agent = await getCurrentAgent()
  try {
    const [entitlement, application] = await Promise.all([
      getKBotApplicationEntitlement(agent.id),
      prisma.application.findFirst({
        where: { id: applicationId, insuranceCase: { assignedAgentId: agent.id } },
        select: {
          id: true,
          caseId: true,
          automationState: true,
          dossierHash: true,
          reviewedAt: true,
          externalId: true,
          carrierReceipt: true,
        },
      }),
    ])
    if (!application) return actionError('Aplicação não encontrada.', 'Application not found.')

    const commandInput = planApplicationDraftCommand(application, {
      agentId: agent.id,
      entitled: entitlement.entitled,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })
    const issued = await issueConnectorCommand(prismaConnectorCommandRepository, commandInput)
    const moved = await prisma.application.updateMany({
      where: {
        id: application.id,
        insuranceCase: { assignedAgentId: agent.id },
        automationState: 'READY_TO_PREPARE',
        dossierHash: application.dossierHash,
      },
      data: { automationState: 'PREPARING_DRAFT', safeErrorCode: null },
    })
    if (moved.count !== 1) throw new Error('APPLICATION_STATE_CHANGED')

    await approveConnectorCommand(prismaConnectorCommandRepository, {
      agentId: agent.id,
      commandId: issued.command.commandId,
      payloadHash: issued.payloadHash,
      confirmedByUserId: agent.userId,
    })
    revalidatePath(`/agent/cases/${application.caseId}`)
    return { ok: true }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    console.error('K_BOT_APPLICATION_PREPARE_FAILED', { code, applicationId })
    await prisma.application.updateMany({
      where: {
        id: applicationId,
        insuranceCase: { assignedAgentId: agent.id },
        automationState: 'PREPARING_DRAFT',
      },
      data: { automationState: 'READY_TO_PREPARE', safeErrorCode: code.slice(0, 80) },
    })
    const message = code === 'K_BOT_APPLICATION_ADDON_REQUIRED'
      ? await localizedMessage('Ative o add-on K-Bot Application antes de preparar no iGO.', 'Activate the K-Bot Application add-on before preparing in iGO.')
      : code === 'APPLICATION_NOT_REVIEWED' || code === 'APPLICATION_NOT_READY'
        ? await localizedMessage('Revise novamente as informações antes de preparar no iGO.', 'Review the information again before preparing it in iGO.')
        : await localizedMessage('Não foi possível iniciar a preparação no iGO agora.', 'Preparation in iGO could not be started right now.')
    return { ok: false, message }
  }
}

export async function addCaseNote(caseId: string, body: string): Promise<ActionResult> {
  const text = body.trim()
  if (!text) return actionError('A nota não pode ficar vazia.', 'The note cannot be empty.')
  if (text.length > 2000) return actionError('Nota muito longa (máx. 2000 caracteres).', 'The note is too long (maximum 2,000 characters).')

  const { scope } = await agentScopeIds()
  const insuranceCase = await prisma.insuranceCase.findUnique({
    where: { id: caseId },
    select: { id: true, assignedAgentId: true },
  })
  if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
    return actionError('Caso não encontrado ou fora da sua carteira.', 'Case not found or outside your portfolio.')
  }

  await prisma.caseTimelineEvent.create({
    data: { caseId, type: 'NOTE', title: 'Nota', body: text },
  })
  revalidatePath(`/agent/cases/${caseId}`)
  return { ok: true }
}

const NEEDS_FIELDS: (keyof NeedsAnalysisInput)[] = [
  'annualIncome', 'incomeYears', 'mortgageBalance', 'otherDebts', 'finalExpenses',
  'children', 'educationPerChild', 'existingCoverage', 'liquidAssets',
]

export async function saveNeedsAnalysis(
  caseId: string,
  raw: Record<string, number>,
): Promise<ActionResult> {
  const { scope } = await agentScopeIds()

  const insuranceCase = await prisma.insuranceCase.findUnique({
    where: { id: caseId },
    select: { id: true, assignedAgentId: true },
  })
  if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
    return actionError('Caso não encontrado ou fora da sua carteira.', 'Case not found or outside your portfolio.')
  }

  // Coerce every field to a finite number; the calc itself floors negatives.
  const input = Object.fromEntries(
    NEEDS_FIELDS.map((f) => [f, Number(raw[f]) || 0]),
  ) as unknown as NeedsAnalysisInput
  const result = computeNeedsAnalysis(input)

  await prisma.$transaction([
    prisma.insuranceCase.update({
      where: { id: caseId },
      data: {
        needsAnalysis: { input, result, savedAt: new Date().toISOString() },
        targetCoverage: result.recommendedCoverage,
      },
    }),
    prisma.caseTimelineEvent.create({
      data: {
        caseId,
        type: 'NEEDS_ANALYSIS',
        title: 'Needs analysis atualizada',
        body: `Cobertura recomendada: $${result.recommendedCoverage.toLocaleString('en-US')}.`,
      },
    }),
  ])

  revalidatePath(`/agent/cases/${caseId}`)
  return { ok: true }
}

const REQUIREMENT_STATUSES = ['OPEN', 'RECEIVED', 'WAIVED'] as const
type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number]

export async function updateRequirement(requirementId: string, status: RequirementStatus): Promise<ActionResult> {
  if (!REQUIREMENT_STATUSES.includes(status)) {
    return actionError('Status de pendência inválido.', 'Invalid pending item status.')
  }

  const { scope } = await agentScopeIds()

  const requirement = await prisma.applicationRequirement.findUnique({
    where: { id: requirementId },
    select: { id: true, application: { select: { caseId: true, insuranceCase: { select: { assignedAgentId: true } } } } },
  })
  if (!requirement || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, requirement.application.insuranceCase)) {
    return actionError('Pendência não encontrada ou fora da sua carteira.', 'Pending item not found or outside your portfolio.')
  }

  await prisma.applicationRequirement.update({
    where: { id: requirementId },
    data: {
      status,
      receivedAt: status === 'RECEIVED' ? new Date() : null,
    },
  })

  revalidatePath(`/agent/cases/${requirement.application.caseId}`)
  return { ok: true }
}
