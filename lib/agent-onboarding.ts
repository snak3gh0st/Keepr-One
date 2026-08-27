import 'server-only'

import {
  Prisma,
  type AgentOnboardingModule,
  type AgentOnboardingNationalLifeSource,
  type AgentOnboardingOptionalDecision,
  type AgentOnboardingStatus,
  type AgentOnboardingStep,
  type PrismaClient,
} from '@prisma/client'
import { getAgentAccessForAgent } from '@/lib/agent-access'
import { getCurrentAgentWithoutOnboarding } from '@/lib/agent-context'
import { whatsappChannelModeFromEnv } from '@/lib/messaging/channel-mode'
import { CANONICAL_NATIONAL_LIFE_SYNC } from '@/lib/national-life/sync-engine'
import { prisma } from '@/lib/prisma'

export const ONBOARDING_STEPS = [
  'WELCOME',
  'PROFILE',
  'NATIONAL_LIFE',
  'CALENDAR',
  'WHATSAPP',
  'MODULES',
  'REVIEW',
  'COMPLETED',
] as const satisfies readonly AgentOnboardingStep[]

export const ONBOARDING_UNIVERSAL_MODULES = [
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
] as const satisfies readonly AgentOnboardingModule[]

export const ONBOARDING_MODULES = [
  ...ONBOARDING_UNIVERSAL_MODULES,
  'TEAM',
  'INTEGRATIONS',
] as const satisfies readonly AgentOnboardingModule[]

export const ONBOARDING_OPTIONAL_DECISIONS = [
  'CONNECTED',
  'SKIPPED',
] as const satisfies readonly AgentOnboardingOptionalDecision[]

export type OnboardingModuleName = (typeof ONBOARDING_MODULES)[number]
export type OnboardingOptionalDecisionName = (typeof ONBOARDING_OPTIONAL_DECISIONS)[number]

