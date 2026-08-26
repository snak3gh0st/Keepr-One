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
  parseConnectorCommandEvent,
  type ConnectorCommand,
} from '../connector-command-contract'
import { parseNationalLifePolicyDetail } from '../policy-detail'
import {
  persistNationalLifePolicyDetail,
  type PolicyDetailRepository,
} from '../policy-detail-service'

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
  events: Array<{ sequence: number; type?: string }>
}

export type LocalConnectorCommandDispatchRepository = ConnectorCommandRepository & {
  claimNext(input: {
    agentId: string
    deviceId: string
    now: Date
    commandId?: string
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
  input: { agentId: string; deviceId: string; commandId?: string; now?: Date },
): Promise<{
  command: ConnectorCommand
  state: 'QUEUED' | 'RUNNING' | 'AUTH_REQUIRED'
  nextEventSequence: number
  lastEventType: string | null
} | null> {
  const now = input.now ?? new Date()
  const candidate = await repository.claimNext({
    agentId: input.agentId,
    deviceId: input.deviceId,
    now,
    ...(input.commandId ? { commandId: input.commandId } : {}),
  })
  if (!candidate) return null

  // Defense in depth: never trust repository scoping as the authorization
  // boundary for a browser command.
  if (candidate.agentId !== input.agentId || candidate.deviceId !== input.deviceId) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }
  if (candidate.expiresAt <= now) throw new ConnectorCommandError('COMMAND_EXPIRED')
  if (!['QUEUED', 'RUNNING', 'AUTH_REQUIRED'].includes(candidate.state)) {
    throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  }

  const command = toPublicCommand(candidate)
  if (!commandMayExecute(command, candidate.confirmationState)) {
    throw new ConnectorCommandError('CONFIRMATION_REQUIRED')
  }
  const state = candidate.state as 'QUEUED' | 'RUNNING' | 'AUTH_REQUIRED'
  return {
    command,
    state,
    nextEventSequence: candidate.events.length,
    lastEventType: candidate.events.at(-1)?.type ?? null,
  }
}

export async function recordDeviceConnectorCommandEvent(
  repository: LocalConnectorCommandDispatchRepository,
  input: {
    agentId: string
    deviceId: string
    commandId: string
    event: unknown
    now?: Date
    policyDetailRepository?: PolicyDetailRepository
    deploymentScope?: string
  },
): Promise<void> {
  const command = await repository.findDeviceOwned({
    agentId: input.agentId,
    deviceId: input.deviceId,
    commandId: input.commandId,
  })
  if (!command) throw new ConnectorCommandError('COMMAND_NOT_FOUND')

  const event = parseConnectorCommandEvent(input.event)
  if (!event || event.commandId !== input.commandId || event.runId !== command.runId) {
    throw new ConnectorCommandError('EVENT_INVALID')
  }
  if (event.type === 'DATA_BATCH' && command.capability === 'READ_POLICY_DETAIL') {
    const publicCommand = toPublicCommand(command)
    const payload = event.payload
    if (
      publicCommand.target?.kind !== 'POLICY' ||
      !payload ||
      Object.keys(payload).length !== 1 ||
      !Object.hasOwn(payload, 'policyDetail') ||
      !input.policyDetailRepository ||
      !input.deploymentScope
    ) throw new ConnectorCommandError('EVENT_INVALID')
    let detail
    try {
      detail = parseNationalLifePolicyDetail(payload.policyDetail as never)
    } catch {
      throw new ConnectorCommandError('EVENT_INVALID')
    }
    await persistNationalLifePolicyDetail(input.policyDetailRepository, {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      policyId: publicCommand.target.id,
      detail,
    })
  }

  await recordConnectorCommandEvent(repository, {
    agentId: input.agentId,
    event,
    now: input.now,
  })
}
