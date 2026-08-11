import { describe, expect, it } from 'vitest'
import type { ConnectorCommandRepository } from './connector-command-service'
import {
  ConnectorCommandError,
  approveConnectorCommand,
  issueConnectorCommand,
  recordConnectorCommandEvent,
} from './connector-command-service'

const now = new Date('2026-08-10T20:00:00.000Z')

type MemoryCommand = {
  id: string
  agentId: string
  idempotencyKey: string
  payloadHash: string
  capability: string
  runId: string
  requiresConfirmation: boolean
  confirmationState: string
  state: string
  expiresAt: Date
  events: Array<{ sequence: number }>
} & Record<string, unknown>

function createRepository() {
  const commands = new Map<string, MemoryCommand>()
  const repository: ConnectorCommandRepository = {
    async findByAgentIdempotencyKey(input) {
      return [...commands.values()].find(
        (command) => command.agentId === input.agentId && command.idempotencyKey === input.idempotencyKey,
      ) ?? null
    },
    async findById(input) {
      const command = commands.get(input.commandId)
      return command?.agentId === input.agentId ? command : null
    },
    async createCommand(input) {
      const command: MemoryCommand = { ...input, events: [] }
      commands.set(command.id, command)
      return command as never
    },
    async updateCommand(input) {
      Object.assign(commands.get(input.commandId), input.patch)
    },
    async createConfirmation() {},
    async approveConfirmation() {},
    async appendEvent(input) {
      commands.get(input.commandId)?.events.push({ sequence: input.sequence })
    },
  }
  return { repository, commands }
}

describe('connector command service', () => {
  it('creates a read command as executable and deduplicates the same intent', async () => {
    const { repository } = createRepository()
    const input = {
      agentId: 'agent_1',
      capability: 'FORESIGHT_INVENTORY' as const,
      target: null,
      params: {},
      idempotencyKey: 'foresight:inventory:1',
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      now,
    }

    const first = await issueConnectorCommand(repository, input)
    const duplicate = await issueConnectorCommand(repository, input)

    expect(first).toMatchObject({ duplicate: false, command: { capability: 'FORESIGHT_INVENTORY' } })
    expect(duplicate).toMatchObject({ duplicate: true, command: { commandId: first.command.commandId } })
  })

  it('blocks submission until the exact reviewed payload hash is approved', async () => {
    const { repository, commands } = createRepository()
    const issued = await issueConnectorCommand(repository, {
      agentId: 'agent_1',
      capability: 'SUBMIT_APPLICATION',
      target: { kind: 'APPLICATION', id: 'application_1' },
      params: { applicationId: 'application_1', payloadHash: 'a'.repeat(64) },
      idempotencyKey: 'application_1:submit:1',
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      now,
    })

    await expect(
      recordConnectorCommandEvent(repository, {
        agentId: 'agent_1',
        event: {
          protocolVersion: 1,
          eventId: 'event_1',
          commandId: issued.command.commandId,
          runId: issued.command.runId,
          sequence: 1,
          type: 'COMMAND_STARTED',
          emittedAt: now.toISOString(),
          payload: null,
          error: null,
        },
        now,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' } satisfies Partial<ConnectorCommandError>)

    await approveConnectorCommand(repository, {
      agentId: 'agent_1',
      commandId: issued.command.commandId,
      payloadHash: issued.payloadHash,
      confirmedByUserId: 'user_1',
      now,
    })

    await recordConnectorCommandEvent(repository, {
      agentId: 'agent_1',
      event: {
        protocolVersion: 1,
        eventId: 'event_2',
        commandId: issued.command.commandId,
        runId: issued.command.runId,
        sequence: 2,
        type: 'COMMAND_STARTED',
        emittedAt: now.toISOString(),
        payload: null,
        error: null,
      },
      now,
    })

    expect(commands.get(issued.command.commandId)).toMatchObject({ state: 'RUNNING', confirmationState: 'APPROVED' })
  })
})