export type AgentOnboardingView = {
  id: string
  agentId: string
  status: AgentOnboardingStatus
  currentStep: AgentOnboardingStep
  welcomeCompletedAt: string | null
  profileCompletedAt: string | null
  nationalLifeVerifiedAt: string | null
  nationalLifeVerificationSource: AgentOnboardingNationalLifeSource | null
  calendarDecision: AgentOnboardingOptionalDecision | null
  calendarDecidedAt: string | null
  whatsappDecision: AgentOnboardingOptionalDecision | null
  whatsappDecidedAt: string | null
  requiredModules: OnboardingModuleName[]
  completedModules: OnboardingModuleName[]
  pendingModules: OnboardingModuleName[]
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type NationalLifeOnboardingState =
  | 'NOT_CONNECTED'
  | 'CONNECTOR_PAIRED'
  | 'VERIFIED_SYNC'

export type OnboardingIntegrationSnapshot = {
  nationalLife: NationalLifeOnboardingState
  calendarConnected: boolean
  whatsappConnected: boolean
}

export type AgentOnboardingPageData = {
  onboarding: AgentOnboardingView | null
  profile: {
    name: string
    phone: string
    timeZone: string
    npn: string
  }
  integrations: OnboardingIntegrationSnapshot
}

export const AGENT_ONBOARDING_SELECT = {
  id: true,
  agentId: true,
  status: true,
  currentStep: true,
  welcomeCompletedAt: true,
  profileCompletedAt: true,
  nationalLifeVerifiedAt: true,
  nationalLifeVerificationSource: true,
  calendarDecision: true,
  calendarDecidedAt: true,
  whatsappDecision: true,
  whatsappDecidedAt: true,
  requiredModules: true,
  completedModules: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentOnboardingSelect

export type AgentOnboardingRecord = Prisma.AgentOnboardingGetPayload<{
  select: typeof AGENT_ONBOARDING_SELECT
}>

type OnboardingReadDb = Pick<PrismaClient, 'agentOnboarding'>
type OnboardingIntegrationDb = Pick<
  PrismaClient,
  | 'nationalLifeConnectorDevice'
  | 'nationalLifeSyncRun'
  | 'calendarIntegration'
  | 'agentMessagingChannel'
>

function uniqueModules(
  values: readonly AgentOnboardingModule[],
): OnboardingModuleName[] {
  const allowed = new Set<AgentOnboardingModule>(ONBOARDING_MODULES)
  return values.filter(
    (value, index, list): value is OnboardingModuleName =>
      allowed.has(value) && list.indexOf(value) === index,
  )
}

export function getRequiredOnboardingModulesForAccess(access: {
  canManageTeam: boolean
  canAccessIntegrations?: boolean
}): OnboardingModuleName[] {
  return uniqueModules([
    ...ONBOARDING_UNIVERSAL_MODULES,
    ...(access.canManageTeam ? (['TEAM'] as const) : []),
    ...(access.canAccessIntegrations === false ? [] : (['INTEGRATIONS'] as const)),
  ])
}

export async function getRequiredOnboardingModulesForAgent(
  agentId: string,
): Promise<OnboardingModuleName[]> {
  const access = await getAgentAccessForAgent(agentId)
  return getRequiredOnboardingModulesForAccess({
    canManageTeam: access.canManageTeam,
    canAccessIntegrations: true,
  })
}

export function deriveAgentOnboardingStep(input: Pick<
  AgentOnboardingRecord,
  | 'status'
  | 'welcomeCompletedAt'
  | 'profileCompletedAt'
  | 'nationalLifeVerifiedAt'
  | 'calendarDecision'
  | 'whatsappDecision'
  | 'requiredModules'
  | 'completedModules'
>): AgentOnboardingStep {
  if (input.status === 'COMPLETED') return 'COMPLETED'
  if (!input.welcomeCompletedAt) return 'WELCOME'
  if (!input.profileCompletedAt) return 'PROFILE'
  if (!input.nationalLifeVerifiedAt) return 'NATIONAL_LIFE'
  if (!input.calendarDecision) return 'CALENDAR'
  if (!input.whatsappDecision) return 'WHATSAPP'

  const completed = new Set(uniqueModules(input.completedModules))
  if (uniqueModules(input.requiredModules).some((module) => !completed.has(module))) {
    return 'MODULES'
  }
  return 'REVIEW'
}

export function reconcileAgentOnboardingModules(
  onboarding: AgentOnboardingRecord,
  requiredModules: readonly AgentOnboardingModule[],
): AgentOnboardingRecord {
  const normalizedRequired = uniqueModules(requiredModules)
  const requiredSet = new Set(normalizedRequired)
  const completedModules = uniqueModules(onboarding.completedModules).filter((module) =>
    requiredSet.has(module),
  )
  const candidate = {
    ...onboarding,
    requiredModules: normalizedRequired,
    completedModules,
  }
  return {
    ...candidate,
    currentStep: deriveAgentOnboardingStep(candidate),
  }
}

function sameModules(
  left: readonly AgentOnboardingModule[],
  right: readonly AgentOnboardingModule[],
) {
  return left.length === right.length
    && left.every((module, index) => module === right[index])
}

export async function reconcileAgentOnboardingForAgent(
  agentId: string,
): Promise<AgentOnboardingView | null> {
  const requiredModules = await getRequiredOnboardingModulesForAgent(agentId)
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.agentOnboarding.findUnique({
      where: { agentId },
      select: AGENT_ONBOARDING_SELECT,
    })
    if (!current || current.status === 'COMPLETED') {
      return current ? toAgentOnboardingView(current) : null
    }

    const reconciled = reconcileAgentOnboardingModules(current, requiredModules)
    if (
      current.currentStep === reconciled.currentStep
      && sameModules(current.requiredModules, reconciled.requiredModules)
      && sameModules(current.completedModules, reconciled.completedModules)
    ) {
      return toAgentOnboardingView(current)
    }

    const updated = await transaction.agentOnboarding.update({
      where: { id: current.id },
      data: {
        requiredModules: reconciled.requiredModules,
        completedModules: reconciled.completedModules,
        currentStep: reconciled.currentStep,
      },
      select: AGENT_ONBOARDING_SELECT,
    })
    return toAgentOnboardingView(updated)
  })
}

export function toAgentOnboardingView(
  value: AgentOnboardingRecord,
): AgentOnboardingView {
  const requiredModules = uniqueModules(value.requiredModules)
  const requiredSet = new Set(requiredModules)
  const completedModules = uniqueModules(value.completedModules).filter((module) =>
    requiredSet.has(module),
  )
  const completedSet = new Set(completedModules)

  return {
    id: value.id,
    agentId: value.agentId,
    status: value.status,
    currentStep: value.currentStep,
    welcomeCompletedAt: value.welcomeCompletedAt?.toISOString() ?? null,
    profileCompletedAt: value.profileCompletedAt?.toISOString() ?? null,
    nationalLifeVerifiedAt: value.nationalLifeVerifiedAt?.toISOString() ?? null,
    nationalLifeVerificationSource: value.nationalLifeVerificationSource,
    calendarDecision: value.calendarDecision,
    calendarDecidedAt: value.calendarDecidedAt?.toISOString() ?? null,
    whatsappDecision: value.whatsappDecision,
    whatsappDecidedAt: value.whatsappDecidedAt?.toISOString() ?? null,
    requiredModules,
    completedModules,
    pendingModules: requiredModules.filter((module) => !completedSet.has(module)),
    completedAt: value.completedAt?.toISOString() ?? null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  }
}

