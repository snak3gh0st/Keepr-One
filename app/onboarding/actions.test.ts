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
  syncRunUpdateManyAndReturn: vi.fn(),
  syncRunFindMany: vi.fn(),
  exportUploadUpdateMany: vi.fn(),
  notificationUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  detectIntegrations: vi.fn(),
  getRequiredModules: vi.fn(),
  updateAuthUser: vi.fn(),
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  getServerI18n: vi.fn(),
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
vi.mock('@/lib/i18n/server', () => ({ getServerI18n: mocks.getServerI18n }))
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
  setWhatsAppOnboardingDecisionAction,
  skipNationalLifeOnboardingAction,
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
    nationalLifeSkippedAt: null,
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
  nationalLifeSyncRun: {
    updateManyAndReturn: mocks.syncRunUpdateManyAndReturn,
    findMany: mocks.syncRunFindMany,
  },
  nationalLifeExportUpload: { updateMany: mocks.exportUploadUpdateMany },
  notification: { updateMany: mocks.notificationUpdateMany },
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
  mocks.syncRunUpdateManyAndReturn.mockResolvedValue([])
  mocks.syncRunFindMany.mockResolvedValue([])
  mocks.exportUploadUpdateMany.mockResolvedValue({ count: 0 })
  mocks.notificationUpdateMany.mockResolvedValue({ count: 0 })
  mocks.headers.mockResolvedValue(new Headers())
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT')
  })
  mocks.getServerI18n.mockResolvedValue({
    language: 'PT',
    copy: (portuguese: string) => portuguese,
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('onboarding server actions', () => {
  it('returns validation errors in the persisted English language', async () => {
    mocks.getServerI18n.mockResolvedValue({
      language: 'EN',
      copy: (_portuguese: string, english: string) => english,
    })

    const result = await saveOnboardingProfileAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({
        name: 'Maria Agent',
        phone: '+1 305 555 0100',
        timeZone: 'America/New_York',
        npn: 'invalid',
      }),
    )

    expect(result).toMatchObject({
      status: 'error',
      message: 'Review the highlighted fields.',
      fieldErrors: { npn: 'Use 4 to 20 digits for the NPN.' },
    })
  })

  it('validates the optional NPN when supplied before authenticated or database work', async () => {
    const result = await saveOnboardingProfileAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({
        name: 'Maria Agent',
        phone: '+1 305 555 0100',
        timeZone: 'America/New_York',
        npn: '12',
      }),
    )

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { npn: 'Use de 4 a 20 números no NPN.' },
    })
    expect(mocks.requireRoleWithoutOnboarding).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('saves the profile, acknowledges legacy welcome state and advances without an NPN', async () => {
    current = onboarding({ currentStep: 'WELCOME', welcomeCompletedAt: null })

    const result = await saveOnboardingProfileAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ name: 'Maria Agent', phone: '+13055550100', timeZone: 'America/New_York', npn: '' }),
    )

    expect(result).toMatchObject({ status: 'success', onboarding: { currentStep: 'NATIONAL_LIFE' } })
    expect(mocks.agentUpdate).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { phone: '+13055550100', npn: null },
    })
    expect(mocks.onboardingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'onboarding-1' },
      data: expect.objectContaining({
        welcomeCompletedAt: now,
        profileCompletedAt: now,
        currentStep: 'NATIONAL_LIFE',
      }),
    }))
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

  it('records a National Life skip without manufacturing sync evidence', async () => {
    current = onboarding({
      currentStep: 'NATIONAL_LIFE',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
    })

    const result = await skipNationalLifeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )

    expect(result).toMatchObject({
      status: 'success',
      onboarding: {
        currentStep: 'CALENDAR',
        nationalLifeSkippedAt: now.toISOString(),
        nationalLifeVerifiedAt: null,
        nationalLifeVerificationSource: null,
      },
    })
    expect(mocks.onboardingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'onboarding-1' },
      data: {
        nationalLifeSkippedAt: now,
        currentStep: 'CALENDAR',
      },
    }))
    expect(mocks.syncRunUpdateManyAndReturn).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        provider: 'NATIONAL_LIFE',
        deploymentScope: 'LOCAL_CONNECTOR',
        executionSource: 'LOCAL',
        state: { in: ['QUEUED', 'RUNNING', 'PAUSED'] },
      },
      data: {
        state: 'FAILED',
        safeErrorCode: 'USER_CANCELLED',
        currentGridKey: null,
        authRequiredAt: null,
        completedAt: now,
        updatedAt: now,
      },
      select: { id: true },
    })
    expect(mocks.syncRunFindMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        provider: 'NATIONAL_LIFE',
        deploymentScope: 'LOCAL_CONNECTOR',
        executionSource: 'LOCAL',
        state: { in: ['FAILED', 'PARTIAL'] },
        authState: { not: 'READY' },
      },
      select: { id: true },
    })
    expect(mocks.exportUploadUpdateMany).not.toHaveBeenCalled()
    expect(mocks.notificationUpdateMany).not.toHaveBeenCalled()
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        action: 'AGENT_ONBOARDING_NATIONAL_LIFE_SKIPPED',
        entity: 'AgentOnboarding',
        entityId: 'onboarding-1',
        after: {
          skippedAt: now.toISOString(),
          currentStep: 'CALENDAR',
          cancelledRuns: 0,
          cancelledUploads: 0,
          resolvedAuthNotifications: 0,
        },
      },
    })
  })

  it('fails incomplete export uploads belonging to runs canceled by the skip', async () => {
    current = onboarding({
      currentStep: 'NATIONAL_LIFE',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
    })
    mocks.syncRunUpdateManyAndReturn.mockResolvedValue([
      { id: 'run-1' },
      { id: 'run-2' },
    ])
    mocks.exportUploadUpdateMany.mockResolvedValue({ count: 2 })
    mocks.notificationUpdateMany.mockResolvedValue({ count: 3 })

    const result = await skipNationalLifeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )

    expect(result.status).toBe('success')
    expect(mocks.exportUploadUpdateMany).toHaveBeenCalledWith({
      where: {
        agentId: 'agent-1',
        runId: { in: ['run-1', 'run-2'] },
        state: 'UPLOADING',
      },
      data: {
        state: 'FAILED',
        safeErrorCode: 'USER_CANCELLED',
        completedAt: now,
        updatedAt: now,
      },
    })
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: 'user-1',
        readAt: null,
        OR: [
          { dedupeKey: 'national-life-login-required:run-1' },
          { dedupeKey: { startsWith: 'national-life-mfa-required:run-1:' } },
          { dedupeKey: 'national-life-login-required:run-2' },
          { dedupeKey: { startsWith: 'national-life-mfa-required:run-2:' } },
        ],
      },
      data: { readAt: now },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after: expect.objectContaining({
          cancelledRuns: 2,
          cancelledUploads: 2,
          resolvedAuthNotifications: 3,
        }),
      }),
    }))
  })

  it('resolves a stale auth warning when the sync failed before the user skipped', async () => {
    current = onboarding({
      currentStep: 'NATIONAL_LIFE',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
    })
    mocks.syncRunFindMany.mockResolvedValue([{ id: 'run-already-failed' }])
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 })

    const result = await skipNationalLifeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )

    expect(result.status).toBe('success')
    expect(mocks.exportUploadUpdateMany).not.toHaveBeenCalled()
    expect(mocks.notificationUpdateMany).toHaveBeenCalledWith({
      where: {
        recipientUserId: 'user-1',
        readAt: null,
        OR: [
          { dedupeKey: 'national-life-login-required:run-already-failed' },
          { dedupeKey: { startsWith: 'national-life-mfa-required:run-already-failed:' } },
        ],
      },
      data: { readAt: now },
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        after: expect.objectContaining({ resolvedAuthNotifications: 1 }),
      }),
    }))
  })

  it('rejects a National Life skip after the onboarding has advanced', async () => {
    current = onboarding({
      currentStep: 'CALENDAR',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeSkippedAt: now,
    })

    const result = await skipNationalLifeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'Conclua a etapa atual antes de continuar.',
    })
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

  it('rejects WhatsApp CONNECTED without a verified durable channel', async () => {
    current = onboarding({
      currentStep: 'WHATSAPP',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      nationalLifeVerificationSource: 'LOCAL_CONNECTOR_SYNC',
      calendarDecision: 'SKIPPED',
      calendarDecidedAt: now,
    })

    const result = await setWhatsAppOnboardingDecisionAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ decision: 'CONNECTED' }),
    )

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { decision: expect.stringContaining('verificação real') },
    })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
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

  it('advances a skipped calendar decision to the final WhatsApp screen', async () => {
    current = onboarding({
      currentStep: 'CALENDAR',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      nationalLifeVerificationSource: 'LOCAL_CONNECTOR_SYNC',
    })

    const result = await setCalendarOnboardingDecisionAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ decision: 'SKIPPED' }),
    )

    expect(result).toMatchObject({
      status: 'success',
      onboarding: {
        currentStep: 'WHATSAPP',
        calendarDecision: 'SKIPPED',
      },
    })
  })

  it('finishes atomically from WhatsApp, completes legacy modules and activates recruitment', async () => {
    current = onboarding({
      currentStep: 'WHATSAPP',
      welcomeCompletedAt: null,
      profileCompletedAt: now,
      nationalLifeVerifiedAt: now,
      nationalLifeVerificationSource: 'LOCAL_CONNECTOR_SYNC',
      calendarDecision: 'SKIPPED',
      calendarDecidedAt: now,
      requiredModules: ['TODAY', 'TEAM', 'INTEGRATIONS'],
      completedModules: [],
    })
    mocks.getRequiredModules.mockResolvedValue(['TODAY', 'TEAM', 'INTEGRATIONS'])
    mocks.invitationUpdateMany.mockResolvedValue({ count: 2 })

    await expect(setWhatsAppOnboardingDecisionAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ decision: 'SKIPPED' }),
    )).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.onboardingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'onboarding-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
        welcomeCompletedAt: now,
        whatsappDecision: 'SKIPPED',
        whatsappDecidedAt: now,
        requiredModules: ['TODAY', 'TEAM', 'INTEGRATIONS'],
        completedModules: ['TODAY', 'TEAM', 'INTEGRATIONS'],
        completedAt: now,
      }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AGENT_ONBOARDING_WHATSAPP_DECIDED',
        before: { decision: null },
        after: { decision: 'SKIPPED', currentStep: 'COMPLETED' },
      }),
    })
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AGENT_ONBOARDING_COMPLETED',
        userId: 'user-1',
        after: expect.objectContaining({
          whatsappDecision: 'SKIPPED',
          activatedRecruitmentInvitations: 2,
        }),
      }),
    })
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
    expect(mocks.redirect).toHaveBeenCalledWith('/agent?onboarding=completed')
  })

  it('finishes onboarding after National Life was explicitly skipped', async () => {
    current = onboarding({
      currentStep: 'WHATSAPP',
      welcomeCompletedAt: now,
      profileCompletedAt: now,
      nationalLifeSkippedAt: now,
      calendarDecision: 'SKIPPED',
      calendarDecidedAt: now,
    })

    await expect(setWhatsAppOnboardingDecisionAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      form({ decision: 'SKIPPED' }),
    )).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.onboardingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        nationalLifeSkippedAt: now,
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
      }),
    }))
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'AGENT_ONBOARDING_COMPLETED',
        after: expect.objectContaining({ nationalLifeOutcome: 'SKIPPED' }),
      }),
    })
  })

  it('keeps the completion action compatible with legacy MODULES and REVIEW rows', async () => {
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
      completedModules: ['TODAY'],
    })

    await expect(completeOnboardingAction(
      INITIAL_ONBOARDING_ACTION_STATE,
      new FormData(),
    )).rejects.toThrow('NEXT_REDIRECT')

    expect(mocks.onboardingUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'onboarding-1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
        requiredModules: ['TODAY', 'INTEGRATIONS'],
        completedModules: ['TODAY', 'INTEGRATIONS'],
      }),
    }))
    expect(mocks.redirect).toHaveBeenCalledWith('/agent?onboarding=completed')
  })
})
