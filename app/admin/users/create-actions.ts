'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Prisma, type AgentOnboardingModule, type PlatformModule } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getServerI18n } from '@/lib/i18n/server'
import { DEFAULT_MODULES_BY_PLAN, PLATFORM_MODULES } from '@/lib/platform-modules'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import { getStripeCatalogEntry } from '@/lib/stripe/platform-catalog'

export type CreateManagedUserState = {
  status: 'idle' | 'error'
  message: string
  fieldErrors?: Record<string, string>
}

const INITIAL_ACCESS_MODES = ['TRIAL', 'PAYMENT_REQUIRED'] as const
const ACCOUNT_TYPES = ['AGENT_INDIVIDUAL', 'AGENCY'] as const
const ONBOARDING_MODULES = new Set<AgentOnboardingModule>([
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'TEAM',
  'INTEGRATIONS',
])

const createManagedUserSchema = z
  .object({
    accountType: z.enum(ACCOUNT_TYPES),
    name: z.string().trim().min(2).max(100),
    agencyName: z.string().trim().max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().max(32).refine(isValidPhone),
    language: z.enum(['PT', 'EN']),
    timeZone: z.string().trim().min(1).max(100).refine(isValidTimeZone),
    npn: z.string().trim().max(40),
    accessMode: z.enum(INITIAL_ACCESS_MODES),
    trialDays: z.coerce.number().int().min(1).max(365),
    modules: z.array(z.enum(PLATFORM_MODULES)).min(1),
    sendAccessEmail: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.accountType === 'AGENCY' && value.agencyName.length < 2) {
      context.addIssue({ code: 'custom', path: ['agencyName'], message: 'agency_required' })
    }
    if (!value.modules.includes('TODAY')) {
      context.addIssue({ code: 'custom', path: ['modules'], message: 'today_required' })
    }
    if (
      value.accountType === 'AGENT_INDIVIDUAL'
      && value.modules.some((module) => module === 'AGENCY' || module === 'TEAM')
    ) {
      context.addIssue({ code: 'custom', path: ['modules'], message: 'agency_module_invalid' })
    }
  })

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function isValidPhone(value: string): boolean {
  if (!/^\+?[0-9\s().-]+$/.test(value)) return false
  const digits = value.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '')
  return value.startsWith('+') ? `+${digits}` : digits
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}

function validationFailure(
  error: z.ZodError,
  copy: (portuguese: string, english: string) => string,
): CreateManagedUserState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || fieldErrors[field]) continue
    const messages: Record<string, string> = {
      accountType: copy('Selecione um plano válido.', 'Select a valid plan.'),
      name: copy('Informe um nome entre 2 e 100 caracteres.', 'Enter a name between 2 and 100 characters.'),
      agencyName: copy('Informe o nome da agência.', 'Enter the agency name.'),
      email: copy('Informe um e-mail válido.', 'Enter a valid email address.'),
      phone: copy('Informe um telefone válido com 7 a 15 dígitos.', 'Enter a valid phone number with 7 to 15 digits.'),
      language: copy('Selecione um idioma válido.', 'Select a valid language.'),
      timeZone: copy('Selecione um fuso horário válido.', 'Select a valid time zone.'),
      npn: copy('O NPN deve ter no máximo 40 caracteres.', 'The NPN must be no more than 40 characters.'),
      accessMode: copy('Selecione como o acesso deve começar.', 'Select how access should start.'),
      trialDays: copy('Defina um período de teste entre 1 e 365 dias.', 'Set a trial period between 1 and 365 days.'),
      modules: copy('Mantenha Hoje ativo e selecione apenas módulos compatíveis com o plano.', 'Keep Today enabled and select only modules supported by the plan.'),
    }
    fieldErrors[field] = messages[field] ?? copy('Valor inválido.', 'Invalid value.')
  }
  return {
    status: 'error',
    message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
    fieldErrors,
  }
}

function publicAuthHeaders(requestHeaders: Headers): Headers {
  const publicHeaders = new Headers(requestHeaders)
  publicHeaders.delete('cookie')
  publicHeaders.delete('authorization')
  return publicHeaders
}

function onboardingModules(modules: readonly PlatformModule[]): AgentOnboardingModule[] {
  return modules.filter(
    (module): module is AgentOnboardingModule => ONBOARDING_MODULES.has(module as AgentOnboardingModule),
  )
}

