import 'server-only'

import { prisma } from '@/lib/prisma'
import type { IllustrationPdfStatus } from './illustration-pdf-status'

type IllustrationCommandStatusRecord = {
  state: string
  target: unknown
  safeErrorCode: string | null
  expiresAt: Date
}

function illustrationId(target: unknown): string | null {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null
  const value = target as Record<string, unknown>
  return value.kind === 'ILLUSTRATION' && typeof value.id === 'string' ? value.id : null
}

export function latestIllustrationCommandStatus(
  commands: readonly IllustrationCommandStatusRecord[],
  now = new Date(),
): Map<string, IllustrationPdfStatus> {
  const result = new Map<string, IllustrationPdfStatus>()
  for (const command of commands) {
    const id = illustrationId(command.target)
    if (!id || result.has(id)) continue
    if (command.expiresAt <= now && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(command.state)) {
      result.set(id, { state: 'FAILED', safeErrorCode: 'COMMAND_EXPIRED' })
    } else if (command.state === 'AUTH_REQUIRED') {
      result.set(id, { state: 'BLOCKED', safeErrorCode: command.safeErrorCode })
    } else if (['QUEUED', 'RUNNING', 'WAITING_FOR_CONFIRMATION', 'PAUSED'].includes(command.state)) {
      result.set(id, { state: 'WORKING' })
    } else if (command.state === 'COMPLETED') {
      // A completed current connector command must have persisted its signed
      // PDF first. Reaching the list without bytes is an integrity failure,
      // never an endless "working" state.
      result.set(id, { state: 'FAILED', safeErrorCode: 'FORESIGHT_ARTIFACT_MISSING' })
    } else if (command.state === 'FAILED' || command.state === 'CANCELLED') {
      result.set(id, { state: 'FAILED', safeErrorCode: command.safeErrorCode })
    }
  }
  return result
}

export async function getIllustrationCommandStatuses(agentId: string) {
  const commands = await prisma.nationalLifeConnectorCommand.findMany({
    where: { agentId, capability: 'GENERATE_ILLUSTRATION' },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { state: true, target: true, safeErrorCode: true, expiresAt: true },
  })
  return latestIllustrationCommandStatus(commands)
}
