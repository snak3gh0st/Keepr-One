'use server'

import { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import {
  AGENT_ONBOARDING_SELECT,
  deriveAgentOnboardingStep,
  detectOnboardingIntegrations,
  getRequiredOnboardingModulesForAgent,
  ONBOARDING_MODULES,
  ONBOARDING_OPTIONAL_DECISIONS,
  reconcileAgentOnboardingModules,
  toAgentOnboardingView,
  type AgentOnboardingRecord,
  type OnboardingModuleName,
  type OnboardingOptionalDecisionName,
} from '@/lib/agent-onboarding'
import { auth } from '@/lib/auth'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutOnboarding } from '@/lib/require-role'
import type { OnboardingActionState } from './state'

type OnboardingCopy = (
  portuguese: string,
  english: string,
  values?: Record<string, string | number>,
) => string

function createOptionalDecisionSchema(copy: OnboardingCopy) {
  return z.enum(ONBOARDING_OPTIONAL_DECISIONS, {
    error: copy('Escolha uma opção válida.', 'Choose a valid option.'),
  })
}

function createModuleSchema(copy: OnboardingCopy) {
  return z.enum(ONBOARDING_MODULES, {
    error: copy('Selecione um módulo válido.', 'Select a valid module.'),
  })
}

function createProfileSchema(copy: OnboardingCopy) {
  return z.object({
    name: z
      .string()
      .trim()
      .min(2, copy('Informe seu nome completo.', 'Enter your full name.'))
      .max(100, copy('O nome deve ter no máximo 100 caracteres.', 'Name must be at most 100 characters.')),
    phone: z
      .string()
      .trim()
      .min(1, copy('Informe seu telefone.', 'Enter your phone number.'))
      .max(32, copy('O telefone informado é muito longo.', 'The phone number is too long.'))
      .refine(
        (value) => /^\+?[0-9\s().-]+$/.test(value),
        copy('Informe um telefone válido.', 'Enter a valid phone number.'),
      )
      .transform(normalizePhone)
      .refine(
        (value) => /^\+?[0-9]{7,15}$/.test(value),
        copy('Informe um telefone com 7 a 15 dígitos.', 'Enter a phone number with 7 to 15 digits.'),
      ),
    timeZone: z
      .string()
      .trim()
      .min(1, copy('Selecione seu fuso horário.', 'Select your time zone.'))
      .max(100, copy('O fuso horário informado é inválido.', 'The selected time zone is invalid.'))
      .refine(isValidTimeZone, copy('Selecione um fuso horário válido.', 'Select a valid time zone.')),
    npn: z
      .string()
      .trim()
      .min(1, copy('Informe seu NPN.', 'Enter your NPN.'))
      .max(20, copy('O NPN deve ter no máximo 20 dígitos.', 'NPN must be at most 20 digits.'))
      .refine(
        (value) => /^\d{4,20}$/.test(value),
        copy('Use de 4 a 20 números no NPN.', 'Use 4 to 20 digits for the NPN.'),
      ),
  })
}

type OnboardingActor = {
  agentId: string
  userId: string
}

class OnboardingActionError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'OnboardingActionError'
  }
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function normalizePhone(value: string): string {
  const prefixed = value.startsWith('+')
  const digits = value.replace(/\D/g, '')
  return prefixed ? `+${digits}` : digits
}

function lastFourDigits(value: string): string {
  return value.replace(/\D/g, '').slice(-4)
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

function validationFailure(
  error: z.ZodError,
  copy: OnboardingCopy,
): OnboardingActionState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && !fieldErrors[field]) {
      fieldErrors[field] = issue.message
    }
  }
  return {
    status: 'error',
    message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
    fieldErrors,
  }
}

function actionFailure(
  error: unknown,
  fallback: string,
  copy: OnboardingCopy,
): OnboardingActionState {
  if (error instanceof OnboardingActionError) {
    return {
      status: 'error',
      message: error.message,
      ...(error.field ? { fieldErrors: { [error.field]: error.message } } : {}),
    }
  }
  console.error(fallback, error)
  return {
    status: 'error',
    message: copy(
      'Não foi possível salvar esta etapa agora. Tente novamente.',
      "We couldn't save this step right now. Please try again.",
    ),
  }
}

