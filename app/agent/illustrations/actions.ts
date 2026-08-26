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
import { isNationalLifeLocalConnectorEnabled } from '@/lib/national-life/local-connector/config'

export type RequestIllustrationPdfResult =
  | { ok: true; commandId: string; duplicate: boolean; completed: boolean }
  | { ok: false; message: string }

/// Issues the exact Foresight case reviewed by the signed-in agent. The button
/// click is the explicit approval gesture; both server and extension still
/// verify the immutable payload hash before the carrier write.
export async function requestIllustrationPdf(
  illustrationId: string,
): Promise<RequestIllustrationPdfResult> {
  if (!isNationalLifeLocalConnectorEnabled()) {
    return { ok: false, message: 'Conecte o KeeproneConnect para gerar a ilustração oficial.' }
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
    const snapshot = buildForesightIllustrationSnapshot(illustration)
    const inputHash = foresightIllustrationInputHash(snapshot)
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
