'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentAgent as readCurrentAgent } from '@/lib/agent-context'
import { prisma } from '@/lib/prisma'
import {
  approveConnectorCommand,
  ConnectorCommandError,
  issueConnectorCommand,
  prismaConnectorCommandRepository,
  retryConnectorCommandAuthentication,
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
import { getServerI18n } from '@/lib/i18n/server'
import { requireAgentModule } from '@/lib/require-agent-module'

export type RequestIllustrationPdfResult =
  | { ok: true; commandId: string; duplicate: boolean; completed: boolean; retryingLogin?: true }
  | { ok: false; message: string }

export type ReconcileTermIllustrationPdfResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

async function getCurrentAgent() {
  await requireAgentModule('ILLUSTRATIONS')
  return readCurrentAgent()
}

function termPdfReconciliationMessage(
  error: unknown,
  copy: (portuguese: string, english: string) => string,
): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'FORESIGHT_TERM_PREMIUM_MISSING' || code === 'FORESIGHT_TERM_PREMIUM_MISMATCH') {
    return copy(
      'O PDF não trouxe uma tabela de prêmios Term que possa ser confirmada. Gere uma nova ilustração.',
      'The PDF did not contain a Term premium table that could be verified. Generate a new illustration.',
    )
  }
  if (code === 'FORESIGHT_TERM_PDF_INVALID') {
    return copy(
      'O arquivo recebido não é um PDF Term válido. Gere uma nova ilustração.',
      'The received file is not a valid Term PDF. Generate a new illustration.',
    )
  }
  return copy(
    'Não foi possível conferir este PDF Term agora. Tente novamente.',
    'This Term PDF could not be verified right now. Try again.',
  )
}

