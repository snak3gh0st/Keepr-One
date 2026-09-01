"use server";

import { randomUUID } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '@/lib/prisma'
import { Prisma, type ApplicationStatus } from '@prisma/client'
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
  getOrCreateNewLeadStageId,
} from '@/lib/crm'
import { saveApplicationDossier, reviewApplicationDossier } from '@/lib/application-addon/dossier-service'
import { prismaApplicationDossierRepository } from '@/lib/application-addon/dossier-prisma'
import { getKBotApplicationEntitlement } from '@/lib/application-addon/entitlement-prisma'
import type { ApplicationDossierMissingItemV2 } from '@/lib/application-addon/dossier-contract'
import { resolveApplicationIllustrationLink } from '@/lib/application-addon/illustration-link'
import { validateApplicationDocument } from '@/lib/application-addon/document-service'
import { planApplicationDraftCommand } from '@/lib/application-addon/command-plan'
import {
  approveConnectorCommand,
  issueConnectorCommand,
  prismaConnectorCommandRepository,
} from '@/lib/national-life/connector-command-service'
import { isNationalLifeLocalConnectorEnabled } from '@/lib/national-life/local-connector/config'
import {
  ApplicationFromIllustrationError,
  buildApplicationFromIllustrationSeed,
} from '@/lib/application-addon/application-from-illustration'

type ActionResult = { ok: true } | { ok: false; message: string }

export type ApplicationDossierActionResult =
  | { ok: true; ready: boolean; missing: ApplicationDossierMissingItemV2[]; dossierHash?: string }
  | { ok: false; message: string }

export type StartApplicationFromIllustrationResult =
  | { ok: true; caseId: string; applicationId: string }
  | { ok: false; message: string }

async function agentScopeIds(): Promise<{ agentId: string; scope: string[] }> {
  const agent = await getCurrentAgent()
  return { agentId: agent.id, scope: await getAgentScopeIds(agent.id) }
}