async function getOnboardingActor(copy: OnboardingCopy): Promise<OnboardingActor> {
  const session = await requireRoleWithoutOnboarding('AGENT')
  const agent = await prisma.agent.findUnique({
    where: { userId: session.user.id },
    select: { id: true, userId: true, status: true },
  })
  if (!agent || agent.status !== 'ACTIVE') {
    throw new OnboardingActionError(copy(
      'Não foi possível localizar seu perfil de agente.',
      "We couldn't find your agent profile.",
    ))
  }
  return { agentId: agent.id, userId: agent.userId }
}

async function requireInProgressOnboarding(
  transaction: Prisma.TransactionClient,
  agentId: string,
  copy: OnboardingCopy,
): Promise<AgentOnboardingRecord> {
  const onboarding = await transaction.agentOnboarding.findUnique({
    where: { agentId },
    select: AGENT_ONBOARDING_SELECT,
  })
  if (!onboarding) {
    throw new OnboardingActionError(copy(
      'Esta conta não precisa realizar o onboarding.',
      'This account does not need to complete onboarding.',
    ))
  }
  if (onboarding.status !== 'IN_PROGRESS') {
    throw new OnboardingActionError(copy(
      'O onboarding desta conta já foi concluído.',
      'Onboarding for this account has already been completed.',
    ))
  }
  return onboarding
}

function nextStep(
  current: AgentOnboardingRecord,
  changes: Partial<AgentOnboardingRecord>,
) {
  return deriveAgentOnboardingStep({ ...current, ...changes })
}

function requireCurrentStep(
  onboarding: AgentOnboardingRecord,
  expectedStep: AgentOnboardingRecord['currentStep'],
  copy: OnboardingCopy,
) {
  const actualStep = deriveAgentOnboardingStep(onboarding)
  if (actualStep !== expectedStep || onboarding.currentStep !== expectedStep) {
    throw new OnboardingActionError(copy(
      'Conclua a etapa atual antes de continuar.',
      'Complete the current step before continuing.',
    ))
  }
}

function success(
  onboarding: AgentOnboardingRecord,
  message: string,
): OnboardingActionState {
  return {
    status: 'success',
    message,
    onboarding: toAgentOnboardingView(onboarding),
  }
}

function refreshOnboarding() {
  revalidatePath('/onboarding')
}

export async function acknowledgeOnboardingWelcomeAction(
  _previousState: OnboardingActionState,
  _formData: FormData,
): Promise<OnboardingActionState> {
  void _previousState
  void _formData
  const { copy } = await getServerI18n()
  try {
    const actor = await getOnboardingActor(copy)
    const now = new Date()
    const updated = await prisma.$transaction(async (transaction) => {
      const current = await requireInProgressOnboarding(transaction, actor.agentId, copy)
      requireCurrentStep(current, 'WELCOME', copy)
      const welcomeCompletedAt = current.welcomeCompletedAt ?? now
      const currentStep = nextStep(current, { welcomeCompletedAt })
      const onboarding = await transaction.agentOnboarding.update({
        where: { id: current.id },
        data: { welcomeCompletedAt, currentStep },
        select: AGENT_ONBOARDING_SELECT,
      })
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'AGENT_ONBOARDING_WELCOME_ACKNOWLEDGED',
          entity: 'AgentOnboarding',
          entityId: current.id,
          after: { currentStep },
        },
      })
      return onboarding
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    refreshOnboarding()
    return success(updated, copy('Vamos completar seu perfil.', "Let's complete your profile."))
  } catch (error) {
    return actionFailure(error, 'Onboarding welcome acknowledgement failed', copy)
  }
}

