import { describe, expect, it, vi } from 'vitest'
import type { ConnectorCommandRepository } from '../connector-command-service'
import type { LocalConnectorCommandDispatchRepository } from './command-dispatch-service'
import {
  claimNextConnectorCommand,
  recordDeviceConnectorCommandEvent,
} from './command-dispatch-service'

const now = new Date('2026-08-26T17:00:00.000Z')

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd_1',
    agentId: 'agent_1',
    deviceId: 'device_1',
    protocolVersion: 1,
    runId: 'run_1',
    capability: 'READ_POLICY_DETAIL',
    target: { kind: 'POLICY', id: 'policy_1', carrierExternalId: 'LS1473219' },
    params: { policyNumber: 'LS1473219' },
    payloadHash: 'a'.repeat(64),
    idempotencyKey: 'policy_1:detail:1',
    requiresConfirmation: false,
    confirmationState: 'NOT_REQUIRED',
    state: 'QUEUED',
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    createdAt: now,
    events: [{ sequence: 0 }],
    ...overrides,
  }
}

function repository(next = candidate()) {
  const repo = {
    claimNext: vi.fn(async () => next as never),
    findDeviceOwned: vi.fn(async () => next as never),
    findByAgentIdempotencyKey: vi.fn(async () => null),
    findById: vi.fn(async () => next as never),
    createCommand: vi.fn(async () => next as never),
    updateCommand: vi.fn(async () => undefined),
    createConfirmation: vi.fn(async () => undefined),
    approveConfirmation: vi.fn(async () => undefined),
    appendEvent: vi.fn(async () => undefined),
  } satisfies LocalConnectorCommandDispatchRepository & ConnectorCommandRepository
  return repo
}

describe('local connector command dispatch', () => {
  it('returns a sealed device-owned command without exposing the payload hash ledger', async () => {
    const repo = repository()

    const command = await claimNextConnectorCommand(repo, {
      agentId: 'agent_1',
      deviceId: 'device_1',
      now,
    })

    expect(command).toMatchObject({
      commandId: 'cmd_1',
      capability: 'READ_POLICY_DETAIL',
      target: { kind: 'POLICY', id: 'policy_1' },
      params: { policyNumber: 'LS1473219' },
    })
    expect(command).not.toHaveProperty('payloadHash')
  })

  it('defensively refuses an unapproved carrier write', async () => {
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_1' },
      params: { illustrationId: 'illustration_1' },
      requiresConfirmation: true,
      confirmationState: 'PENDING',
    }))

    await expect(claimNextConnectorCommand(repo, {
      agentId: 'agent_1',
      deviceId: 'device_1',
      now,
    })).rejects.toThrowError('CONFIRMATION_REQUIRED')
  })

  it('refuses an expired or cross-device candidate even if a repository returns it', async () => {
    const expired = repository(candidate({ expiresAt: new Date(now.getTime() - 1) }))
    await expect(claimNextConnectorCommand(expired, {
      agentId: 'agent_1', deviceId: 'device_1', now,
    })).rejects.toThrowError('COMMAND_EXPIRED')

    const crossDevice = repository(candidate({ deviceId: 'device_2' }))
    await expect(claimNextConnectorCommand(crossDevice, {
      agentId: 'agent_1', deviceId: 'device_1', now,
    })).rejects.toThrowError('COMMAND_NOT_FOUND')
  })

  it('records an ordered event only after exact device ownership is proven', async () => {
    const repo = repository()
    const event = {
      protocolVersion: 1,
      eventId: 'event_1',
      commandId: 'cmd_1',
      runId: 'run_1',
      sequence: 1,
      type: 'COMMAND_STARTED',
      emittedAt: now.toISOString(),
      payload: null,
      error: null,
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1',
      deviceId: 'device_1',
      commandId: 'cmd_1',
      event,
      now,
    })

    expect(repo.findDeviceOwned).toHaveBeenCalledWith({
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1',
    })
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      commandId: 'cmd_1', sequence: 1, type: 'COMMAND_STARTED',
    }))
  })

  it('does not reveal a command owned by another device', async () => {
    const repo = repository(null as never)

    await expect(recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1',
      deviceId: 'device_2',
      commandId: 'cmd_1',
      event: {},
      now,
    })).rejects.toThrowError('COMMAND_NOT_FOUND')

    expect(repo.appendEvent).not.toHaveBeenCalled()
  })
})
