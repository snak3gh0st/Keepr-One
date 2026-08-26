import 'server-only'

import type { NationalLifeConnectorCommandState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { prismaConnectorCommandRepository } from '../connector-command-service'
import type {
  LocalConnectorCommandCandidate,
  LocalConnectorCommandDispatchRepository,
} from './command-dispatch-service'

const commandWithEvents = {
  events: { select: { sequence: true, type: true }, orderBy: { sequence: 'asc' as const } },
}

function eligibleWhere(agentId: string, now: Date, commandId?: string) {
  return {
    agentId,
    ...(commandId ? { id: commandId } : {}),
    state: 'QUEUED' as const,
    expiresAt: { gt: now },
    OR: [
      { requiresConfirmation: false },
      { requiresConfirmation: true, confirmationState: 'APPROVED' as const },
    ],
  }
}

function resumableWhere(agentId: string, deviceId: string, now: Date, commandId?: string) {
  return {
    agentId,
    deviceId,
    ...(commandId ? { id: commandId } : {}),
    state: { in: ['QUEUED', 'RUNNING', 'AUTH_REQUIRED'] as NationalLifeConnectorCommandState[] },
    expiresAt: { gt: now },
    OR: [
      { requiresConfirmation: false },
      { requiresConfirmation: true, confirmationState: 'APPROVED' as const },
    ],
  }
}

type DispatchDb = Pick<typeof prisma, 'nationalLifeConnectorCommand' | '$transaction'>

export function createPrismaLocalConnectorCommandDispatchRepository(
  db: DispatchDb,
): LocalConnectorCommandDispatchRepository {
  return {
    ...prismaConnectorCommandRepository,
    async claimNext(input) {
      return db.$transaction(async (tx) => {
        const owned = await tx.nationalLifeConnectorCommand.findFirst({
          where: resumableWhere(input.agentId, input.deviceId, input.now, input.commandId),
          include: commandWithEvents,
          orderBy: { createdAt: 'asc' },
        })
        if (owned) return owned as unknown as LocalConnectorCommandCandidate

        const unbound = await tx.nationalLifeConnectorCommand.findFirst({
          where: { ...eligibleWhere(input.agentId, input.now, input.commandId), deviceId: null },
          include: commandWithEvents,
          orderBy: { createdAt: 'asc' },
        })
        if (!unbound) return null

        const claimed = await tx.nationalLifeConnectorCommand.updateMany({
          where: {
            id: unbound.id,
            agentId: input.agentId,
            deviceId: null,
            state: 'QUEUED',
            expiresAt: { gt: input.now },
          },
          data: { deviceId: input.deviceId },
        })
        if (claimed.count !== 1) return null

        return await tx.nationalLifeConnectorCommand.findFirst({
          where: {
            id: unbound.id,
            agentId: input.agentId,
            deviceId: input.deviceId,
            state: 'QUEUED',
            expiresAt: { gt: input.now },
          },
          include: commandWithEvents,
        }) as unknown as LocalConnectorCommandCandidate | null
      })
    },
    async findDeviceOwned(input) {
      return await db.nationalLifeConnectorCommand.findFirst({
        where: {
          id: input.commandId,
          agentId: input.agentId,
          deviceId: input.deviceId,
        },
        include: commandWithEvents,
      }) as unknown as LocalConnectorCommandCandidate | null
    },
  }
}

export const prismaLocalConnectorCommandDispatchRepository =
  createPrismaLocalConnectorCommandDispatchRepository(prisma)
