import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ConnectorCommandRepository } from '../connector-command-service'
import type { PolicyDetailRepository } from '../policy-detail-service'
import type { LocalConnectorCommandDispatchRepository } from './command-dispatch-service'
import {
  claimNextConnectorCommand,
  readDeviceConnectorCommandInput,
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
    params: {
      policyNumber: 'LS1473219',
      navigatePath: '/agent/book-of-business/inforce-book/all-clients/policy-details?id=a73f1af893a94906b965e68d11db807b',
    },
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

    const dispatch = await claimNextConnectorCommand(repo, {
      agentId: 'agent_1',
      deviceId: 'device_1',
      now,
    })

    expect(dispatch).toMatchObject({
      nextEventSequence: 1,
      state: 'QUEUED',
      lastEventType: null,
      command: {
        commandId: 'cmd_1',
        capability: 'READ_POLICY_DETAIL',
        target: { kind: 'POLICY', id: 'policy_1' },
        params: { policyNumber: 'LS1473219' },
      },
    })
    expect(dispatch).not.toHaveProperty('payloadHash')
    expect(dispatch?.command).not.toHaveProperty('payloadHash')
  })

  it('redelivers a device-owned in-flight command with its durable event cursor', async () => {
    const repo = repository(candidate({
      state: 'AUTH_REQUIRED',
      events: [
        { sequence: 0, type: 'COMMAND_ACCEPTED' },
        { sequence: 1, type: 'COMMAND_STARTED' },
        { sequence: 2, type: 'AUTH_REQUIRED' },
      ],
    }))

    await expect(claimNextConnectorCommand(repo, {
      agentId: 'agent_1', deviceId: 'device_1', now,
    })).resolves.toMatchObject({
      state: 'AUTH_REQUIRED',
      nextEventSequence: 3,
      lastEventType: 'AUTH_REQUIRED',
      command: { commandId: 'cmd_1' },
    })
  })

  it('defensively refuses an unapproved carrier write', async () => {
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_1' },
      params: { illustrationId: 'illustration_1', inputHash: 'a'.repeat(64) },
      requiresConfirmation: true,
      confirmationState: 'PENDING',
    }))

    await expect(claimNextConnectorCommand(repo, {
      agentId: 'agent_1',
      deviceId: 'device_1',
      now,
    })).rejects.toThrowError('CONFIRMATION_REQUIRED')
  })

  it('returns the exact approved illustration snapshot only to its assigned device', async () => {
    const inputHash = 'placeholder'
    const illustration = {
      id: 'illustration_1',
      caseId: null,
      createdAt: new Date('2026-08-26T17:00:00.000Z'),
      productName: 'FlexLife',
      rawPayload: {
        request: {
          IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test',
          DateOfBirth: '01/01/1990', Gender: 'Male', RateClass: 'Standard_NT',
          SolveType: 'Specify_Amount', Amount: 100_000,
          DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
          Allocation: 100, ProductCode: '956',
        },
        response: { ok: true, faceAmount: 100_000, monthlyPremium: 250 },
      },
    }
    const { foresightIllustrationInputHash, buildForesightIllustrationSnapshot } = await import(
      '../foresight-illustration-contract'
    )
    const hash = foresightIllustrationInputHash(buildForesightIllustrationSnapshot(illustration))
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: illustration.id },
      params: { illustrationId: illustration.id, inputHash: hash },
      payloadHash: inputHash,
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
    }))
    const illustrationRepository = { findOwnedIllustration: vi.fn().mockResolvedValue(illustration) }

    await expect(readDeviceConnectorCommandInput(repo, illustrationRepository, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
    })).resolves.toMatchObject({ inputHash: hash, snapshot: { illustrationId: illustration.id } })
    expect(illustrationRepository.findOwnedIllustration).toHaveBeenCalledWith({
      agentId: 'agent_1', illustrationId: illustration.id,
    })

    await expect(readDeviceConnectorCommandInput(repo, illustrationRepository, {
      agentId: 'agent_1', deviceId: 'device_2', commandId: 'cmd_1', now,
    })).rejects.toThrow('COMMAND_NOT_FOUND')
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

  it('normalizes and persists a typed policy detail batch before accepting the event', async () => {
    const repo = repository(candidate({ events: [{ sequence: 0 }, { sequence: 1 }] }))
    const policyDetailRepository = {
      findOwnedPolicy: vi.fn(async () => ({ id: 'policy_1', policyNumber: 'LS1473219' })),
      persist: vi.fn(async () => undefined),
    } satisfies PolicyDetailRepository
    const event = {
      protocolVersion: 1,
      eventId: 'event_detail_1',
      commandId: 'cmd_1',
      runId: 'run_1',
      sequence: 2,
      type: 'DATA_BATCH',
      emittedAt: now.toISOString(),
      payload: {
        policyDetail: {
          navigatePath: '/agent/book-of-business/inforce-book/all-clients/policy-details?id=a73f1af893a94906b965e68d11db807b',
          expectedPolicyNumber: 'LS1473219',
          visiblePolicyNumber: 'LS1473219',
          observedAt: now.toISOString(),
          fields: [
            { section: 'COVERAGE', label: 'Total Face Amount', value: '$100,000.00' },
            { section: 'PAYMENTS', label: 'Anticipated Annual Premium', value: '$5,100.00' },
          ],
        },
      },
      error: null,
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', event, now,
      policyDetailRepository,
      deploymentScope: 'national-life-local-connector',
    })

    expect(policyDetailRepository.persist).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent_1',
      policyId: 'policy_1',
      detail: expect.objectContaining({
        policyNumber: 'LS1473219',
        totalFaceAmount: '100000.00',
        anticipatedAnnualPremium: '5100.00',
      }),
    }))
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, type: 'DATA_BATCH',
    }))
  })

  it('accepts an illustration receipt only after the exact PDF artifact is stored', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nverified')
    const documentSha256 = createHash('sha256').update(bytes).digest('hex')
    const inputHash = 'a'.repeat(64)
    const carrierCaseName = 'KEEPRONE-20260826-ILLUSTRATION1'
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_1' },
      params: { illustrationId: 'illustration_1', inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    const receipt = {
      inputHash,
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName,
      productCode: '956',
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256,
      documentBytes: bytes.byteLength,
      saved: true,
    }
    const event = {
      protocolVersion: 1, eventId: 'event_illustration_1', commandId: 'cmd_1', runId: 'run_1',
      sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
      payload: { illustration: receipt }, error: null,
    }
    const foresightArtifactRepository = {
      findOwnedArtifact: vi.fn().mockResolvedValue({
        provider: 'NATIONAL_LIFE_FORESIGHT',
        externalId: `agent_1:${carrierCaseName}`,
        documentBytes: bytes,
        documentMimeType: 'application/pdf',
      }),
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', event, now,
      foresightArtifactRepository,
    })
    expect(foresightArtifactRepository.findOwnedArtifact).toHaveBeenCalledWith({
      agentId: 'agent_1', illustrationId: 'illustration_1',
    })
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, type: 'DATA_BATCH', payload: { illustration: receipt },
    }))
  })

  it('refuses an illustration receipt when its PDF is absent', async () => {
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_1' },
      params: { illustrationId: 'illustration_1', inputHash: 'a'.repeat(64) },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    const event = {
      protocolVersion: 1, eventId: 'event_illustration_2', commandId: 'cmd_1', runId: 'run_1',
      sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
      payload: { illustration: {
        inputHash: 'a'.repeat(64), caseFingerprint: `case_${'b'.repeat(64)}`,
        carrierCaseName: 'KEEPRONE-20260826-ILLUSTRATION1', productCode: '956', release: '5.3.65.31',
        reportCode: 'NAIC_ILLUSTRATION', documentSha256: 'c'.repeat(64), documentBytes: 100, saved: true,
      } }, error: null,
    }
    await expect(recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', event, now,
      foresightArtifactRepository: { findOwnedArtifact: vi.fn().mockResolvedValue(null) },
    })).rejects.toThrow('EVENT_INVALID')
    expect(repo.appendEvent).not.toHaveBeenCalled()
  })
})