function duplicateFailure(
  error: Prisma.PrismaClientKnownRequestError,
  copy: (portuguese: string, english: string) => string,
): CreateManagedUserState {
  const target = Array.isArray(error.meta?.target)
    ? error.meta.target.map(String)
    : [String(error.meta?.target ?? '')]
  const npnConflict = target.some((field) => field.toLowerCase().includes('npn'))
  return {
    status: 'error',
    message: copy('Não foi possível concluir o cadastro.', 'We could not complete the registration.'),
    fieldErrors: npnConflict
      ? { npn: copy('Este NPN já pertence a outra conta.', 'This NPN already belongs to another account.') }
      : { email: copy('Já existe uma conta com este e-mail.', 'An account with this email already exists.') },
  }
}

export async function createManagedUserAction(
  _previousState: CreateManagedUserState,
  formData: FormData,
): Promise<CreateManagedUserState> {
  const { copy } = await getServerI18n()
  const requestedModules = [...new Set(
    formData.getAll('modules').filter((value): value is string => typeof value === 'string'),
  )]
  const accessMode = formString(formData, 'accessMode')
  const parsed = createManagedUserSchema.safeParse({
    accountType: formString(formData, 'accountType'),
    name: formString(formData, 'name'),
    agencyName: formString(formData, 'agencyName'),
    email: formString(formData, 'email'),
    phone: formString(formData, 'phone'),
    language: formString(formData, 'language'),
    timeZone: formString(formData, 'timeZone'),
    npn: formString(formData, 'npn'),
    accessMode,
    trialDays: accessMode === 'TRIAL' ? formString(formData, 'trialDays') : '1',
    modules: requestedModules,
    sendAccessEmail: formString(formData, 'sendAccessEmail') === 'yes',
  })
  if (!parsed.success) return validationFailure(parsed.error, copy)

  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  const session = await requireRole('ADMIN')

  const plan = parsed.data.accountType
  const catalog = getStripeCatalogEntry(plan)
  if (!catalog) {
    return {
      status: 'error',
      message: copy('O plano selecionado não está disponível.', 'The selected plan is unavailable.'),
      fieldErrors: { accountType: copy('Selecione outro plano.', 'Select another plan.') },
    }
  }

  const now = new Date()
  const trialEndsAt = parsed.data.accessMode === 'TRIAL'
    ? new Date(now.getTime() + parsed.data.trialDays * 24 * 60 * 60 * 1_000)
    : null
  const modules = parsed.data.modules as PlatformModule[]
  const planModules = new Set<string>(DEFAULT_MODULES_BY_PLAN[plan])
  if (modules.some((module) => !planModules.has(module))) {
    return {
      status: 'error',
      message: copy('Revise os módulos selecionados.', 'Review the selected modules.'),
      fieldErrors: {
        modules: copy('Há módulos incompatíveis com o plano escolhido.', 'Some modules are incompatible with the selected plan.'),
      },
    }
  }

  const temporaryPassword = randomBytes(48).toString('base64url')
  const passwordHash = await hashPassword(temporaryPassword)

  let created: { userId: string }
  try {
    created = await prisma.$transaction(async (transaction) => {
      const pendingInvitationCheckout = await transaction.agencyInvitationCheckout.findFirst({
        where: {
          email: parsed.data.email,
          status: 'PENDING',
          checkoutExpiresAt: { gt: now },
        },
        select: { id: true },
      })
      if (pendingInvitationCheckout) throw new Error('PENDING_INVITATION_CHECKOUT')

      const user = await transaction.user.create({
        data: {
          email: parsed.data.email,
          name: parsed.data.name,
          role: 'AGENT',
          language: parsed.data.language,
          timeZone: parsed.data.timeZone,
        },
        select: { id: true },
      })

      await transaction.account.create({
        data: {
          id: randomUUID(),
          accountId: user.id,
          providerId: 'credential',
          userId: user.id,
          password: passwordHash,
        },
      })

      const agent = await transaction.agent.create({
        data: {
          userId: user.id,
          rank: plan === 'AGENCY' ? 'AGENCY_OWNER' : 'AGENT',
          npn: parsed.data.npn || null,
          phone: normalizePhone(parsed.data.phone),
          status: 'ACTIVE',
          promotionAccessScope: plan === 'AGENCY' ? 'AGENCY' : 'PERSONAL',
        },
        select: { id: true },
      })

      let agencyId: string | null = null
      if (plan === 'AGENCY') {
        const agency = await transaction.agency.create({
          data: { name: parsed.data.agencyName },
          select: { id: true },
        })
        agencyId = agency.id
        await transaction.agencyMembership.create({
          data: { agencyId: agency.id, agentId: agent.id, role: 'OWNER' },
        })
      }

      const subscription = await transaction.platformSubscription.create({
        data: {
          plan,
          status: parsed.data.accessMode === 'TRIAL' ? 'TRIALING' : 'PAST_DUE',
          ...(plan === 'AGENCY' ? { agencyId } : { agentId: agent.id }),
          unitAmountCents: catalog.unitAmountCents,
          currency: catalog.currency.toUpperCase(),
          currentPeriodStart: parsed.data.accessMode === 'TRIAL' ? now : null,
          currentPeriodEnd: trialEndsAt,
          stripeProductId: catalog.productId,
          stripePriceId: catalog.priceId,
        },
        select: { id: true },
      })

      const provisionedAccess = await transaction.adminProvisionedAccess.create({
        data: {
          agentId: agent.id,
          platformSubscriptionId: subscription.id,
          individualRank: 'AGENT',
          modules,
          paymentRequiredAt: parsed.data.accessMode === 'PAYMENT_REQUIRED' ? now : null,
          paymentReason: parsed.data.accessMode === 'PAYMENT_REQUIRED'
            ? 'INITIAL_PAYMENT_REQUIRED'
            : null,
          provisionedById: session.user.id,
        },
        select: { id: true },
      })

      await transaction.agentOnboarding.create({
        data: {
          agentId: agent.id,
          status: 'IN_PROGRESS',
          currentStep: 'WELCOME',
          requiredModules: onboardingModules(modules),
        },
      })

      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'ADMIN_USER_CREATED',
          entity: 'User',
          entityId: user.id,
          after: {
            accountType: plan,
            agentId: agent.id,
            agencyId,
            platformSubscriptionId: subscription.id,
            adminProvisionedAccessId: provisionedAccess.id,
            accessMode: parsed.data.accessMode,
            trialDays: parsed.data.accessMode === 'TRIAL' ? parsed.data.trialDays : null,
            trialEndsAt: trialEndsAt?.toISOString() ?? null,
            modules,
            accessEmailRequested: parsed.data.sendAccessEmail,
          },
        },
      })

      return { userId: user.id }
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'PENDING_INVITATION_CHECKOUT') {
      return {
        status: 'error',
        message: copy(
          'Este e-mail já está concluindo um convite de Agência.',
          'This email is already completing an Agency invitation.',
        ),
        fieldErrors: {
          email: copy(
            'Aguarde o checkout expirar ou cancele o convite antes de criar o acesso avulso.',
            'Wait for checkout to expire or cancel the invitation before creating standalone access.',
          ),
        },
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return duplicateFailure(error, copy)
    }
    console.error('Admin managed user creation failed', error)
    return {
      status: 'error',
      message: copy('Não foi possível criar o usuário agora.', 'We could not create the user right now.'),
    }
  }

  let emailDelivery: 'sent' | 'failed' | 'skipped' = parsed.data.sendAccessEmail
    ? 'failed'
    : 'skipped'
  if (parsed.data.sendAccessEmail) {
    try {
      await auth.api.requestPasswordReset({
        headers: publicAuthHeaders(requestHeaders),
        body: {
          email: parsed.data.email,
          redirectTo: `/reset-password?lang=${parsed.data.language}`,
        },
      })
      emailDelivery = 'sent'
      try {
        await prisma.auditLog.create({
          data: {
            userId: session.user.id,
            action: 'ADMIN_PASSWORD_RESET_REQUESTED',
            entity: 'User',
            entityId: created.userId,
            after: { delivery: 'EMAIL', recipient: parsed.data.email, source: 'USER_CREATION' },
          },
        })
      } catch (auditError) {
        console.error('Admin created user email audit failed after delivery', auditError)
      }
    } catch (error) {
      console.error('Admin created user access email failed', error)
    }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${created.userId}`)
  revalidatePath('/admin/audit')
  redirect(`/admin/users/${created.userId}?created=1&email=${emailDelivery}`)
}
