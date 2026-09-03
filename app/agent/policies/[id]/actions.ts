'use server'

import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { getCurrentAgent } from '@/lib/agent-context'
import { getAgentScopeIds } from '@/lib/agent-access'
import { canAccessPolicy } from '@/lib/policy-access'
import { buildStoredPath, saveUploadedFile } from '@/lib/storage'
import { nextAnnualReview } from '@/lib/annual-review'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { issueConnectorCommand, prismaConnectorCommandRepository } from '@/lib/national-life/connector-command-service'
import {
  requestNationalLifePolicyDetailRefresh,
} from '@/lib/national-life/policy-detail-command'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from '@/lib/national-life/local-connector/config'
import { getServerI18n } from '@/lib/i18n/server'

type ActionResult = { ok: true } | { ok: false; message: string }
export type PolicyDetailRefreshResult =
  | { ok: true; commandId: string }
  | { ok: false; message: string }

// Confirms the caller may act on this policy; returns null when allowed,
// otherwise a failure result the action can pass straight back to the UI.
type Copy = Awaited<ReturnType<typeof getServerI18n>>['copy']

async function assertPolicyAccess(policyId: string, copy: Copy): Promise<ActionResult | null> {
  const session = await requireRole('ADMIN', 'AGENT')
  if (session.user.role === 'ADMIN') return null

  const policy = await prisma.policy.findUnique({ where: { id: policyId }, select: { agentId: true, clientId: true } })
  if (!policy) return { ok: false, message: copy('Apólice não encontrada.', 'Policy not found.') }

  const agent = await getCurrentAgent()
  const scopeIds = await getAgentScopeIds(agent.id)
  if (!canAccessPolicy({ role: 'AGENT', agentScopeIds: scopeIds }, policy)) {
    return { ok: false, message: copy('Apólice fora da sua carteira.', 'Policy is outside your book.') }
  }
  return null
}

const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ILLUSTRATION_SUBDIR = 'illustrations'
const DOCUMENT_KIND_ILLUSTRATION = 'ILLUSTRATION'

export async function uploadPolicyDocument(formData: FormData): Promise<ActionResult> {
  const { copy } = await getServerI18n()
  const session = await requireRole('ADMIN', 'AGENT')
  const policyId = String(formData.get('policyId') ?? '')
  const file = formData.get('file')
  const documentKind = (formData.get('documentKind') as string | null) ?? 'DOCUMENT'

  const policy = await prisma.policy.findUnique({ where: { id: policyId } })
  if (!policy) return { ok: false, message: copy('Apólice não encontrada.', 'Policy not found.') }

  if (session.user.role === 'AGENT') {
    const agent = await getCurrentAgent()
    const scopeIds = await getAgentScopeIds(agent.id)
    if (!canAccessPolicy({ role: 'AGENT', agentScopeIds: scopeIds }, policy)) {
      return { ok: false, message: copy('Apólice fora da sua carteira.', 'Policy is outside your book.') }
    }
  }

  if (!(file instanceof File)) {
    return { ok: false, message: copy('Selecione um arquivo para enviar.', 'Select a file to upload.') }
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, message: copy('Envie um arquivo PDF, PNG ou JPG.', 'Upload a PDF, PNG, or JPG file.') }
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, message: copy('O arquivo excede o limite de 10 MB.', 'The file exceeds the 10 MB limit.') }
  }

  const uploadsDir = process.env.UPLOADS_DIR ?? './uploads'
  const isIllustration = documentKind === DOCUMENT_KIND_ILLUSTRATION
  const relativePath = buildStoredPath(
    policyId,
    file.name,
    randomUUID,
    isIllustration ? ILLUSTRATION_SUBDIR : undefined,
  )
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    await saveUploadedFile(uploadsDir, relativePath, buffer)

    await prisma.policyDocument.create({
      data: {
        policyId,
        filename: file.name,
        storedPath: relativePath,
        mimeType: file.type,
        sizeBytes: file.size,
        uploadedById: session.user.id,
      },
    })
  } catch {
    return { ok: false, message: copy('Não foi possível enviar o arquivo agora.', 'The file could not be uploaded right now.') }
  }

  revalidatePath(`/agent/policies/${policyId}`)
  return { ok: true }
}

