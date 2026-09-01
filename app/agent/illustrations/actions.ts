'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import {
  approveConnectorCommand,
  issueConnectorCommand,
  prismaConnectorCommandRepository,
} from '@/lib/national-life/connector-command-service'
import {
  buildForesightIllustrationSnapshot,
  foresightIllustrationInputHash,
} from '@/lib/national-life/foresight-illustration-contract'
import {
  buildForesightTermIllustrationSnapshot,
  foresightTermIllustrationInputHash,
} from '@/lib/national-life/foresight-term-contract'
import { extractForesightTermPremiums } from '@/lib/national-life/foresight-term-pdf'
import { isNationalLifeLocalConnectorEnabled } from '@/lib/national-life/local-connector/config'

export type RequestIllustrationPdfResult =
  | { ok: true; commandId: string; duplicate: boolean; completed: boolean }
  | { ok: false; message: string }

export type ReconcileTermIllustrationPdfResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

function termPdfReconciliationMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'FORESIGHT_TERM_PREMIUM_MISSING' || code === 'FORESIGHT_TERM_PREMIUM_MISMATCH') {
    return 'O PDF não trouxe uma tabela de prêmios Term que possa ser confirmada. Gere uma nova ilustração.'
  }
  if (code === 'FORESIGHT_TERM_PDF_INVALID') {
    return 'O arquivo recebido não é um PDF Term válido. Gere uma nova ilustração.'
  }
  return 'Não foi possível conferir este PDF Term agora. Tente novamente.'
}

/// Reconciles the already-uploaded carrier PDF. This is deliberately separate
/// from `requestIllustrationPdf`: retrying a local read-back must never create
/// another Foresight case or send a second carrier command.
export async function reconcileTermIllustrationPdf(
  illustrationId: string,
): Promise<ReconcileTermIllustrationPdfResult> {
  try {
    const agent = await getCurrentAgent()
    const illustration = await prisma.illustration.findFirst({
      where: {
        id: illustrationId,
        agentId: agent.id,
        productName: { in: ['LSW Term', 'NL Term'] },
        documentMimeType: 'application/pdf',
        documentBytes: { not: null },
      },
      select: {
        id: true,
        caseId: true,
        createdAt: true,
        productName: true,
        rawPayload: true,
        documentBytes: true,
      },
    })
    if (!illustration?.documentBytes) {
      return { ok: false, message: 'Nenhum PDF Term disponível para conferir.' }
    }

    const snapshot = buildForesightTermIllustrationSnapshot(illustration)
    const premiums = await extractForesightTermPremiums(illustration.documentBytes)
    const rawPayload = illustration.rawPayload && typeof illustration.rawPayload === 'object' &&
      !Array.isArray(illustration.rawPayload)
      ? illustration.rawPayload as Record<string, unknown>
      : null
    if (!rawPayload) return { ok: false, message: 'Os dados do cenário Term não estão disponíveis para conferência.' }

    const updated = await prisma.illustration.updateMany({
      where: {
        id: illustration.id,
        agentId: agent.id,
        productName: { in: ['LSW Term', 'NL Term'] },
        documentMimeType: 'application/pdf',
      },
      data: {
        premium: premiums.monthlyPremium,
        targetPremium: premiums.monthlyPremium,
        targetPremiumSource: 'CARRIER_CALCULATED_FOR_TERM',
        rawPayload: {
          ...rawPayload,
          foresightTermResult: {
            source: 'OFFICIAL_PDF',
            premiumMode: 'Monthly',
            confirmedFaceAmount: snapshot.faceAmount,
            confirmedMonthlyPremium: premiums.monthlyPremium,
            confirmedAnnualPremium: premiums.annualPremium,
            requestedTermDuration: snapshot.termDuration,
            confirmedTermDuration: snapshot.termDuration,
          },
        },
      },
    })
    if (updated.count !== 1) {
      return { ok: false, message: 'Não foi possível salvar a conferência deste PDF Term.' }
    }

    try {
      await prisma.auditLog.create({
        data: {
          userId: agent.userId,
          action: 'FORESIGHT_TERM_PDF_RECONCILED',
          entity: 'Illustration',
          entityId: illustration.id,
          after: {
            monthlyPremium: premiums.monthlyPremium,
            annualPremium: premiums.annualPremium,
          },
        },
      })
    } catch (auditError) {
      console.error('Term PDF reconciliation audit failed', auditError)
    }

    revalidatePath('/agent/illustrations')
    revalidatePath(`/agent/illustrations/${illustration.id}`)
    return { ok: true, message: 'Prêmios Term confirmados com o PDF oficial.' }
  } catch (error) {
    return { ok: false, message: termPdfReconciliationMessage(error) }
  }
}

