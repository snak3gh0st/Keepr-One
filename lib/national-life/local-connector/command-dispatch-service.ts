import 'server-only'

import { Prisma } from '@prisma/client'
import {
  commandMayExecute,
  ConnectorCommandError,
  recordConnectorCommandEvent,
  type ConnectorCommandRepository,
} from '../connector-command-service'
import {
  parseConnectorCommand,
  type ConnectorCommand,
} from '../connector-command-contract'

export type LocalConnectorCommandCandidate = {
  id: string
  agentId: string
  deviceId: string | null
  protocolVersion: number
  runId: string
  capability: string
  target: Prisma.JsonValue | null
  params: Prisma.JsonValue
  payloadHash: string
  idempotencyKey: string
  requiresConfirmation: boolean
  confirmationState: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  state: string
  expiresAt: Date
  createdAt: Date
  events: Array<{ sequence: number }>
}

export type LocalConnectorCommandDispatchRepository = ConnectorCommandRepository & {
  claimNext(input: {
    agentId: string
    deviceId: string
    now: Date
  }): Promise<LocalConnectorCommandCandidate | null>
  findDeviceOwned(input: {
    agentId: string
    deviceId: string
    commandId: string
  }): Promise<LocalConnectorCommandCandidate | null>
}

function toPublicCommand(candidate: LocalConnectorCommandCandidate): ConnectorCommand {
  const command = parseConnectorCommand({
    protocolVersion: candidate.protocolVersion,
    commandId: candidate.id,
    runId: candidate.runId,
    capability: candidate.capability,
    target: candidate.target,
    params: candidate.params,
    idempotencyKey: candidate.idempotencyKey,
    issuedAt: candidate.createdAt.toISOString(),
    expiresAt: candidate.expiresAt.toISOString(),
    requiresConfirmation: candidate.requiresConfirmation,
  })
  if (!command) throw new ConnectorCommandError('COMMAND_INVALID')
  return command
}

export async function claimNextConnectorCommand(
  repository: LocalConnectorCommandDispatchRepository,
  input: { agentId: string; deviceId: string; now?: Date },
): Promise<ConnectorCommand | null> {
  const now = input.now ?? new Date()
  const candidate = await repository.claimNext({
    agentId: input.agentId,
    deviceId: input.deviceId,
    now,
  })
  if (!candidate) return null

  // Defense in depth: never trust repository scoping as the authorization
  // boundary for a browser command.
  if (candidate.agentId !== input.agentId || candidate.deviceId !== input.deviceId) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }
  if (candidate.expiresAt <= now) throw new ConnectorCommandError('COMMAND_EXPIRED')
  if (candidate.state !== 'QUEUED') throw new ConnectorCommandError('COMMAND_NOT_FOUND')

  const command = toPublicCommand(candidate)
  if (!commandMayExecute(command, candidate.confirmationState)) {
    throw new ConnectorCommandError('CONFIRMATION_REQUIRED')
  }
  return command
}

export async function recordDeviceConnectorCommandEvent(
  repository: LocalConnectorCommandDispatchRepository,
  input: {
    agentId: string
    deviceId: string
    commandId: string
    event: unknown
    now?: Date
  },
): Promise<void> {
  const command = await repository.findDeviceOwned({
    agentId: input.agentId,
    deviceId: input.deviceId,
    commandId: input.commandId,
  })
  if (!command) throw new ConnectorCommandError('COMMAND_NOT_FOUND')

  await recordConnectorCommandEvent(repository, {
    agentId: input.agentId,
    event: input.event,
    now: input.now,
  })
}
