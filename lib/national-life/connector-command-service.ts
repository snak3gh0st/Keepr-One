import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  CONNECTOR_COMMAND_PROTOCOL_VERSION,
  isReadOnlyCapability,
  parseConnectorCommand,
  parseConnectorCommandEvent,
  requiresExplicitConfirmation,
  type ConnectorCapability,
  type ConnectorCommand,
  type ConnectorCommandEvent,
  type ConnectorCommandParams,
  type ConnectorCommandState,
  type ConnectorCommandTarget,
} from './connector-command-contract'

type CommandRecord = {
  id: string
  agentId: string
  runId: string
  capability: string
  target: Prisma.JsonValue | null
  params: Prisma.JsonValue
  payloadHash: string
  idempotencyKey: string
  requiresConfirmation: boolean
  confirmationState: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED'
  state: ConnectorCommandState
  expiresAt: Date
  events: Array<{ sequence: number }>
}

type NewCommandRecord = Omit<CommandRecord, 'events' | 'target' | 'params'> & {
  target: Prisma.InputJsonValue | null
  params: Prisma.InputJsonValue
  protocolVersion: number
  deviceId: string | null
  safeErrorCode: string | null
  startedAt: Date | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ConnectorCommandRepository = {
  findByAgentIdempotencyKey(input: { agentId: string; idempotencyKey: string }): Promise<CommandRecord | null>
  findById(input: { commandId: string; agentId: string }): Promise<CommandRecord | null>
  createCommand(input: NewCommandRecord): Promise<CommandRecord>
  updateCommand(input: {
    commandId: string
    agentId: string
    patch: Partial<Pick<CommandRecord, 'state' | 'confirmationState'>> & {
      safeErrorCode?: string | null
      startedAt?: Date | null
      completedAt?: Date | null
    }
  }): Promise<void>
  createConfirmation(input: {
    commandId: string
    payloadHash: string
    state: 'PENDING'
    expiresAt: Date
    now: Date
  }): Promise<void>
  approveConfirmation(input: {
    commandId: string
    payloadHash: string
    confirmedByUserId: string
    now: Date
  }): Promise<void>
  appendEvent(input: {
    commandId: string
    sequence: number
    type: string
    payload: Prisma.InputJsonValue | null
    safeErrorCode: string | null
    now: Date
  }): Promise<void>
}

export class ConnectorCommandError extends Error {
  constructor(
    readonly code:
      | 'COMMAND_INVALID'
      | 'COMMAND_EXPIRED'
      | 'IDEMPOTENCY_CONFLICT'
      | 'COMMAND_NOT_FOUND'
      | 'CONFIRMATION_REQUIRED'
      | 'CONFIRMATION_REJECTED'
      | 'EVENT_INVALID'
      | 'FORESIGHT_TERM_PDF_INVALID'
      | 'FORESIGHT_TERM_PREMIUM_MISSING'
      | 'FORESIGHT_TERM_PREMIUM_MISMATCH',
  ) {
    super(code)
  }
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
    .join(',')}}`
}

export function connectorCommandPayloadHash(input: {
  capability: ConnectorCapability
  target: ConnectorCommandTarget | null
  params: ConnectorCommandParams
  requiresConfirmation: boolean
}): string {
  return createHash('sha256')
    .update(canonicalize(input))
    .digest('hex')
}

function toPublicCommand(record: CommandRecord, issuedAt: Date): ConnectorCommand {
  const candidate = {
    protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
    commandId: record.id,
    runId: record.runId,
    capability: record.capability,
    target: record.target,
    params: record.params,
    idempotencyKey: record.idempotencyKey,
    issuedAt: issuedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    requiresConfirmation: record.requiresConfirmation,
  }
  const parsed = parseConnectorCommand(candidate)
  if (!parsed) throw new ConnectorCommandError('COMMAND_INVALID')
  return parsed
}

export type IssueConnectorCommandInput = {
  agentId: string
  deviceId?: string
  runId?: string
  capability: ConnectorCapability
  target: ConnectorCommandTarget | null
  params: ConnectorCommandParams
  idempotencyKey: string
  expiresAt: Date
  now?: Date
}

export async function issueConnectorCommand(
  repository: ConnectorCommandRepository,
  input: IssueConnectorCommandInput,
): Promise<{ command: ConnectorCommand; payloadHash: string; duplicate: boolean }> {
  const now = input.now ?? new Date()
  if (input.expiresAt <= now) throw new ConnectorCommandError('COMMAND_EXPIRED')

  const requiresConfirmation = requiresExplicitConfirmation(input.capability)
  const payloadHash = connectorCommandPayloadHash({
    capability: input.capability,
    target: input.target,
    params: input.params,
    requiresConfirmation,
  })
  const existing = await repository.findByAgentIdempotencyKey({
    agentId: input.agentId,
    idempotencyKey: input.idempotencyKey,
  })
  if (existing) {
    if (existing.payloadHash !== payloadHash || existing.capability !== input.capability) {
      throw new ConnectorCommandError('IDEMPOTENCY_CONFLICT')
    }
    return { command: toPublicCommand(existing, now), payloadHash, duplicate: true }
  }

  const id = `cmd_${randomUUID()}`
  const runId = input.runId ?? `run_${randomUUID()}`
  const state: ConnectorCommandState = requiresConfirmation ? 'WAITING_FOR_CONFIRMATION' : 'QUEUED'
  const confirmationState = requiresConfirmation ? 'PENDING' : 'NOT_REQUIRED'
  const created = await repository.createCommand({
    id,
    agentId: input.agentId,
    deviceId: input.deviceId ?? null,
    protocolVersion: CONNECTOR_COMMAND_PROTOCOL_VERSION,
    runId,
    capability: input.capability,
    target: input.target as Prisma.InputJsonValue | null,
    params: input.params as Prisma.InputJsonValue,
    payloadHash,
    idempotencyKey: input.idempotencyKey,
    requiresConfirmation,
    confirmationState,
    state,
    safeErrorCode: null,
    expiresAt: input.expiresAt,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  if (requiresConfirmation) {
    await repository.createConfirmation({ commandId: id, payloadHash, state: 'PENDING', expiresAt: input.expiresAt, now })
  }
  await repository.appendEvent({
    commandId: id,
    sequence: 0,
    type: requiresConfirmation ? 'WAITING_FOR_CONFIRMATION' : 'COMMAND_ACCEPTED',
    payload: { capability: input.capability },
    safeErrorCode: null,
    now,
  })
  return { command: toPublicCommand(created, now), payloadHash, duplicate: false }
}

export async function approveConnectorCommand(
  repository: ConnectorCommandRepository,
  input: { agentId: string; commandId: string; payloadHash: string; confirmedByUserId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  const command = await repository.findById({ commandId: input.commandId, agentId: input.agentId })
  if (!command) throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  if (!command.requiresConfirmation) throw new ConnectorCommandError('COMMAND_INVALID')
  if (command.expiresAt <= now) {
    await repository.updateCommand({
      commandId: command.id,
      agentId: input.agentId,
      patch: { state: 'CANCELLED', confirmationState: 'EXPIRED', safeErrorCode: 'COMMAND_EXPIRED' },
    })
    throw new ConnectorCommandError('COMMAND_EXPIRED')
  }
  if (command.confirmationState !== 'PENDING' || command.payloadHash !== input.payloadHash) {
    throw new ConnectorCommandError('CONFIRMATION_REJECTED')
  }
  await repository.approveConfirmation({
    commandId: command.id,
    payloadHash: input.payloadHash,
    confirmedByUserId: input.confirmedByUserId,
    now,
  })
  await repository.updateCommand({
    commandId: command.id,
    agentId: input.agentId,
    patch: { state: 'QUEUED', confirmationState: 'APPROVED' },
  })
  await repository.appendEvent({
    commandId: command.id,
    sequence: command.events.length,
    type: 'COMMAND_ACCEPTED',
    payload: { confirmed: true },
    safeErrorCode: null,
    now,
  })
}

function nextStateForEvent(event: ConnectorCommandEvent): ConnectorCommandState | null {
  switch (event.type) {
    case 'COMMAND_STARTED': return 'RUNNING'
    case 'AUTH_REQUIRED':
    case 'MFA_REQUIRED': return 'AUTH_REQUIRED'
    case 'WAITING_FOR_CONFIRMATION': return 'WAITING_FOR_CONFIRMATION'
    case 'COMMAND_COMPLETED': return 'COMPLETED'
    case 'COMMAND_FAILED': return 'FAILED'
    default: return null
  }
}

export async function recordConnectorCommandEvent(
  repository: ConnectorCommandRepository,
  input: { agentId: string; event: unknown; now?: Date },
): Promise<void> {
  const event = parseConnectorCommandEvent(input.event)
  if (!event) throw new ConnectorCommandError('EVENT_INVALID')
  const command = await repository.findById({ commandId: event.commandId, agentId: input.agentId })
  if (!command || command.runId !== event.runId) throw new ConnectorCommandError('COMMAND_NOT_FOUND')
  if (command.expiresAt <= (input.now ?? new Date())) throw new ConnectorCommandError('COMMAND_EXPIRED')
  if (event.type === 'COMMAND_STARTED' && command.requiresConfirmation && command.confirmationState !== 'APPROVED') {
    throw new ConnectorCommandError('CONFIRMATION_REQUIRED')
  }
  if (event.sequence !== command.events.length) throw new ConnectorCommandError('EVENT_INVALID')
  const now = input.now ?? new Date()
  await repository.appendEvent({
    commandId: command.id,
    sequence: event.sequence,
    type: event.type,
    payload: event.payload as Prisma.InputJsonValue | null,
    safeErrorCode: event.error?.code ?? null,
    now,
  })
  const state = nextStateForEvent(event)
  if (state) {
    await repository.updateCommand({
      commandId: command.id,
      agentId: input.agentId,
      patch: {
        state,
        ...(state === 'RUNNING' ? { startedAt: now } : {}),
        ...(state === 'COMPLETED' || state === 'FAILED' ? { completedAt: now } : {}),
        ...(state === 'FAILED' ? { safeErrorCode: event.error?.code ?? 'COMMAND_FAILED' } : {}),
      },
    })
  }
}

/// The executor must never be given a write command before review. This helper
/// is the single dispatch gate used by local and remote transports.
export function commandMayExecute(command: Pick<ConnectorCommand, 'capability' | 'requiresConfirmation'>, confirmationState: string): boolean {
  return isReadOnlyCapability(command.capability) ||
    (!command.requiresConfirmation || confirmationState === 'APPROVED')
}

type ConnectorCommandPrisma = Pick<PrismaClient,
  'nationalLifeConnectorCommand' |
  'nationalLifeConnectorCommandConfirmation' |
  'nationalLifeConnectorCommandEvent'>

export function createPrismaConnectorCommandRepository(
  db: ConnectorCommandPrisma,
): ConnectorCommandRepository {
  return {
  async findByAgentIdempotencyKey(input) {
    return (await db.nationalLifeConnectorCommand.findUnique({
      where: { agentId_idempotencyKey: input },
      include: { events: { select: { sequence: true }, orderBy: { sequence: 'asc' } } },
    })) as CommandRecord | null
  },
  async findById(input) {
    return (await db.nationalLifeConnectorCommand.findFirst({
      where: { id: input.commandId, agentId: input.agentId },
      include: { events: { select: { sequence: true }, orderBy: { sequence: 'asc' } } },
    })) as CommandRecord | null
  },
  async createCommand(input) {
    const { target, ...data } = input
    return (await db.nationalLifeConnectorCommand.create({
      data: { ...data, target: target === null ? Prisma.JsonNull : target },
      include: { events: { select: { sequence: true } } },
    })) as unknown as CommandRecord
  },
  async updateCommand(input) {
    await db.nationalLifeConnectorCommand.updateMany({
      where: { id: input.commandId, agentId: input.agentId },
      data: input.patch,
    })
  },
  async createConfirmation(input) {
    const { now, ...data } = input
    await db.nationalLifeConnectorCommandConfirmation.create({
      data: { ...data, createdAt: now, updatedAt: now },
    })
  },
  async approveConfirmation(input) {
    await db.nationalLifeConnectorCommandConfirmation.updateMany({
      where: { commandId: input.commandId, payloadHash: input.payloadHash, state: 'PENDING' },
      data: { state: 'APPROVED', confirmedByUserId: input.confirmedByUserId, confirmedAt: input.now },
    })
  },
  async appendEvent(input) {
    await db.nationalLifeConnectorCommandEvent.create({
      data: {
        commandId: input.commandId,
        sequence: input.sequence,
        type: input.type,
        payload: input.payload === null ? Prisma.JsonNull : input.payload,
        safeErrorCode: input.safeErrorCode,
        createdAt: input.now,
      },
    })
  },
  }
}

export const prismaConnectorCommandRepository = createPrismaConnectorCommandRepository(prisma)
