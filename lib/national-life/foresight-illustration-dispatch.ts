import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  approveConnectorCommand,
  createPrismaConnectorCommandRepository,
  issueConnectorCommand,
} from './connector-command-service'
import { NATIONAL_LIFE_PROVIDER } from './constants'

/// The single path that turns an illustration draft into a carrier command.
///
/// It was extracted from the agent's own "new illustration" action so the K-Bot
/// can raise an illustration without a second, subtly different dispatcher:
/// the advisory lock, the active-command guard and the connector handshake are
/// the expensive parts to get right, and there must be only one of them.
/// Parsing and payload building stay with each caller, because the payload is
/// what the input hash — and therefore the idempotency key — is derived from.

export const ACTIVE_ILLUSTRATION_COMMAND_STATES = [
  'QUEUED',
  'RUNNING',
  'AUTH_REQUIRED',
  'WAITING_FOR_CONFIRMATION',
  'PAUSED',
] as const

export function targetIllustrationId(target: unknown): string | null {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null
  const value = target as Record<string, unknown>
  return value.kind === 'ILLUSTRATION' && typeof value.id === 'string' ? value.id : null
}

export type ForesightIllustrationDraft = {
  illustrationId: string
  clientId: string | null
  productName: string
  faceAmount: number | null
  targetPremium: number | null
  targetPremiumSource: string | null
  insuredName: string
  insuredDateOfBirth: Date
  rawPayload: Prisma.InputJsonValue
}

export type DispatchForesightIllustrationResult = {
  command: { commandId: string }
  illustrationId: string
  /// True when an illustration was already being generated for this agent, so
  /// nothing new was created and no second connector run was paid for.
  reusedActiveCommand: boolean
}

/// Create the illustration row and hand the connector the command for it.
///
/// `inputHash` is computed by the caller from the row as persisted, because the
/// snapshot contracts read the created id and timestamp.
export async function dispatchForesightIllustration(input: {
  agentId: string
  userId: string
  draft: ForesightIllustrationDraft
  inputHash: (source: {
    id: string
    createdAt: Date
    caseId: null
    productName: string
    rawPayload: Prisma.InputJsonValue
  }) => string
  now?: Date
}): Promise<DispatchForesightIllustrationResult> {
  const { agentId, userId, draft } = input
  return prisma.$transaction(async (tx) => {
    // Serialize per agent inside Postgres. This protects every browser tab and
    // survives two requests arriving before either UI can repaint.
    // Postgres returns `void` from pg_advisory_xact_lock. Prisma cannot
    // deserialize that type and raises P2010 after the lock was acquired, so
    // expose the otherwise-unused result as text.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`foresight:${agentId}`}, 0))::text AS lock_result`
    const now = input.now ?? new Date()
    const active = await tx.nationalLifeConnectorCommand.findFirst({
      where: {
        agentId,
        capability: 'GENERATE_ILLUSTRATION',
        state: { in: [...ACTIVE_ILLUSTRATION_COMMAND_STATES] },
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, target: true },
    })
    const activeIllustrationId = targetIllustrationId(active?.target)
    if (active && activeIllustrationId) {
      return {
        command: { commandId: active.id },
        illustrationId: activeIllustrationId,
        reusedActiveCommand: true,
      }
    }

    const repository = createPrismaConnectorCommandRepository(tx)
    const created = await tx.illustration.create({
      data: {
        id: draft.illustrationId,
        agentId,
        clientId: draft.clientId,
        kind: 'PRELIMINARY',
        productName: draft.productName,
        provider: NATIONAL_LIFE_PROVIDER,
        externalId: draft.illustrationId,
        faceAmount: draft.faceAmount,
        premium: null,
        targetPremium: draft.targetPremium,
        targetPremiumSource: draft.targetPremiumSource,
        insuredName: draft.insuredName,
        insuredDateOfBirth: draft.insuredDateOfBirth,
        rawPayload: draft.rawPayload,
      },
      select: { id: true, createdAt: true },
    })
    const inputHash = input.inputHash({
      ...created,
      caseId: null,
      productName: draft.productName,
      rawPayload: draft.rawPayload,
    })
    const command = await issueConnectorCommand(repository, {
      agentId,
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: created.id },
      params: { illustrationId: created.id, inputHash },
      idempotencyKey: `foresight:${created.id}:${inputHash}`,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
    })
    await approveConnectorCommand(repository, {
      agentId,
      commandId: command.command.commandId,
      payloadHash: command.payloadHash,
      confirmedByUserId: userId,
    })
    return {
      command: { commandId: command.command.commandId },
      illustrationId: created.id,
      reusedActiveCommand: false,
    }
  })
}