export async function saveOnboardingProfileAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const { copy } = await getServerI18n()
  const parsed = createProfileSchema(copy).safeParse({
    name: formString(formData, 'name'),
    phone: formString(formData, 'phone'),
    timeZone: formString(formData, 'timeZone'),
    npn: formString(formData, 'npn'),
  })
  if (!parsed.success) return validationFailure(parsed.error, copy)

  try {
    const actor = await getOnboardingActor(copy)
    const currentProfile = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        name: true,
        timeZone: true,
        agent: { select: { phone: true, npn: true } },
      },
    })
    if (!currentProfile?.agent) {
      throw new OnboardingActionError(copy(
        'Não foi possível localizar seu perfil.',
        "We couldn't find your profile.",
      ))
    }
    const previousProfile = {
      name: currentProfile.name,
      phone: currentProfile.agent.phone,
      timeZone: currentProfile.timeZone,
      npn: currentProfile.agent.npn,
    }
    const changedFields = (Object.keys(previousProfile) as Array<keyof typeof previousProfile>)
      .filter((field) => previousProfile[field] !== parsed.data[field])

    const now = new Date()
    const updated = await prisma.$transaction(async (transaction) => {
      const current = await requireInProgressOnboarding(transaction, actor.agentId, copy)
      requireCurrentStep(current, 'PROFILE', copy)
      const profileCompletedAt = now
      const currentStep = nextStep(current, { profileCompletedAt })
      await transaction.user.update({
        where: { id: actor.userId },
        data: {
          name: parsed.data.name,
          timeZone: parsed.data.timeZone,
        },
      })
      await transaction.agent.update({
        where: { id: actor.agentId },
        data: { phone: parsed.data.phone, npn: parsed.data.npn },
      })
      const onboarding = await transaction.agentOnboarding.update({
        where: { id: current.id },
        data: { profileCompletedAt, currentStep },
        select: AGENT_ONBOARDING_SELECT,
      })
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'AGENT_ONBOARDING_PROFILE_SAVED',
          entity: 'AgentOnboarding',
          entityId: current.id,
          after: {
            changedFields,
            ...(changedFields.includes('phone')
              ? { phoneLast4: lastFourDigits(parsed.data.phone) }
              : {}),
            ...(changedFields.includes('npn')
              ? { npnLast4: lastFourDigits(parsed.data.npn) }
              : {}),
            currentStep,
          },
        },
      })
      return onboarding
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })

    if (currentProfile.name !== parsed.data.name) {
      try {
        await auth.api.updateUser({
          headers: await headers(),
          body: { name: parsed.data.name },
        })
      } catch (error) {
        // The canonical user row was committed atomically above. Better Auth's
        // follow-up only refreshes its own session/cache view and must never
        // compensate or roll back the committed onboarding profile.
        console.error('Onboarding auth profile refresh failed', error)
      }
    }

    refreshOnboarding()
    revalidatePath('/agent/settings')
    return success(updated, copy(
      'Perfil salvo. Agora conecte a National Life.',
      'Profile saved. Now connect National Life.',
    ))
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2002'
    ) {
      return {
        status: 'error',
        message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
        fieldErrors: {
          npn: copy(
            'Este NPN já está vinculado a outra conta.',
            'This NPN is already linked to another account.',
          ),
        },
      }
    }
    return actionFailure(error, 'Onboarding profile save failed', copy)
  }
}

export async function verifyNationalLifeOnboardingAction(
  _previousState: OnboardingActionState,
  _formData: FormData,
): Promise<OnboardingActionState> {
  void _previousState
  void _formData
  const { copy } = await getServerI18n()
  try {
    const actor = await getOnboardingActor(copy)
    const integrations = await detectOnboardingIntegrations(actor)
    if (integrations.nationalLife !== 'VERIFIED_SYNC') {
      throw new OnboardingActionError(
        integrations.nationalLife === 'CONNECTOR_PAIRED'
          ? copy(
              'O K-Bot está conectado, mas ainda falta concluir uma sincronização verificada da National Life.',
              'K-Bot is connected, but you still need to complete a verified National Life sync.',
            )
          : copy(
              'Conecte o K-Bot e conclua a primeira sincronização da National Life.',
              'Connect K-Bot and complete the first National Life sync.',
            ),
      )
    }

    const now = new Date()
    const updated = await prisma.$transaction(async (transaction) => {
      const current = await requireInProgressOnboarding(transaction, actor.agentId, copy)
      requireCurrentStep(current, 'NATIONAL_LIFE', copy)
      const nationalLifeVerifiedAt = current.nationalLifeVerifiedAt ?? now
      const nationalLifeVerificationSource = 'LOCAL_CONNECTOR_SYNC' as const
      const currentStep = nextStep(current, {
        nationalLifeVerifiedAt,
        nationalLifeVerificationSource,
      })
      const onboarding = await transaction.agentOnboarding.update({
        where: { id: current.id },
        data: {
          nationalLifeVerifiedAt,
          nationalLifeVerificationSource,
          currentStep,
        },
        select: AGENT_ONBOARDING_SELECT,
      })
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'AGENT_ONBOARDING_NATIONAL_LIFE_VERIFIED',
          entity: 'AgentOnboarding',
          entityId: current.id,
          after: {
            source: nationalLifeVerificationSource,
            verifiedAt: nationalLifeVerifiedAt.toISOString(),
            currentStep,
          },
        },
      })
      return onboarding
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    refreshOnboarding()
    return success(updated, copy(
      'Conexão National Life verificada.',
      'National Life connection verified.',
    ))
  } catch (error) {
    return actionFailure(error, 'National Life onboarding verification failed', copy)
  }
}