function crmActionError(error: unknown): ActionResult {
  if (error instanceof CrmDomainError) return { ok: false, message: error.message }
  console.error('CRM follow-up action error', error)
  return { ok: false, message: 'Não foi possível concluir a ação. Tente novamente.' }
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

export async function startApplicationFromIllustration(
  illustrationId: string,
): Promise<StartApplicationFromIllustrationResult> {
  const agent = await getCurrentAgent()

  try {
    const result = await prisma.$transaction(async (tx): Promise<StartApplicationFromIllustrationResult> => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`application-from-illustration:${illustrationId}`}, 0))::text AS lock_result`
      const illustration = await tx.illustration.findFirst({
        where: { id: illustrationId, agentId: agent.id },
        select: {
          id: true,
          caseId: true,
          clientId: true,
          createdAt: true,
          productName: true,
          rawPayload: true,
          faceAmount: true,
          premium: true,
          documentFetchedAt: true,
          documentMimeType: true,
          documentBytes: true,
        },
      })
      if (!illustration) return { ok: false, message: 'Illustration não encontrada.' }

      const caseId = illustration.caseId ?? `case_${randomUUID()}`
      const seed = buildApplicationFromIllustrationSeed({
        id: illustration.id,
        caseId: illustration.caseId,
        createdAt: illustration.createdAt,
        productName: illustration.productName,
        rawPayload: illustration.rawPayload,
        documentReady: Boolean(
          illustration.documentFetchedAt &&
          illustration.documentMimeType === 'application/pdf' &&
          illustration.documentBytes?.byteLength,
        ),
        faceAmount: illustration.faceAmount == null ? null : Number(illustration.faceAmount),
        premium: illustration.premium == null ? null : Number(illustration.premium),
      }, caseId)

      if (illustration.caseId) {
        const [lockedCase] = await tx.$queryRaw<LockedInsuranceCase[]>`
          SELECT "id", "assignedAgentId"
          FROM "InsuranceCase"
          WHERE "id" = ${caseId}
          FOR UPDATE
        `
        if (!lockedCase || lockedCase.assignedAgentId !== agent.id) {
          return { ok: false, message: 'O atendimento vinculado está fora da sua carteira.' }
        }
      } else {
        const crmStageId = await getOrCreateNewLeadStageId(tx, agent.id)
        const prospect = await tx.prospect.create({
          data: {
            firstName: seed.prospect.firstName,
            lastName: seed.prospect.lastName,
            dateOfBirth: seed.prospect.dateOfBirth,
            state: seed.prospect.state,
            tobaccoStatus: seed.prospect.tobaccoStatus,
            assignedAgentId: agent.id,
          },
          select: { id: true },
        })
        await tx.insuranceCase.create({
          data: {
            id: caseId,
            prospectId: prospect.id,
            assignedAgentId: agent.id,
            clientId: illustration.clientId,
            crmStageId,
            productType: seed.insuranceCase.productType,
            targetCoverage: seed.insuranceCase.targetCoverage,
            monthlyBudget: seed.insuranceCase.monthlyBudget,
            carrier: 'National Life Group',
          },
        })
        const attached = await tx.illustration.updateMany({
          where: { id: illustration.id, agentId: agent.id, caseId: null },
          data: { caseId },
        })
        if (attached.count !== 1) throw new Error('ILLUSTRATION_ATTACH_CONFLICT')
        await tx.caseTimelineEvent.create({
          data: {
            caseId,
            type: 'CASE_CREATED',
            title: 'Atendimento criado a partir da Illustration',
            body: 'Os dados confirmados na Illustration oficial iniciaram este atendimento.',
          },
        })
      }

      const activeApplication = await tx.application.findFirst({
        where: { caseId, status: { in: ACTIVE_APPLICATION } },
        select: { id: true, dossier: true },
      })
      if (activeApplication) {
        const dossier = activeApplication.dossier && typeof activeApplication.dossier === 'object' &&
          !Array.isArray(activeApplication.dossier)
          ? activeApplication.dossier as Record<string, unknown>
          : null
        const coverage = dossier?.coverage && typeof dossier.coverage === 'object' &&
          !Array.isArray(dossier.coverage)
          ? dossier.coverage as Record<string, unknown>
          : null
        if (coverage?.illustrationId === illustration.id) {
          return { ok: true, caseId, applicationId: activeApplication.id }
        }
        return {
          ok: false,
          message: 'Este atendimento já possui outra Application em andamento.',
        }
      }

      const application = await tx.application.create({
        data: {
          caseId,
          status: 'STARTED',
          intakeVersion: 2,
          dossier: seed.dossier as Prisma.InputJsonValue,
          requirements: { create: STANDARD_REQUIREMENTS.map((title) => ({ title })) },
        },
        select: { id: true },
      })
      await tx.caseTimelineEvent.create({
        data: {
          caseId,
          type: 'APPLICATION_STARTED',
          title: 'Application iniciada pela Illustration',
          body: 'Produto e valores oficiais foram vinculados ao dossiê da Application.',
        },
      })
      await advanceCaseCrmToSystemStage(tx, {
        caseId,
        systemKey: 'APPLICATION',
        actorUserId: agent.userId,
      })
      return { ok: true, caseId, applicationId: application.id }
    })

    if (result.ok) {
      revalidatePath(`/agent/illustrations/${illustrationId}`)
      revalidatePath('/agent/illustrations')
      revalidatePath(`/agent/cases/${result.caseId}`)
      revalidatePath('/agent/cases')
      revalidatePath('/agent')
    }
    return result
  } catch (error) {
    if (error instanceof ApplicationFromIllustrationError) {
      return {
        ok: false,
        message: error.code === 'ILLUSTRATION_NOT_OFFICIAL'
          ? 'Aguarde o PDF oficial da National Life antes de criar a Application.'
          : 'A Illustration oficial ainda não possui todos os valores confirmados.',
      }
    }
    console.error('APPLICATION_FROM_ILLUSTRATION_FAILED', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return { ok: false, message: 'Não foi possível criar a Application a partir desta Illustration.' }
  }
}

export async function saveKBotApplicationDossier(
  applicationId: string,
  dossier: unknown,
): Promise<ApplicationDossierActionResult> {
  try {
    const agent = await getCurrentAgent()
    const application = await prisma.application.findFirst({
      where: { id: applicationId, insuranceCase: { assignedAgentId: agent.id } },
      select: { caseId: true, dossier: true },
    })
    if (!application) throw new Error('APPLICATION_NOT_FOUND')
    const dossierRecord = dossier && typeof dossier === 'object' && !Array.isArray(dossier)
      ? dossier as Record<string, unknown> : null
    const coverageRecord = dossierRecord?.coverage && typeof dossierRecord.coverage === 'object' &&
      !Array.isArray(dossierRecord.coverage)
      ? dossierRecord.coverage as Record<string, unknown> : null
    const illustrationId = typeof coverageRecord?.illustrationId === 'string'
      ? coverageRecord.illustrationId : ''
    const existingDossier = application.dossier && typeof application.dossier === 'object' &&
      !Array.isArray(application.dossier)
      ? application.dossier as Record<string, unknown>
      : null
    const existingCoverage = existingDossier?.coverage && typeof existingDossier.coverage === 'object' &&
      !Array.isArray(existingDossier.coverage)
      ? existingDossier.coverage as Record<string, unknown>
      : null
    const linkedIllustrationId = typeof existingCoverage?.illustrationId === 'string'
      ? existingCoverage.illustrationId
      : ''
    if (linkedIllustrationId && illustrationId !== linkedIllustrationId) {
      throw new Error('APPLICATION_ILLUSTRATION_IMMUTABLE')
    }
    const [reviewedDocuments, illustration] = await Promise.all([
      prisma.applicationDocument.findMany({
        where: {
          applicationId,
          reviewedAt: { not: null },
          application: { insuranceCase: { assignedAgentId: agent.id } },
        },
        select: { id: true, type: true, contentHash: true },
      }),
      illustrationId ? prisma.illustration.findFirst({
        where: { id: illustrationId, caseId: application.caseId, agentId: agent.id },
        select: {
          id: true, caseId: true, createdAt: true, productName: true, rawPayload: true,
          faceAmount: true, premium: true,
        },
      }) : Promise.resolve(null),
    ])
    const illustrationLink = illustration && coverageRecord
      ? resolveApplicationIllustrationLink({
          ...illustration,
          faceAmount: illustration.faceAmount == null ? null : Number(illustration.faceAmount),
          premium: illustration.premium == null ? null : Number(illustration.premium),
        }, {
          expectedCaseId: application.caseId,
          family: coverageRecord.family === 'TERM' ? 'TERM' : 'IUL',
          carrierProduct: String(coverageRecord.carrierProduct ?? ''),
          ...(typeof coverageRecord.termDuration === 'string'
            ? { termDuration: coverageRecord.termDuration } : {}),
          issueState: String(coverageRecord.issueState ?? ''),
          ...(typeof coverageRecord.faceAmount === 'number' ? { faceAmount: coverageRecord.faceAmount } : {}),
          ...(typeof coverageRecord.plannedPremium === 'number'
            ? { plannedPremium: coverageRecord.plannedPremium } : {}),
          ...(coverageRecord.premiumMode === 'MONTHLY' || coverageRecord.premiumMode === 'ANNUAL'
            ? { premiumMode: coverageRecord.premiumMode } : {}),
        })
      : null
    if (illustrationId && !illustrationLink) throw new Error('APPLICATION_ILLUSTRATION_MISMATCH')
    const safeCoverage = coverageRecord
      ? Object.fromEntries(Object.entries(coverageRecord).filter(([key]) => key !== 'illustrationInputHash'))
      : coverageRecord
    const safeDossier = dossier && typeof dossier === 'object' && !Array.isArray(dossier)
      ? {
          ...(dossier as Record<string, unknown>),
          ...(safeCoverage ? { coverage: { ...safeCoverage, ...(illustrationLink ?? {}) } } : {}),
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
    revalidatePath(`/agent/cases/${application.caseId}`)
    return { ok: true, ready: result.readiness.ready, missing: result.readiness.missing }
  } catch (error) {
    console.error('K_BOT_APPLICATION_DOSSIER_SAVE_FAILED', {
      code: error instanceof Error ? error.message : 'UNKNOWN',
    })
    return { ok: false, message: 'Não foi possível salvar estas informações agora.' }
  }
}

export async function uploadKBotApplicationDocument(formData: FormData): Promise<ActionResult> {
  const applicationId = String(formData.get('applicationId') ?? '')
  const type = String(formData.get('type') ?? '')
  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, message: 'Escolha um documento.' }
  const agent = await getCurrentAgent()
  const application = await prisma.application.findFirst({
    where: { id: applicationId, insuranceCase: { assignedAgentId: agent.id } },
    select: { id: true, caseId: true },
  })
  if (!application) return { ok: false, message: 'Aplicação não encontrada.' }

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
      ? 'O documento deve ter no máximo 10 MB.'
      : code === 'APPLICATION_DOCUMENT_TYPE_NOT_ALLOWED'
        ? 'Envie um PDF, PNG ou JPG.'
        : 'Não foi possível salvar o documento agora.'
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
  if (!document) return { ok: false, message: 'Documento não encontrado.' }
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
      ? 'Ative o add-on K-Bot Application para preparar este caso no iGO.'
      : code === 'APPLICATION_DOSSIER_INCOMPLETE'
        ? 'Complete as informações obrigatórias antes de revisar.'
        : 'Não foi possível concluir a revisão agora.'
    return { ok: false, message }
  }
}

export async function prepareKBotApplicationDraft(
  applicationId: string,
): Promise<ActionResult> {
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: 'Conecte o K-Bot neste navegador para preparar a Application.' }
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
    if (!application) return { ok: false, message: 'Aplicação não encontrada.' }

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
      ? 'Ative o add-on K-Bot Application antes de preparar no iGO.'
      : code === 'APPLICATION_NOT_REVIEWED' || code === 'APPLICATION_NOT_READY'
        ? 'Revise novamente as informações antes de preparar no iGO.'
        : 'Não foi possível iniciar a preparação no iGO agora.'
    return { ok: false, message }
  }
}

export async function addCaseNote(caseId: string, body: string): Promise<ActionResult> {
  const text = body.trim()
  if (!text) return { ok: false, message: 'A nota não pode ficar vazia.' }
  if (text.length > 2000) return { ok: false, message: 'Nota muito longa (máx. 2000 caracteres).' }

  const { scope } = await agentScopeIds()
  const insuranceCase = await prisma.insuranceCase.findUnique({
    where: { id: caseId },
    select: { id: true, assignedAgentId: true },
  })
  if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
    return { ok: false, message: 'Caso não encontrado ou fora da sua carteira.' }
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
    return { ok: false, message: 'Caso não encontrado ou fora da sua carteira.' }
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
    return { ok: false, message: 'Status de requirement inválido.' }
  }

  const { scope } = await agentScopeIds()

  const requirement = await prisma.applicationRequirement.findUnique({
    where: { id: requirementId },
    select: { id: true, application: { select: { caseId: true, insuranceCase: { select: { assignedAgentId: true } } } } },
  })
  if (!requirement || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, requirement.application.insuranceCase)) {
    return { ok: false, message: 'Requirement não encontrado ou fora da sua carteira.' }
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