/// Issues the exact Foresight case reviewed by the signed-in agent. The button
/// click is the explicit approval gesture; both server and extension still
/// verify the immutable payload hash before the carrier write.
export async function requestIllustrationPdf(
  illustrationId: string,
): Promise<RequestIllustrationPdfResult> {
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: 'Conecte o K-Bot neste navegador para gerar a ilustração oficial.' }
  }
  const agent = await getCurrentAgent()
  const illustration = await prisma.illustration.findFirst({
    where: { id: illustrationId, agentId: agent.id },
    select: {
      id: true,
      caseId: true,
      createdAt: true,
      productName: true,
      rawPayload: true,
      documentFetchedAt: true,
    },
  })
  if (!illustration) return { ok: false, message: 'Cotação não encontrada.' }
  if (illustration.documentFetchedAt) {
    return { ok: true, commandId: '', duplicate: true, completed: true }
  }

  try {
    const inputHash = illustration.productName === 'LSW Term' || illustration.productName === 'NL Term'
      ? foresightTermIllustrationInputHash(buildForesightTermIllustrationSnapshot(illustration))
      : foresightIllustrationInputHash(buildForesightIllustrationSnapshot(illustration))
    const baseIdempotencyKey = `foresight:${illustration.id}:${inputHash}`
    const now = new Date()
    const latest = await prisma.nationalLifeConnectorCommand.findFirst({
      where: { agentId: agent.id, idempotencyKey: { startsWith: baseIdempotencyKey } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, payloadHash: true, state: true, confirmationState: true, expiresAt: true,
      },
    })
    const resumable = latest && latest.expiresAt > now &&
      ['QUEUED', 'RUNNING', 'AUTH_REQUIRED', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(latest.state)
    if (resumable) {
      if (latest.confirmationState === 'PENDING') {
        await approveConnectorCommand(prismaConnectorCommandRepository, {
          agentId: agent.id,
          commandId: latest.id,
          payloadHash: latest.payloadHash,
          confirmedByUserId: agent.userId,
        })
      } else if (latest.confirmationState !== 'APPROVED') {
        return { ok: false, message: 'Este pedido não está mais disponível para confirmação.' }
      }
      return {
        ok: true,
        commandId: latest.id,
        duplicate: true,
        completed: false,
      }
    }
    const issued = await issueConnectorCommand(prismaConnectorCommandRepository, {
      agentId: agent.id,
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: illustration.id },
      params: { illustrationId: illustration.id, inputHash },
      idempotencyKey: latest ? `${baseIdempotencyKey}:retry:${latest.id}` : baseIdempotencyKey,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })
    const persisted = await prisma.nationalLifeConnectorCommand.findFirst({
      where: { id: issued.command.commandId, agentId: agent.id },
      select: { state: true, confirmationState: true },
    })
    if (!persisted) return { ok: false, message: 'Não foi possível registrar o pedido.' }
    if (persisted.confirmationState === 'PENDING') {
      await approveConnectorCommand(prismaConnectorCommandRepository, {
        agentId: agent.id,
        commandId: issued.command.commandId,
        payloadHash: issued.payloadHash,
        confirmedByUserId: agent.userId,
      })
    } else if (persisted.confirmationState !== 'APPROVED') {
      return { ok: false, message: 'Este pedido não está mais disponível para confirmação.' }
    }
    if (persisted.state === 'FAILED' || persisted.state === 'CANCELLED') {
      return { ok: false, message: 'A tentativa anterior não foi concluída. Revise o erro antes de tentar novamente.' }
    }
    revalidatePath('/agent/illustrations')
    revalidatePath(`/agent/illustrations/${illustration.id}`)
    return {
      ok: true,
      commandId: issued.command.commandId,
      duplicate: issued.duplicate,
      completed: persisted.state === 'COMPLETED',
    }
  } catch {
    return { ok: false, message: 'Não foi possível iniciar a ilustração oficial agora.' }
  }
}
