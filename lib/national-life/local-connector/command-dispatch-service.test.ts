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

    await expect(readDeviceConnectorCommandInput(repo, illustrationRepository, {}, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
    })).resolves.toMatchObject({ inputHash: hash, snapshot: { illustrationId: illustration.id } })
    expect(illustrationRepository.findOwnedIllustration).toHaveBeenCalledWith({
      agentId: 'agent_1', illustrationId: illustration.id,
    })

    await expect(readDeviceConnectorCommandInput(repo, illustrationRepository, {}, {
      agentId: 'agent_1', deviceId: 'device_2', commandId: 'cmd_1', now,
    })).rejects.toThrow('COMMAND_NOT_FOUND')
  })

  it('returns the selected Term carrier and duration without inventing an agent premium', async () => {
    const illustration = {
      id: 'illustration_term_1',
      caseId: null,
      createdAt: now,
      productName: 'LSW Term',
      rawPayload: {
        foresightTermDraft: {
          schemaVersion: 1,
          carrierProduct: 'LSW Term',
          firstName: 'KeeprOne', lastName: 'Term', dateOfBirth: '1990-01-01', issueState: 'FL',
          gender: 'Male', rateClass: 'Standard_NT', faceAmount: 250_000,
          premiumMode: 'Monthly', termDuration: '20-G',
        },
      },
    }
    const { buildForesightTermIllustrationSnapshot, foresightTermIllustrationInputHash } = await import(
      '../foresight-term-contract'
    )
    const snapshot = buildForesightTermIllustrationSnapshot(illustration)
    const inputHash = foresightTermIllustrationInputHash(snapshot)
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: illustration.id },
      params: { illustrationId: illustration.id, inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
    }))

    await expect(readDeviceConnectorCommandInput(repo, {
      findOwnedIllustration: vi.fn().mockResolvedValue(illustration),
    }, {}, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
    })).resolves.toEqual({ inputHash, snapshot })
  })

  it('returns the sealed FlexLife quote request to the assigned device', async () => {
    const illustration = {
      id: 'illustration_quote_1',
      caseId: null,
      createdAt: now,
      productName: 'FlexLife',
      rawPayload: {
        request: {
          IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test',
          DateOfBirth: '08/26/1981', IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT',
          SolveType: 'Specify_Amount', Amount: 250_000, DeathBenefitOption: 'A_Level',
          Strategy: 'SP500PointToPointCapFocus', Allocation: 100, ProductCode: '956',
          PremiumMode: 'Monthly',
        },
      },
    }
    const { buildFlexLifeQuoteSnapshot, flexLifeQuoteInputHash } = await import(
      '../flexlife-quote-contract'
    )
    const snapshot = buildFlexLifeQuoteSnapshot(illustration)
    const inputHash = flexLifeQuoteInputHash(snapshot)
    const repo = repository(candidate({
      capability: 'FLEXLIFE_QUOTE',
      target: { kind: 'ILLUSTRATION', id: illustration.id },
      params: { illustrationId: illustration.id, inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
    }))
    const illustrationRepository = { findOwnedIllustration: vi.fn().mockResolvedValue(illustration) }

    await expect(readDeviceConnectorCommandInput(repo, illustrationRepository, {}, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
    })).resolves.toEqual({ inputHash, snapshot })
  })

  it('returns only the reviewed Application dossier sealed to the approved hash', async () => {
    const { sha256ApplicationDossierV2 } = await import('@/lib/application-addon/dossier-contract')
    const dossier = {
      version: 2 as const,
      insured: {
        firstName: 'Keepr', lastName: 'Test', birthDate: '1990-01-01',
        sexAtBirth: 'MALE' as const, email: 'keepr@example.com', phone: '+13055550123',
      },
      address: { line1: '1 Main St', city: 'Miami', state: 'FL', postalCode: '33101' },
      owner: { sameAsInsured: true, relationship: 'SELF' as const },
      beneficiaries: [{ fullName: 'Test Beneficiary', relationship: 'Spouse', sharePercent: 100 }],
      coverage: {
        family: 'IUL' as const, carrierProduct: 'FlexLife (25)(LSW)' as const,
        issueState: 'FL', applicationType: 'FULL' as const,
        illustrationId: 'illustration_1', illustrationInputHash: 'b'.repeat(64),
        faceAmount: 250_000, premiumMode: 'MONTHLY' as const, plannedPremium: 500,
      },
      agent: { carrierNumber: 'AGENT123' },
      existingCoverage: { hasExisting: false, replacementExpected: false },
      documents: [{ documentId: 'doc_1', type: 'IDENTITY' as const, contentHash: 'c'.repeat(64) }],
      consent: { clientAuthorizedCollection: true, agentAttestedAccuracy: true },
    }
    const payloadHash = sha256ApplicationDossierV2(dossier)
    const repo = repository(candidate({
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'application_1' },
      params: { applicationId: 'application_1', payloadHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
    }))
    const applicationRepository = {
      findOwnedApplication: vi.fn().mockResolvedValue({
        id: 'application_1', automationState: 'PREPARING_DRAFT', dossier,
        dossierHash: payloadHash, reviewedAt: now,
      }),
    }

    await expect(readDeviceConnectorCommandInput(
      repo,
      { findOwnedIllustration: vi.fn() },
      applicationRepository,
      { agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now },
    )).resolves.toEqual({
      inputHash: payloadHash,
      snapshot: { schemaVersion: 2, applicationId: 'application_1', payloadHash, dossier },
    })
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
    const syncPolicyDetailPromotionCreditsSafely = vi.fn(async () => undefined)
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
            { section: 'PAYMENTS', label: 'CTP', value: '$4,900.00' },
          ],
        },
      },
      error: null,
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', event, now,
      policyDetailRepository,
      syncPolicyDetailPromotionCreditsSafely,
      deploymentScope: 'national-life-local-connector',
    })

    expect(policyDetailRepository.persist).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent_1',
      policyId: 'policy_1',
      detail: expect.objectContaining({
        policyNumber: 'LS1473219',
        totalFaceAmount: '100000.00',
        anticipatedAnnualPremium: '5100.00',
        ctp: '4900.00',
      }),
    }))
    expect(syncPolicyDetailPromotionCreditsSafely).toHaveBeenCalledWith({
      agentId: 'agent_1',
      deploymentScope: 'national-life-local-connector',
      policyNumber: 'LS1473219',
      fetchedAt: now,
    })
    expect(policyDetailRepository.persist.mock.invocationCallOrder[0]).toBeLessThan(
      syncPolicyDetailPromotionCreditsSafely.mock.invocationCallOrder[0] as number,
    )
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
        productName: 'FlexLife',
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

  it('persists only the Foresight-calculated IUL result after its PDF is verified', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nsolved')
    const inputHash = 'a'.repeat(64)
    const carrierCaseName = 'KEEPRONE-20260827-ILLSOLVED123'
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_solved_1' },
      params: { illustrationId: 'illustration_solved_1', inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    const receipt = {
      inputHash,
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName,
      productCode: '956',
      solveBasis: 'PREMIUM',
      faceAmount: 250_000,
      monthlyPremium: 350,
      annualPremium: 4_200,
      quickReview: {
        evidence: {
          source: 'FORESIGHT_QUICK_VIEW', observedAt: '2026-09-02T18:00:00.000Z',
          sourceRows: [['Initial Face Amount', 'Target Premium'], ['$250,000.00', '$4,000.00']],
        },
        summary: {
          initialFaceAmount: 250_000, lapseYear: 0, mecYear: 0, modalPremium: 350,
          minimumPremium: 100, deathBenefitProtectionPremium: 120, targetPremium: 4_000,
          mecPremium: 20_000, guidelineLevelPremium: 5_000, guidelineSinglePremium: 80_000,
        },
        annualProjection: [{
          policyYear: 1, age: 31, premiumOutlay: 4_200, weightedAverageInterestRate: 5.5,
          loan: 0, annualIncome: 0, accumulatedValue: 3_000, cashSurrenderValue: 2_000,
          netDeathBenefit: 252_000,
        }],
      },
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: createHash('sha256').update(bytes).digest('hex'),
      documentBytes: bytes.byteLength,
      saved: true,
    } as const
    const foresightArtifactRepository = {
      findOwnedArtifact: vi.fn().mockResolvedValue({
        provider: 'NATIONAL_LIFE_FORESIGHT', externalId: `agent_1:${carrierCaseName}`,
        productName: 'FlexLife', documentBytes: bytes, documentMimeType: 'application/pdf',
      }),
      persistSolvedResult: vi.fn().mockResolvedValue(undefined),
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
      event: {
        protocolVersion: 1, eventId: 'event_solved_1', commandId: 'cmd_1', runId: 'run_1',
        sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
        payload: { illustration: receipt }, error: null,
      },
      foresightArtifactRepository,
    })

    expect(foresightArtifactRepository.persistSolvedResult).toHaveBeenCalledWith({
      agentId: 'agent_1', illustrationId: 'illustration_solved_1',
      solveBasis: 'PREMIUM', faceAmount: 250_000, monthlyPremium: 350, annualPremium: 4_200,
      quickReview: receipt.quickReview,
    })
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, type: 'DATA_BATCH',
    }))
  })

  it('accepts a Term PDF receipt only after the same named carrier artifact is stored', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nterm')
    const inputHash = 'a'.repeat(64)
    const carrierCaseName = 'KEEPRONE-20260827-ILLTERM123'
    const receipt = {
      inputHash,
      caseFingerprint: `case_${'b'.repeat(64)}`,
      carrierCaseName,
      carrierProduct: 'NL Term',
      requestedTermDuration: '20-G',
      confirmedTermDuration: '15-G',
      release: '5.3.65.31',
      reportCode: 'NAIC_ILLUSTRATION',
      documentSha256: createHash('sha256').update(bytes).digest('hex'),
      documentBytes: bytes.byteLength,
      saved: true,
    }
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_term_1' },
      params: { illustrationId: 'illustration_term_1', inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    const extractTermPremiums = vi.fn().mockResolvedValue({
      monthlyPremium: 62.92,
      annualPremium: 755.04,
    })
    const persistTermResult = vi.fn().mockResolvedValue(undefined)
    const event = {
      protocolVersion: 1, eventId: 'event_term_illustration_1', commandId: 'cmd_1', runId: 'run_1',
      sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
      payload: { illustration: receipt }, error: null,
    }
    await expect(recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', event, now,
      foresightArtifactRepository: {
        findOwnedArtifact: vi.fn().mockResolvedValue({
          provider: 'NATIONAL_LIFE_FORESIGHT', externalId: `agent_1:${carrierCaseName}`,
          productName: 'NL Term', documentBytes: bytes, documentMimeType: 'application/pdf',
        }),
        persistTermResult,
      },
      extractTermPremiums,
    })).resolves.toBeUndefined()
    expect(extractTermPremiums).toHaveBeenCalledWith(bytes)
    expect(persistTermResult).toHaveBeenCalledWith({
      agentId: 'agent_1', illustrationId: 'illustration_term_1',
      monthlyPremium: 62.92, annualPremium: 755.04,
      requestedTermDuration: '20-G', confirmedTermDuration: '15-G',
    })
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({ payload: { illustration: receipt } }))
  })

  it('keeps a safe Term PDF reconciliation failure specific for the extension retry state', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nterm')
    const inputHash = 'a'.repeat(64)
    const carrierCaseName = 'KEEPRONE-20260901-ILLTERMFAIL'
    const persistTermResult = vi.fn()
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'illustration_term_failure_1' },
      params: { illustrationId: 'illustration_term_failure_1', inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))

    await expect(recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
      event: {
        protocolVersion: 1, eventId: 'event_term_failure_1', commandId: 'cmd_1', runId: 'run_1',
        sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
        payload: {
          illustration: {
            inputHash, caseFingerprint: `case_${'b'.repeat(64)}`,
            carrierCaseName, carrierProduct: 'NL Term',
            release: '5.3.65.31', reportCode: 'NAIC_ILLUSTRATION',
            documentSha256: createHash('sha256').update(bytes).digest('hex'),
            documentBytes: bytes.byteLength, saved: true,
          },
        },
        error: null,
      },
      foresightArtifactRepository: {
        findOwnedArtifact: vi.fn().mockResolvedValue({
          provider: 'NATIONAL_LIFE_FORESIGHT', externalId: `agent_1:${carrierCaseName}`,
          productName: 'NL Term', documentBytes: bytes, documentMimeType: 'application/pdf',
        }),
        persistTermResult,
      },
      extractTermPremiums: vi.fn().mockRejectedValue(new Error('FORESIGHT_TERM_PREMIUM_MISSING')),
    })).rejects.toMatchObject({ code: 'FORESIGHT_TERM_PREMIUM_MISSING' })

    expect(persistTermResult).not.toHaveBeenCalled()
    expect(repo.appendEvent).not.toHaveBeenCalled()
  })

  it('persists an iGO draft read-back and carrier questions before accepting the event', async () => {
    const payloadHash = 'a'.repeat(64)
    const receipt = {
      schemaVersion: 2,
      applicationId: 'application_1', payloadHash, draftReadBackHash: 'b'.repeat(64),
      externalApplicationId: 'IGO-123', carrierStatus: 'Draft', progress: 'APPLICATION_PARTIAL',
      confirmedValues: {
        insuredName: 'Keepr Test', birthDate: '1990-01-01', family: 'IUL',
        carrierProduct: 'FlexLife (25)(LSW)', termDuration: null, issueState: 'FL',
        applicationType: 'FULL', agentNumber: 'AGENT123', illustrationId: 'illustration_1',
        faceAmount: 250_000, plannedPremium: 500, premiumMode: 'MONTHLY',
      },
      changes: [],
      missingQuestions: [{ section: 'Medical', label: 'Has the client used tobacco?' }],
    }
    const repo = repository(candidate({
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'application_1' },
      params: { applicationId: 'application_1', payloadHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    const applicationDraftReceiptRepository = {
      persistOwnedDraftReceipt: vi.fn().mockResolvedValue(undefined),
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
      event: {
        protocolVersion: 1, eventId: 'event_application_1', commandId: 'cmd_1', runId: 'run_1',
        sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
        payload: { applicationDraft: receipt }, error: null,
      },
      applicationDraftReceiptRepository,
    })

    expect(applicationDraftReceiptRepository.persistOwnedDraftReceipt).toHaveBeenCalledWith({
      agentId: 'agent_1', applicationId: 'application_1', receipt,
    })
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, type: 'DATA_BATCH', payload: { applicationDraft: receipt },
    }))
  })

  it('does not complete an Application command without a carrier read-back', async () => {
    const repo = repository(candidate({
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'application_1' },
      params: { applicationId: 'application_1', payloadHash: 'a'.repeat(64) },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0, type: 'COMMAND_ACCEPTED' }, { sequence: 1, type: 'COMMAND_STARTED' }],
    }))

    await expect(recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
      event: {
        protocolVersion: 1, eventId: 'event_application_done', commandId: 'cmd_1', runId: 'run_1',
        sequence: 2, type: 'COMMAND_COMPLETED', emittedAt: now.toISOString(), payload: null, error: null,
      },
    })).rejects.toThrow('EVENT_INVALID')
  })

  it('moves only the owned Application to a safe failed state after executor failure', async () => {
    const repo = repository(candidate({
      capability: 'PREPARE_APPLICATION_DRAFT',
      target: { kind: 'APPLICATION', id: 'application_1' },
      params: { applicationId: 'application_1', payloadHash: 'a'.repeat(64) },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0, type: 'COMMAND_ACCEPTED' }, { sequence: 1, type: 'COMMAND_STARTED' }],
    }))
    const applicationDraftReceiptRepository = {
      persistOwnedDraftReceipt: vi.fn(),
      persistOwnedDraftFailure: vi.fn().mockResolvedValue(undefined),
    }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
      event: {
        protocolVersion: 1, eventId: 'event_application_failed', commandId: 'cmd_1', runId: 'run_1',
        sequence: 2, type: 'COMMAND_FAILED', emittedAt: now.toISOString(), payload: null,
        error: { code: 'IGO_REQUIRED_FIELD_UNKNOWN', safeMessage: 'O iGO pediu uma resposta que ainda não foi mapeada.' },
      },
      applicationDraftReceiptRepository,
    })

    expect(applicationDraftReceiptRepository.persistOwnedDraftFailure).toHaveBeenCalledWith({
      agentId: 'agent_1', applicationId: 'application_1', safeErrorCode: 'IGO_REQUIRED_FIELD_UNKNOWN',
    })
  })

  it('refuses a Term receipt when it names a carrier other than the persisted illustration', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\nterm')
    const inputHash = 'a'.repeat(64)
    const carrierCaseName = 'KEEPRONE-20260827-ILLTERM123'
    const repo = repository(candidate({
      capability: 'GENERATE_ILLUSTRATION', target: { kind: 'ILLUSTRATION', id: 'illustration_term_1' },
      params: { illustrationId: 'illustration_term_1', inputHash }, requiresConfirmation: true,
      confirmationState: 'APPROVED', events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    await expect(recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', now,
      event: {
        protocolVersion: 1, eventId: 'event_term_carrier_mismatch', commandId: 'cmd_1', runId: 'run_1',
        sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(), error: null,
        payload: { illustration: {
          inputHash, caseFingerprint: `case_${'b'.repeat(64)}`, carrierCaseName, carrierProduct: 'NL Term',
          requestedTermDuration: '20-G', confirmedTermDuration: '20-G',
          release: '5.3.65.31', reportCode: 'NAIC_ILLUSTRATION',
          documentSha256: createHash('sha256').update(bytes).digest('hex'), documentBytes: bytes.byteLength, saved: true,
        } },
      },
      foresightArtifactRepository: {
        findOwnedArtifact: vi.fn().mockResolvedValue({
          provider: 'NATIONAL_LIFE_FORESIGHT', externalId: `agent_1:${carrierCaseName}`,
          productName: 'LSW Term', documentBytes: bytes, documentMimeType: 'application/pdf',
        }),
      },
    })).rejects.toThrow('EVENT_INVALID')
  })

  it('persists a carrier quote only after its sealed input hash matches', async () => {
    const inputHash = 'd'.repeat(64)
    const repo = repository(candidate({
      capability: 'FLEXLIFE_QUOTE',
      target: { kind: 'ILLUSTRATION', id: 'illustration_quote_1' },
      params: { illustrationId: 'illustration_quote_1', inputHash },
      requiresConfirmation: true,
      confirmationState: 'APPROVED',
      events: [{ sequence: 0 }, { sequence: 1 }],
    }))
    const rawResponse = {
      Success: true,
      FaceAmount: '$250,000.00',
      AnnualPremium: '$4,200.00',
      MonthlyPremium: '$350.00',
      LapseYear: 0,
    }
    const event = {
      protocolVersion: 1, eventId: 'event_quote_1', commandId: 'cmd_1', runId: 'run_1',
      sequence: 2, type: 'DATA_BATCH', emittedAt: now.toISOString(),
      payload: { flexLifeQuote: { inputHash, response: rawResponse } }, error: null,
    }
    const flexLifeQuoteRepository = { persistOwnedQuoteResult: vi.fn().mockResolvedValue(undefined) }

    await recordDeviceConnectorCommandEvent(repo, {
      agentId: 'agent_1', deviceId: 'device_1', commandId: 'cmd_1', event, now,
      flexLifeQuoteRepository,
    })

    expect(flexLifeQuoteRepository.persistOwnedQuoteResult).toHaveBeenCalledWith({
      agentId: 'agent_1',
      illustrationId: 'illustration_quote_1',
      inputHash,
      response: rawResponse,
    })
    expect(repo.appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      sequence: 2, type: 'DATA_BATCH',
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