async function saveOptionalIntegrationDecision(input: {
  kind: 'CALENDAR' | 'WHATSAPP'
  decision: OnboardingOptionalDecisionName
  copy: OnboardingCopy
}): Promise<OnboardingActionState> {
  const { copy } = input
  try {
    const actor = await getOnboardingActor(copy)
    if (input.decision === 'CONNECTED') {
      const integrations = await detectOnboardingIntegrations(actor)
      const connected = input.kind === 'CALENDAR'
        ? integrations.calendarConnected
        : integrations.whatsappConnected
      if (!connected) {
        throw new OnboardingActionError(
          input.kind === 'CALENDAR'
            ? copy(
                'Conclua a conexão real com o Google Calendar antes de continuar.',
                'Complete the actual Google Calendar connection before continuing.',
              )
            : copy(
                'Conclua a verificação real do WhatsApp antes de continuar.',
                'Complete the actual WhatsApp verification before continuing.',
              ),
          'decision',
        )
      }
    }

    const now = new Date()
    const updated = await prisma.$transaction(async (transaction) => {
      const current = await requireInProgressOnboarding(transaction, actor.agentId, copy)
      requireCurrentStep(current, input.kind, copy)
      const changes = input.kind === 'CALENDAR'
        ? { calendarDecision: input.decision, calendarDecidedAt: now }
        : { whatsappDecision: input.decision, whatsappDecidedAt: now }
      const currentStep = nextStep(current, changes)
      const onboarding = await transaction.agentOnboarding.update({
        where: { id: current.id },
        data: { ...changes, currentStep },
        select: AGENT_ONBOARDING_SELECT,
      })
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: input.kind === 'CALENDAR'
            ? 'AGENT_ONBOARDING_CALENDAR_DECIDED'
            : 'AGENT_ONBOARDING_WHATSAPP_DECIDED',
          entity: 'AgentOnboarding',
          entityId: current.id,
          before: {
            decision: input.kind === 'CALENDAR'
              ? current.calendarDecision
              : current.whatsappDecision,
          },
          after: { decision: input.decision, currentStep },
        },
      })
      return onboarding
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    refreshOnboarding()
    return success(
      updated,
      input.decision === 'CONNECTED'
        ? copy('Integração conectada e confirmada.', 'Integration connected and confirmed.')
        : copy(
            'Você poderá configurar esta integração mais tarde.',
            'You can set up this integration later.',
          ),
    )
  } catch (error) {
    return actionFailure(error, 'Optional onboarding integration decision failed', copy)
  }
}

export async function setCalendarOnboardingDecisionAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const { copy } = await getServerI18n()
  const parsed = createOptionalDecisionSchema(copy).safeParse(formString(formData, 'decision'))
  if (!parsed.success) return validationFailure(parsed.error, copy)
  return saveOptionalIntegrationDecision({ kind: 'CALENDAR', decision: parsed.data, copy })
}

export async function setWhatsAppOnboardingDecisionAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const { copy } = await getServerI18n()
  const parsed = createOptionalDecisionSchema(copy).safeParse(formString(formData, 'decision'))
  if (!parsed.success) return validationFailure(parsed.error, copy)
  return saveOptionalIntegrationDecision({ kind: 'WHATSAPP', decision: parsed.data, copy })
}

