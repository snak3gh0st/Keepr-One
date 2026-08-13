"use server";

import { prisma } from '@/lib/prisma'
import type { ApplicationStatus } from '@prisma/client'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
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

type ActionResult = { ok: true } | { ok: false; message: string }

async function agentScopeIds(): Promise<{ agentId: string; scope: string[] }> {
  const agent = await getCurrentAgent()
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  return { agentId: agent.id, scope: [agent.id, ...getDownlineIds(allAgents, agent.id)] }
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
      return { ok: false, message: 'Caso não encontrado ou fora da sua carteira.' }
    }

    const activeApplication = await tx.application.findFirst({
      where: { caseId, status: { in: ACTIVE_APPLICATION } },
      select: { id: true },
    })
    if (activeApplication) {
      return { ok: false, message: 'Já existe uma aplicação em andamento para este caso.' }
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