export async function scheduleAnnualReview(policyId: string): Promise<ActionResult> {
  const { copy } = await getServerI18n()
  const denied = await assertPolicyAccess(policyId, copy)
  if (denied) return denied

  const open = await prisma.policyReview.findFirst({
    where: { policyId, completedAt: null },
    select: { id: true },
  })
  if (open) return { ok: false, message: copy('Já existe uma revisão anual agendada.', 'An annual review is already scheduled.') }

  await prisma.policyReview.create({ data: { policyId, dueAt: nextAnnualReview(new Date()) } })
  revalidatePath(`/agent/policies/${policyId}`)
  return { ok: true }
}

export async function completeAnnualReview(reviewId: string, notes: string): Promise<ActionResult> {
  const { copy } = await getServerI18n()
  const review = await prisma.policyReview.findUnique({
    where: { id: reviewId },
    select: { id: true, policyId: true, completedAt: true },
  })
  if (!review) return { ok: false, message: copy('Revisão não encontrada.', 'Review not found.') }

  const denied = await assertPolicyAccess(review.policyId, copy)
  if (denied) return denied
  if (review.completedAt) return { ok: true } // idempotent

  const now = new Date()
  // Complete this review and roll the next anniversary forward in one transaction
  // so the recurring cadence never drops a year.
  await prisma.$transaction([
    prisma.policyReview.update({
      where: { id: reviewId },
      data: { completedAt: now, notes: notes.trim() || null },
    }),
    prisma.policyReview.create({ data: { policyId: review.policyId, dueAt: nextAnnualReview(now) } }),
  ])

  revalidatePath(`/agent/policies/${review.policyId}`)
  return { ok: true }
}

export async function refreshNationalLifePolicyDetail(
  policyId: string,
): Promise<PolicyDetailRefreshResult> {
  const { copy } = await getServerI18n()
  try {
    const session = await requireRole('ADMIN', 'AGENT')
    const policy = await prisma.policy.findUnique({
      where: { id: policyId },
      select: { id: true, agentId: true, policyNumber: true, carrier: true },
    })
    if (!policy) return { ok: false, message: copy('Apólice não encontrada.', 'Policy not found.') }

    let agentScopeIds = [policy.agentId]
    if (session.user.role === 'AGENT') {
      const agent = await getCurrentAgent()
      agentScopeIds = await getAgentScopeIds(agent.id)
      if (!agentScopeIds.includes(policy.agentId)) {
        return { ok: false, message: copy('Apólice fora da sua carteira.', 'Policy is outside your book.') }
      }
    }

    const result = await requestNationalLifePolicyDetailRefresh({
      findOwnedPolicy: async () => policy,
      findCarrierRows: async (input) => {
        const scopes = [input.deploymentScope, 'keepr-one-production-v1']
        const [inforceRows, reportRows, caseRows] = await Promise.all([
          prisma.nationalLifeInforcePolicy.findMany({
            where: {
              agentId: input.agentId,
              policyNumber: input.policyNumber,
              deploymentScope: { in: scopes },
            },
            select: { raw: true },
            orderBy: { fetchedAt: 'desc' },
          }),
          prisma.nationalLifeReportRow.findMany({
            where: {
              agentId: input.agentId,
              deploymentScope: { in: scopes },
              gridKey: 'CLIENT_INTELLIGENCE',
              label: input.policyNumber,
            },
            select: { raw: true },
            orderBy: { fetchedAt: 'desc' },
          }),
          prisma.nationalLifeCaseSnapshot.findMany({
            where: {
              agentId: input.agentId,
              deploymentScope: { in: scopes },
              policyNo: input.policyNumber,
            },
            select: { raw: true },
            orderBy: { fetchedAt: 'desc' },
          }),
        ])
        return [
          ...inforceRows,
          ...reportRows,
          ...caseRows,
        ]
      },
      issue: async (input) => {
        const issued = await issueConnectorCommand(prismaConnectorCommandRepository, input)
        return { commandId: issued.command.commandId }
      },
    }, {
      agentScopeIds,
      policyId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
    })
    revalidatePath(`/agent/policies/${policyId}`)
    return { ok: true, commandId: result.commandId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'POLICY_DETAIL_ROUTE_UNAVAILABLE') {
      return {
        ok: false,
        message: copy('Atualize a carteira da National Life primeiro para localizar esta apólice.', 'Refresh the National Life book first to locate this policy.'),
      }
    }
    return { ok: false, message: copy('Não foi possível iniciar a atualização agora.', 'The refresh could not be started right now.') }
  }
}
