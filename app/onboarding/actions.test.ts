import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentOnboardingRecord } from '@/lib/agent-onboarding'

const mocks = vi.hoisted(() => ({
  requireRoleWithoutOnboarding: vi.fn(),
  agentFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  transaction: vi.fn(),
  onboardingFindUnique: vi.fn(),
  onboardingUpdate: vi.fn(),
  userUpdate: vi.fn(),
  agentUpdate: vi.fn(),
  invitationUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  detectIntegrations: vi.fn(),
  getRequiredModules: vi.fn(),
  updateAuthUser: vi.fn(),
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/lib/require-role', () => ({
  requireRoleWithoutOnboarding: mocks.requireRoleWithoutOnboarding,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: mocks.agentFindUnique },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}))
vi.mock('@/lib/auth', () => ({
  auth: { api: { updateUser: mocks.updateAuthUser } },
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/agent-onboarding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-onboarding')>()
  return {
    ...actual,
    detectOnboardingIntegrations: mocks.detectIntegrations,
    getRequiredOnboardingModulesForAgent: mocks.getRequiredModules,
  }
})

import {
  completeOnboardingAction,
  markOnboardingModuleAction,
  saveOnboardingProfileAction,
  setCalendarOnboardingDecisionAction,
  verifyNationalLifeOnboardingAction,
} from './actions'
import { INITIAL_ONBOARDING_ACTION_STATE } from './state'

const now = new Date('2026-08-26T12:00:00.000Z')
const requiredModules = ['TODAY', 'INTEGRATIONS'] as const
let current: AgentOnboardingRecord

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
    calendarDecision: null,
    calendarDecidedAt: null,
    whatsappDecision: null,
    whatsappDecidedAt: null,
    requiredModules: [...requiredModules],
    completedModules: [],
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const transactionClient = {
  agentOnboarding: {
    findUnique: mocks.onboardingFindUnique,
    update: mocks.onboardingUpdate,
  },
  user: { update: mocks.userUpdate },
  agent: { update: mocks.agentUpdate },
  agencyInvitation: { updateMany: mocks.invitationUpdateMany },
  auditLog: { create: mocks.auditCreate },
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  current = onboarding()
  mocks.requireRoleWithoutOnboarding.mockResolvedValue({
    user: { id: 'user-1', role: 'AGENT' },
  })
  mocks.agentFindUnique.mockResolvedValue({
    id: 'agent-1',
    userId: 'user-1',
    status: 'ACTIVE',
  })
  mocks.userFindUnique.mockResolvedValue({
    name: 'Maria Agent',
    timeZone: 'America/New_York',
    agent: { phone: '+13055550100', npn: '1234567' },
  })
  mocks.onboardingFindUnique.mockImplementation(async () => current)
  mocks.onboardingUpdate.mockImplementation(async ({ data }: {
    data: Partial<AgentOnboardingRecord>
  }) => {
    current = { ...current, ...data, updatedAt: now }
    return current
  })
  mocks.transaction.mockImplementation(async (
    callback: (transaction: typeof transactionClient) => unknown,
  ) => callback(transactionClient))
  mocks.detectIntegrations.mockResolvedValue({
    nationalLife: 'NOT_CONNECTED',
    calendarConnected: false,
    whatsappConnected: false,
  })
  mocks.getRequiredModules.mockResolvedValue([...requiredModules])
  mocks.invitationUpdateMany.mockResolvedValue({ count: 0 })
  mocks.headers.mockResolvedValue(new Headers())
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('onboarding server actions', () => {
  it('requires a 4–20 digit NPN before doing authenticated or database work', async () => {
    const result = await saveOnboardingProfileAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({
        name: 'Maria Agent',
        phone: '+1 305 555 0100',
        timeZone: 'America/New_York',
        npn: '',
      }),
    )

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { npn: 'Informe seu NPN.' },
    })
    expect(mocks.requireRoleWithoutOnboarding).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('saves profile fields in the authenticated agent tenant and audits the change', async () => {
    current = onboarding({
      currentStep: 'PROFILE',
      welcomeCompletedAt: now,
    })

    const result = await saveOnboardingProfileAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({
        name: 'Maria Agent',
        phone: '+1 (407) 555-0199',
        timeZone: 'America/Chicago',
        npn: '7654321',
      }),
    )

    expect(result).toMatchObject({
      status: 'success',
      onboarding: { currentStep: 'NATIONAL_LIFE' },
    })
    expect(mocks.agentUpdate).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { phone: '+14075550199', npn: '7654321' },
    })
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Maria Agent',
        timeZone: 'America/Chicago',
      },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        action: 'AGENT_ONBOARDING_PROFILE_SAVED',
        entityId: 'onboarding-1',
        after: {
          changedFields: ['phone', 'timeZone', 'npn'],
          phoneLast4: '0199',
          npnLast4: '4321',
          currentStep: 'NATIONAL_LIFE',
        },
      }),
    })
    const auditPayload = JSON.stringify(mocks.auditCreate.mock.calls[0]?.[0])
    expect(auditPayload).not.toContain('+14075550199')
    expect(auditPayload).not.toContain('7654321')
  })

  it('keeps the atomic profile commit when the post-commit auth cache refresh fails', async () => {
    current = onboarding({
      currentStep: 'PROFILE',
      welcomeCompletedAt: now,
    })
    mocks.userFindUnique.mockResolvedValue({
      name: 'Nome Antigo',
      timeZone: 'America/New_York',
      agent: { phone: '+13055550100', npn: '1234567' },
    })
    mocks.updateAuthUser.mockRejectedValue(new Error('session cache unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await saveOnboardingProfileAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({
        name: 'Nome Atualizado',
        phone: '+1 305 555 0100',
        timeZone: 'America/New_York',
        npn: '1234567',
      }),
    )

    expect(result).toMatchObject({ status: 'success' })
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        name: 'Nome Atualizado',
        timeZone: 'America/New_York',
      },
    })
    expect(mocks.updateAuthUser).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      'Onboarding auth profile refresh failed',
      expect.any(Error),
    )
    consoleError.mockRestore()
  })

  it('never accepts a client boolean as National Life verification evidence', async () => {
    current = onboarding({
      currentStep: 'NATIONAL_LIFE',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
    })
    mocks.detectIntegrations.mockResolvedValue({
      nationalLife: 'CONNECTOR_PAIRED',
      calendarConnected: false,
      whatsappConnected: false,
    })

    const result = await verifyNationalLifeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ verified: 'true', nationalLifeConnected: 'true' }),
    )

    expect(result).toMatchObject({
      status: 'error',
      message: expect.stringContaining('sincronização verificada'),
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.onboardingUpdate).not.toHaveBeenCalled()
  })

  it('rejects optional CONNECTED without durable provider state', async () => {
    current = onboarding({
      currentStep: 'CALENDAR',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
    })

    const result = await setCalendarOnboardingDecisionAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ decision: 'CONNECTED' }),
    )

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { decision: expect.stringContaining('conexão real') },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('rejects module writes before the MODULES step even with a valid whitelist item', async () => {
    current = onboarding({ currentStep: 'WELCOME' })

    const result = await markOnboardingModuleAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ module: 'TODAY' }),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Conclua a etapa atual antes de continuar.',
    })
    expect(mocks.onboardingUpdate).not.toHaveBeenCalled()
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('reopens MODULES after an entitlement upgrade and accepts the newly required module', async () => {
    current = onboarding({
      currentStep: 'REVIEW',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      calendarDecision: 'SKIPPED',
      whatsappDecision: 'SKIPPED',
      completedModules: [...requiredModules],
    })
    mocks.getRequiredModules.mockResolvedValue(['TODAY', 'TEAM', 'INTEGRATIONS'])

    const result = await markOnboardingModuleAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ module: 'TEAM' }),
    )

    expect(result).toMatchObject({
      status: 'success',
      onboarding: {
        currentStep: 'REVIEW',
        requiredModules: ['TODAY', 'TEAM', 'INTEGRATIONS'],
        completedModules: ['TODAY', 'INTEGRATIONS', 'TEAM'],
      },
    })
  })

  it('drops a no-longer-exposed module and completes after an entitlement downgrade', async () => {
    current = onboarding({
      currentStep: 'MODULES',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      nationalLifeVerificationSource: 'LOCAL_CONNECTOR_SYNC',
      calendarDecision: 'SKIPPED',
      calendarDecidedAt: now,
      whatsappDecision: 'SKIPPED',
      whatsappDecidedAt: now,
      requiredModules: ['TODAY', 'TEAM', 'INTEGRATIONS'],
      completedModules: ['TODAY', 'INTEGRATIONS'],
    })

    await expect(completeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.onboardingUpdate).toHaveBeenCalledWith({
      where: { id: 'onboarding-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        requiredModules: ['TODAY', 'INTEGRATIONS'],
        completedModules: ['TODAY', 'INTEGRATIONS'],
      }),
    })
  })

  it('completes transactionally only from REVIEW and redirects after commit', async () => {
    current = onboarding({
      currentStep: 'REVIEW',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      nationalLifeVerificationSource: 'LOCAL_CONNECTOR_SYNC',
      calendarDecision: 'SKIPPED',
      calendarDecidedAt: now,
      whatsappDecision: 'SKIPPED',
      whatsappDecidedAt: now,
      completedModules: [...requiredModules],
    })

    await expect(completeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.onboardingUpdate).toHaveBeenCalledWith({
      where: { id: 'onboarding-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
        completedAt: now,
        completedModules: [...requiredModules],
      }),
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AGENT_ONBOARDING_COMPLETED',
        userId: 'user-1',
      }),
    })
    expect(mocks.redirect).toHaveBeenCalledWith('/agent')
  })

  it('activates accepted recruitment links with a current membership in the completion transaction', async () => {
    current = onboarding({
      currentStep: 'REVIEW',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      nationalLifeVerificationSource: 'LOCAL_CONNECTOR_SYNC',
      calendarDecision: 'SKIPPED',
      calendarDecidedAt: now,
      whatsappDecision: 'SKIPPED',
      whatsappDecidedAt: now,
      completedModules: [...requiredModules],
    })
    mocks.invitationUpdateMany.mockResolvedValue({ count: 2 })

    await expect(completeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.invitationUpdateMany).toHaveBeenCalledWith({
      where: {
        acceptedAgentId: 'agent-1',
        status: 'ACCEPTED',
        recruitmentStage: 'ONBOARDING',
        acceptedMembership: {
          agentId: 'agent-1',
          endedAt: null,
        },
      },
      data: {
        recruitmentStage: 'ACTIVE',
        stageUpdatedAt: now,
      },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AGENT_ONBOARDING_COMPLETED',
        after: expect.objectContaining({
          activatedRecruitmentInvitations: 2,
        }),
      }),
    })
  })
})