/// Reconciles the already-uploaded carrier PDF. This is deliberately separate
/// from `requestIllustrationPdf`: retrying a local read-back must never create
/// another Foresight case or send a second carrier command.
export async function reconcileTermIllustrationPdf(
  illustrationId: string,
): Promise<ReconcileTermIllustrationPdfResult> {
  const { copy } = await getServerI18n()
  let stage = 'authenticate'
  try {
    const agent = await getCurrentAgent()
    stage = 'load-artifact'
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
      return {
        ok: false,
        message: copy('Nenhum PDF Term disponível para conferir.', 'No Term PDF is available for verification.'),
      }
    }

    stage = 'validate-scenario'
    const snapshot = buildForesightTermIllustrationSnapshot(illustration)
    stage = 'extract-premiums'
    const premiums = await extractForesightTermPremiums(illustration.documentBytes)
    stage = 'prepare-result'
    const rawPayload = illustration.rawPayload && typeof illustration.rawPayload === 'object' &&
      !Array.isArray(illustration.rawPayload)
      ? illustration.rawPayload as Record<string, unknown>
      : null
    if (!rawPayload) {
      return {
        ok: false,
        message: copy(
          'Os dados do cenário Term não estão disponíveis para conferência.',
          'The Term scenario data is not available for verification.',
        ),
      }
    }

    stage = 'persist-result'
    const updated = await prisma.illustration.updateMany({
      where: {
        id: illustration.id,
        agentId: agent.id,
        productName: { in: ['LSW Term', 'NL Term'] },
        documentMimeType: 'application/pdf',
      },
      data: {
        premium: premiums.monthlyPremium,
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
      return {
        ok: false,
        message: copy(
          'Não foi possível salvar a conferência deste PDF Term.',
          'The verification of this Term PDF could not be saved.',
        ),
      }
    }

    stage = 'audit-result'
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

    stage = 'revalidate'
    revalidatePath('/agent/illustrations')
    revalidatePath(`/agent/illustrations/${illustration.id}`)
    return {
      ok: true,
      message: copy(
        'Prêmios Term confirmados com o PDF oficial.',
        'Term premiums verified against the official PDF.',
      ),
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    // The action intentionally never exposes raw parser/database errors to the
    // client. Keep a bounded, non-sensitive stage marker in the server log so
    // an operational failure can be diagnosed without recording PDF content or
    // any carrier credentials.
    console.error('Term PDF reconciliation failed', {
      illustrationId,
      stage,
      code: [
        'FORESIGHT_TERM_PREMIUM_MISSING',
        'FORESIGHT_TERM_PREMIUM_MISMATCH',
        'FORESIGHT_TERM_PDF_INVALID',
        'INVALID_FORESIGHT_TERM_INPUT',
      ].includes(code) ? code : 'UNCLASSIFIED',
      errorName: error instanceof Error ? error.name : typeof error,
    })
    return { ok: false, message: termPdfReconciliationMessage(error, copy) }
  }
}

/// Issues the exact Foresight case reviewed by the signed-in agent. The button
/// click is the explicit approval gesture; both server and extension still
/// verify the immutable payload hash before the carrier write.
export async function requestIllustrationPdf(
  illustrationId: string,
): Promise<RequestIllustrationPdfResult> {
  const { copy } = await getServerI18n()
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: copy('Conecte o K-Bot neste navegador para gerar a ilustração oficial.', 'Connect K-Bot in this browser to generate the official illustration.') }
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
  if (!illustration) return { ok: false, message: copy('Cotação não encontrada.', 'Quote not found.') }
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
      let retryingLogin = false
      if (latest.confirmationState === 'PENDING') {
        await approveConnectorCommand(prismaConnectorCommandRepository, {
          agentId: agent.id,
          commandId: latest.id,
          payloadHash: latest.payloadHash,
          confirmedByUserId: agent.userId,
        })
      } else if (latest.confirmationState !== 'APPROVED') {
        return { ok: false, message: copy('Este pedido não está mais disponível para confirmação.', 'This request is no longer available for confirmation.') }
      }
      if (latest.state === 'AUTH_REQUIRED') {
        await retryConnectorCommandAuthentication(prismaConnectorCommandRepository, {
          agentId: agent.id,
          commandId: latest.id,
        })
        retryingLogin = true
      }
      revalidatePath('/agent/illustrations')
      revalidatePath(`/agent/illustrations/${illustration.id}`)
      return {
        ok: true,
        commandId: latest.id,
        duplicate: true,
        completed: false,
        ...(retryingLogin ? { retryingLogin: true as const } : {}),
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
    if (!persisted) return { ok: false, message: copy('Não foi possível registrar o pedido.', 'The request could not be recorded.') }
    if (persisted.confirmationState === 'PENDING') {
      await approveConnectorCommand(prismaConnectorCommandRepository, {
        agentId: agent.id,
        commandId: issued.command.commandId,
        payloadHash: issued.payloadHash,
        confirmedByUserId: agent.userId,
      })
    } else if (persisted.confirmationState !== 'APPROVED') {
      return { ok: false, message: copy('Este pedido não está mais disponível para confirmação.', 'This request is no longer available for confirmation.') }
    }
    if (persisted.state === 'FAILED' || persisted.state === 'CANCELLED') {
      return { ok: false, message: copy('A tentativa anterior não foi concluída. Revise o erro antes de tentar novamente.', 'The previous attempt was not completed. Review the error before trying again.') }
    }
    revalidatePath('/agent/illustrations')
    revalidatePath(`/agent/illustrations/${illustration.id}`)
    return {
      ok: true,
      commandId: issued.command.commandId,
      duplicate: issued.duplicate,
      completed: persisted.state === 'COMPLETED',
    }
  } catch (error) {
    if (error instanceof ConnectorCommandError && error.code === 'AUTH_RETRY_UNAVAILABLE') {
      return {
        ok: false,
        message: copy(
          'A National Life ainda precisa de uma verificação manual. Conclua o login ou MFA na janela da seguradora e tente novamente.',
          'National Life still requires manual verification. Complete the sign-in or MFA in the carrier window and try again.',
        ),
      }
    }
    return {
      ok: false,
      message: copy(
        'Não foi possível iniciar a ilustração oficial agora.',
        'The official illustration could not be started right now.',
      ),
    }
  }
}