export async function getAgentOnboardingForAgent(
  agentId: string,
  db: OnboardingReadDb = prisma,
): Promise<AgentOnboardingView | null> {
  if (!agentId.trim()) throw new RangeError('agentId is required')
  const onboarding = await db.agentOnboarding.findUnique({
    where: { agentId },
    select: AGENT_ONBOARDING_SELECT,
  })
  return onboarding ? toAgentOnboardingView(onboarding) : null
}

function isVerifiedNationalLifeRun(run: {
  completedAt: Date | null
  totalStages: number
  completedStages: number
  failedStages: number
  plannedGridKeys: string[]
  stageCompletions: Array<{
    gridKey: string
    expectedRecordCount: number
    receivedRecordCount: number
    truncated: boolean
  }>
} | null): boolean {
  if (
    !run?.completedAt
    || run.totalStages <= 0
    || run.failedStages !== 0
    || run.completedStages !== run.totalStages
  ) {
    return false
  }

  const planned = [...new Set(run.plannedGridKeys)]
  if (planned.length !== run.totalStages) return false
  const completed = new Set(
    run.stageCompletions
      .filter((stage) =>
        !stage.truncated
        && stage.expectedRecordCount === stage.receivedRecordCount,
      )
      .map((stage) => stage.gridKey),
  )
  return planned.every((gridKey) => completed.has(gridKey))
}

export async function detectOnboardingIntegrations(
  input: { agentId: string; userId: string },
  db: OnboardingIntegrationDb = prisma,
): Promise<OnboardingIntegrationSnapshot> {
  const whatsappProvider = whatsappChannelModeFromEnv(process.env)
  const [device, completedRun, calendar, whatsapp] = await Promise.all([
    db.nationalLifeConnectorDevice.findFirst({
      where: {
        agentId: input.agentId,
        status: 'ACTIVE',
        revokedAt: null,
        lastSeenAt: { not: null },
      },
      select: { id: true },
    }),
    db.nationalLifeSyncRun.findFirst({
      where: {
        agentId: input.agentId,
        provider: CANONICAL_NATIONAL_LIFE_SYNC.provider,
        deploymentScope: CANONICAL_NATIONAL_LIFE_SYNC.deploymentScope,
        executionSource: CANONICAL_NATIONAL_LIFE_SYNC.executionSource,
        state: 'COMPLETED',
        completedAt: { not: null },
      },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      select: {
        completedAt: true,
        totalStages: true,
        completedStages: true,
        failedStages: true,
        plannedGridKeys: true,
        stageCompletions: {
          select: {
            gridKey: true,
            expectedRecordCount: true,
            receivedRecordCount: true,
            truncated: true,
          },
        },
      },
    }),
    db.calendarIntegration.findFirst({
      where: {
        userId: input.userId,
        provider: 'GOOGLE',
        status: 'CONNECTED',
      },
      select: { id: true },
    }),
    db.agentMessagingChannel.findFirst({
      where: {
        agentId: input.agentId,
        kind: 'WHATSAPP',
        provider: whatsappProvider,
        status: 'CONNECTED',
        verifiedAt: { not: null },
        normalizedPhoneE164: { not: null },
        ...(whatsappProvider === 'META_CLOUD'
          ? { externalInboxId: { not: null } }
          : { evolutionInstanceName: { not: null } }),
      },
      select: { id: true },
    }),
  ])

  return {
    nationalLife: isVerifiedNationalLifeRun(completedRun)
      ? 'VERIFIED_SYNC'
      : device
        ? 'CONNECTOR_PAIRED'
        : 'NOT_CONNECTED',
    calendarConnected: Boolean(calendar),
    whatsappConnected: Boolean(whatsapp),
  }
}

export async function getCurrentAgentOnboarding(): Promise<AgentOnboardingPageData> {
  const agent = await getCurrentAgentWithoutOnboarding()
  const [onboarding, user, integrations] = await Promise.all([
    reconcileAgentOnboardingForAgent(agent.id),
    prisma.user.findUnique({
      where: { id: agent.userId },
      select: { name: true, timeZone: true },
    }),
    detectOnboardingIntegrations({ agentId: agent.id, userId: agent.userId }),
  ])
  if (!user) throw new Error('Signed-in agent user was not found')

  return {
    onboarding,
    profile: {
      name: user.name,
      phone: agent.phone ?? '',
      timeZone: user.timeZone,
      npn: agent.npn ?? '',
    },
    integrations,
  }
}
