"use server";

import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { getDownlineIds } from '@/lib/hierarchy'
import { canAccessCase } from '@/lib/case-access'
import { canTransitionCase, caseStageLabel, type CaseStage } from '@/lib/case-workflow'
import { computeNeedsAnalysis, type NeedsAnalysisInput } from '@/lib/needs-analysis'
import { revalidatePath } from 'next/cache'

type ActionResult = { ok: true } | { ok: false; message: string }

const TERMINAL: CaseStage[] = ['PLACED', 'DECLINED', 'WITHDRAWN']

async function agentScopeIds(): Promise<{ agentId: string; scope: string[] }> {
  const agent = await getCurrentAgent()
  const allAgents = await prisma.agent.findMany({ select: { id: true, parentAgentId: true } })
  return { agentId: agent.id, scope: [agent.id, ...getDownlineIds(allAgents, agent.id)] }
}

export async function transitionCase(caseId: string, nextStage: CaseStage): Promise<ActionResult> {
  const { scope } = await agentScopeIds()

  const insuranceCase = await prisma.insuranceCase.findUnique({
    where: { id: caseId },
    select: { id: true, stage: true, assignedAgentId: true },
  })
  if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
    return { ok: false, message: 'Caso não encontrado ou fora da sua carteira.' }
  }

  if (!canTransitionCase(insuranceCase.stage, nextStage)) {
    return { ok: false, message: 'Esta mudança de etapa não é permitida.' }
  }

  await prisma.$transaction([
    prisma.insuranceCase.update({
      where: { id: caseId },
      data: {
        stage: nextStage,
        status: TERMINAL.includes(nextStage) ? 'CLOSED' : 'OPEN',
      },
    }),
    prisma.caseTimelineEvent.create({
      data: {
        caseId,
        type: 'STAGE_CHANGED',
        title: `Etapa alterada para ${caseStageLabel[nextStage]}`,
        body: `De ${caseStageLabel[insuranceCase.stage]} para ${caseStageLabel[nextStage]}.`,
        // Structured from/to powers pipeline cycle-time analytics.
        metadata: { from: insuranceCase.stage, to: nextStage },
      },
    }),
  ])

  revalidatePath(`/agent/cases/${caseId}`)
  revalidatePath('/agent/cases')
  return { ok: true }
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
const ACTIVE_APPLICATION: string[] = ['DRAFT', 'STARTED', 'SUBMITTED', 'UNDERWRITING', 'APPROVED', 'ISSUED']

export async function startApplication(caseId: string): Promise<ActionResult> {
  const { scope } = await agentScopeIds()

  const insuranceCase = await prisma.insuranceCase.findUnique({
    where: { id: caseId },
    select: { id: true, assignedAgentId: true, applications: { select: { status: true } } },
  })
  if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
    return { ok: false, message: 'Caso não encontrado ou fora da sua carteira.' }
  }

  if (insuranceCase.applications.some((a) => ACTIVE_APPLICATION.includes(a.status))) {
    return { ok: false, message: 'Já existe uma aplicação em andamento para este caso.' }
  }

  await prisma.$transaction([
    prisma.application.create({
      data: {
        caseId,
        status: 'STARTED',
        requirements: { create: STANDARD_REQUIREMENTS.map((title) => ({ title })) },
      },
    }),
    prisma.caseTimelineEvent.create({
      data: {
        caseId,
        type: 'APPLICATION_STARTED',
        title: 'Aplicação iniciada',
        body: `Checklist padrão criado com ${STANDARD_REQUIREMENTS.length} requirements.`,
      },
    }),
  ])

  revalidatePath(`/agent/cases/${caseId}`)
  return { ok: true }
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

export async function addFollowUp(caseId: string, title: string, dueAt: string): Promise<ActionResult> {
  const text = title.trim()
  if (!text) return { ok: false, message: 'Descreva o follow-up.' }
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return { ok: false, message: 'Data de follow-up inválida.' }

  const { scope } = await agentScopeIds()
  const insuranceCase = await prisma.insuranceCase.findUnique({
    where: { id: caseId },
    select: { id: true, assignedAgentId: true },
  })
  if (!insuranceCase || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, insuranceCase)) {
    return { ok: false, message: 'Caso não encontrado ou fora da sua carteira.' }
  }

  await prisma.caseTimelineEvent.create({
    data: { caseId, type: 'FOLLOW_UP', title: text, dueAt: due },
  })
  revalidatePath(`/agent/cases/${caseId}`)
  return { ok: true }
}

export async function completeFollowUp(eventId: string): Promise<ActionResult> {
  const { scope } = await agentScopeIds()
  const event = await prisma.caseTimelineEvent.findUnique({
    where: { id: eventId },
    select: { id: true, caseId: true, doneAt: true, insuranceCase: { select: { assignedAgentId: true } } },
  })
  if (!event || !canAccessCase({ role: 'AGENT', agentScopeIds: scope }, event.insuranceCase)) {
    return { ok: false, message: 'Follow-up não encontrado ou fora da sua carteira.' }
  }
  if (event.doneAt) return { ok: true } // idempotent — already done

  await prisma.caseTimelineEvent.update({ where: { id: eventId }, data: { doneAt: new Date() } })
  revalidatePath(`/agent/cases/${event.caseId}`)
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
