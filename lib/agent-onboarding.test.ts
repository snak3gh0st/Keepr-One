import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgentAccess: vi.fn(),
  getCurrentAgent: vi.fn(),
  onboardingFindUnique: vi.fn(),
  onboardingUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/agent-access', () => ({
  getAgentAccessForAgent: mocks.getAgentAccess,
}))
vi.mock('@/lib/agent-context', () => ({
  getCurrentAgentWithoutOnboarding: mocks.getCurrentAgent,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}))

import {
  deriveAgentOnboardingStep,
  detectOnboardingIntegrations,
  getRequiredOnboardingModulesForAccess,
  ONBOARDING_STEPS,
  reconcileAgentOnboardingModules,
  reconcileAgentOnboardingForAgent,
  type AgentOnboardingRecord,
} from './agent-onboarding'

const now = new Date('2026-08-26T12:00:00.000Z')

function onboarding(
  overrides: Partial<AgentOnboardingRecord> = {},
): AgentOnboardingRecord {
  return {
    id: 'onboarding-1',
    agentId: 'agent-1',
    status: 'IN_PROGRESS',
    currentStep: 'WELCOME',
    welcomeCompletedAt: null,
    profileCompletedAt: null,
    nationalLifeVerifiedAt: null,
    nationalLifeVerificationSource: null,
    nationalLifeSkippedAt: null,
    calendarDecision: null,
    calendarDecidedAt: null,
    whatsappDecision: null,
    whatsappDecidedAt: null,
    requiredModules: ['TODAY', 'INTEGRATIONS'],
    completedModules: [],
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function integrationDb(input: {
  device?: object | null
  run?: object | null
  calendar?: object | null
  whatsapp?: object | null
}) {
  return {
    nationalLifeConnectorDevice: {
      findFirst: vi.fn().mockResolvedValue(input.device ?? null),
    },
    nationalLifeSyncRun: {
      findFirst: vi.fn().mockResolvedValue(input.run ?? null),
    },
    calendarIntegration: {
      findFirst: vi.fn().mockResolvedValue(input.calendar ?? null),
    },
    agentMessagingChannel: {
      findFirst: vi.fn().mockResolvedValue(input.whatsapp ?? null),
    },
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('agent onboarding contract', () => {
  it('exposes team only to agency-capable access and keeps integrations explicit', () => {
    const individual = getRequiredOnboardingModulesForAccess({
      canManageTeam: false,
      canAccessIntegrations: true,
    })
    const agency = getRequiredOnboardingModulesForAccess({
      canManageTeam: true,
      canAccessIntegrations: true,
    })

    expect(individual).toContain('INTEGRATIONS')
    expect(individual).not.toContain('TEAM')
    expect(agency).toEqual([...individual.slice(0, -1), 'TEAM', 'INTEGRATIONS'])
  })

  it('derives only the four effective steps from durable prerequisites', () => {
    const profile = onboarding({ currentStep: 'REVIEW' })
    expect(deriveAgentOnboardingStep(profile)).toBe('PROFILE')

    const nationalLife = onboarding({
      profileCompletedAt: now,
    })
    expect(deriveAgentOnboardingStep(nationalLife)).toBe('NATIONAL_LIFE')

    const calendar = onboarding({
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
    })
    expect(deriveAgentOnboardingStep(calendar)).toBe('CALENDAR')

    const skippedNationalLife = onboarding({
      profileCompletedAt: now,
      nationalLifeSkippedAt: now,
    })
    expect(deriveAgentOnboardingStep(skippedNationalLife)).toBe('CALENDAR')

    const whatsapp = onboarding({
      ...calendar,
      calendarDecision: 'SKIPPED',
    })
    expect(deriveAgentOnboardingStep(whatsapp)).toBe('WHATSAPP')

    const legacyReview = onboarding({
      ...whatsapp,
      whatsappDecision: 'CONNECTED',
      currentStep: 'REVIEW',
    })
    expect(deriveAgentOnboardingStep(legacyReview)).toBe('WHATSAPP')
    expect(deriveAgentOnboardingStep({
      ...legacyReview,
      completedModules: ['TODAY', 'INTEGRATIONS'],
    })).toBe('WHATSAPP')
    expect(deriveAgentOnboardingStep({
      ...legacyReview,
      status: 'COMPLETED',
    })).toBe('COMPLETED')
    expect(ONBOARDING_STEPS).toEqual([
      'PROFILE',
      'NATIONAL_LIFE',
      'CALENDAR',
      'WHATSAPP',
      'COMPLETED',
    ])
  })

  it('reconciles capability changes without reopening the removed module tour', () => {
    const review = onboarding({
      currentStep: 'REVIEW',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      calendarDecision: 'SKIPPED',
      whatsappDecision: 'SKIPPED',
      completedModules: ['TODAY', 'INTEGRATIONS'],
    })
    const upgraded = reconcileAgentOnboardingModules(
      review,
      ['TODAY', 'TEAM', 'INTEGRATIONS'],
    )
    expect(upgraded).toMatchObject({
      currentStep: 'WHATSAPP',
      requiredModules: ['TODAY', 'TEAM', 'INTEGRATIONS'],
      completedModules: ['TODAY', 'INTEGRATIONS'],
    })

    const downgraded = reconcileAgentOnboardingModules(
      upgraded,
      ['TODAY', 'INTEGRATIONS'],
    )
    expect(downgraded).toMatchObject({
      currentStep: 'WHATSAPP',
      requiredModules: ['TODAY', 'INTEGRATIONS'],
      completedModules: ['TODAY', 'INTEGRATIONS'],
    })
  })

  it('persists capability reconciliation when the onboarding page loads', async () => {
    const current = onboarding({
      currentStep: 'REVIEW',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      calendarDecision: 'SKIPPED',
      whatsappDecision: 'SKIPPED',
      completedModules: ['TODAY', 'INTEGRATIONS'],
    })
    mocks.getAgentAccess.mockResolvedValue({ canManageTeam: true })
    mocks.onboardingFindUnique.mockResolvedValue(current)
    mocks.onboardingUpdate.mockImplementation(async ({ data }) => ({
      ...current,
      ...data,
    }))
    mocks.transaction.mockImplementation(async (operation) => operation({
      agentOnboarding: {
        findUnique: mocks.onboardingFindUnique,
        update: mocks.onboardingUpdate,
      },
    }))

    const result = await reconcileAgentOnboardingForAgent('agent-1')

    expect(result).toMatchObject({
      currentStep: 'WHATSAPP',
      requiredModules: expect.arrayContaining(['TEAM', 'INTEGRATIONS']),
    })
    expect(mocks.onboardingUpdate).toHaveBeenCalledWith({
      where: { id: 'onboarding-1' },
      data: expect.objectContaining({ currentStep: 'WHATSAPP' }),
      select: expect.any(Object),
    })
  })

  it('accepts National Life only after a complete canonical local sync', async () => {
    const db = integrationDb({
      device: { id: 'device-1' },
      run: {
        completedAt: now,
        totalStages: 2,
        completedStages: 2,
        failedStages: 0,
        plannedGridKeys: ['CASES', 'COMMISSIONS'],
        stageCompletions: [
          {
            gridKey: 'CASES',
            expectedRecordCount: 2,
            receivedRecordCount: 2,
            truncated: false,
          },
          {
            gridKey: 'COMMISSIONS',
            expectedRecordCount: 1,
            receivedRecordCount: 1,
            truncated: false,
          },
        ],
      },
    })

    await expect(detectOnboardingIntegrations(
      { agentId: 'agent-1', userId: 'user-1' },
      db as never,
    )).resolves.toMatchObject({ nationalLife: 'VERIFIED_SYNC' })
    expect(db.nationalLifeSyncRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: 'NATIONAL_LIFE',
          deploymentScope: 'LOCAL_CONNECTOR',
          executionSource: 'LOCAL',
          state: 'COMPLETED',
        }),
      }),
    )
  })

  it('distinguishes pairing from verified sync and rejects partial stage evidence', async () => {
    const db = integrationDb({
      device: { id: 'device-1' },
      run: {
        completedAt: now,
        totalStages: 1,
        completedStages: 1,
        failedStages: 0,
        plannedGridKeys: ['CASES'],
        stageCompletions: [{
          gridKey: 'CASES',
          expectedRecordCount: 2,
          receivedRecordCount: 1,
          truncated: false,
        }],
      },
    })

    await expect(detectOnboardingIntegrations(
      { agentId: 'agent-1', userId: 'user-1' },
      db as never,
    )).resolves.toMatchObject({ nationalLife: 'CONNECTOR_PAIRED' })
  })

  it('requires provider-specific durable WhatsApp identity', async () => {
    vi.stubEnv('WHATSAPP_CHANNEL_MODE', 'META_CLOUD')
    const db = integrationDb({ whatsapp: { id: 'channel-1' } })

    await expect(detectOnboardingIntegrations(
      { agentId: 'agent-1', userId: 'user-1' },
      db as never,
    )).resolves.toMatchObject({ whatsappConnected: true })
    expect(db.agentMessagingChannel.findFirst).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        kind: 'WHATSAPP',
        provider: 'META_CLOUD',
        status: 'CONNECTED',
        verifiedAt: { not: null },
        normalizedPhoneE164: { not: null },
        externalInboxId: { not: null },
      },
      select: { id: true },
    })
  })
})