export async function markOnboardingModuleAction(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const { copy } = await getServerI18n()
  const parsed = createModuleSchema(copy).safeParse(formString(formData, 'module'))
  if (!parsed.success) return validationFailure(parsed.error, copy)

  try {
    const actor = await getOnboardingActor(copy)
    const requiredModules = await getRequiredOnboardingModulesForAgent(actor.agentId)
    const onboardingModule = parsed.data satisfies OnboardingModuleName
    if (!requiredModules.includes(onboardingModule)) {
      throw new OnboardingActionError(
        copy(
          'Este módulo não está disponível para o seu plano.',
          'This module is not available with your plan.',
        ),
        'module',
      )
    }

    const updated = await prisma.$transaction(async (transaction) => {
      const current = await requireInProgressOnboarding(transaction, actor.agentId, copy)
      const reconciled = reconcileAgentOnboardingModules(current, requiredModules)
      requireCurrentStep(reconciled, 'MODULES', copy)
      const requiredSet = new Set(requiredModules)
      const completedModules = [
        ...new Set([
          ...reconciled.completedModules.filter((item) => requiredSet.has(item)),
          onboardingModule,
        ]),
      ]
      const currentStep = nextStep(reconciled, { requiredModules, completedModules })
      const onboarding = await transaction.agentOnboarding.update({
        where: { id: current.id },
        data: { requiredModules, completedModules, currentStep },
        select: AGENT_ONBOARDING_SELECT,
      })
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'AGENT_ONBOARDING_MODULE_COMPLETED',
          entity: 'AgentOnboarding',
          entityId: current.id,
          after: { module: onboardingModule, currentStep },
        },
      })
      return onboarding
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    refreshOnboarding()
    return success(updated, copy(
      'Módulo marcado como conhecido.',
      'Module marked as reviewed.',
    ))
  } catch (error) {
    return actionFailure(error, 'Onboarding module completion failed', copy)
  }
}

export async function completeOnboardingAction(
  _previousState: OnboardingActionState,
  _formData: FormData,
): Promise<OnboardingActionState> {
  void _previousState
  void _formData
  const { copy } = await getServerI18n()
  let completed = false
  try {
    const actor = await getOnboardingActor(copy)
    const requiredModules = await getRequiredOnboardingModulesForAgent(actor.agentId)
    const now = new Date()
    await prisma.$transaction(async (transaction) => {
      const current = await requireInProgressOnboarding(transaction, actor.agentId, copy)
      const candidate = reconcileAgentOnboardingModules(current, requiredModules)
      requireCurrentStep(candidate, 'REVIEW', copy)
      const completedModules = candidate.completedModules
      const incompleteStep = deriveAgentOnboardingStep(candidate)
      if (incompleteStep !== 'REVIEW') {
        throw new OnboardingActionError(
          copy(
            'Conclua todas as etapas obrigatórias antes de finalizar.',
            'Complete every required step before finishing.',
          ),
        )
      }

      await transaction.agentOnboarding.update({
        where: { id: current.id },
        data: {
          requiredModules,
          completedModules,
          status: 'COMPLETED',
          currentStep: 'COMPLETED',
          completedAt: now,
        },
      })
      const activatedRecruitmentInvitations = await transaction.agencyInvitation.updateMany({
        where: {
          acceptedAgentId: actor.agentId,
          status: 'ACCEPTED',
          recruitmentStage: 'ONBOARDING',
          acceptedMembership: {
            agentId: actor.agentId,
            endedAt: null,
          },
        },
        data: {
          recruitmentStage: 'ACTIVE',
          stageUpdatedAt: now,
        },
      })
      await transaction.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'AGENT_ONBOARDING_COMPLETED',
          entity: 'AgentOnboarding',
          entityId: current.id,
          after: {
            completedAt: now.toISOString(),
            requiredModules,
            calendarDecision: current.calendarDecision,
            whatsappDecision: current.whatsappDecision,
            activatedRecruitmentInvitations: activatedRecruitmentInvitations.count,
          },
        },
      })
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })
    completed = true
  } catch (error) {
    return actionFailure(error, 'Onboarding completion failed', copy)
  }

  if (completed) {
    revalidatePath('/onboarding')
    revalidatePath('/agent')
    revalidatePath('/agent/agency')
    revalidatePath('/agent/hierarchy')
    redirect('/agent')
  }
  return {
    status: 'error',
    message: copy(
      'Não foi possível concluir o onboarding.',
      "We couldn't complete onboarding.",
    ),
  }
}
