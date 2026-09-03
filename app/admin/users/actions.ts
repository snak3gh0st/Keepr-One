'use server'

import { Prisma, type PlatformModule } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getServerI18n } from '@/lib/i18n/server'
import { prisma } from '@/lib/prisma'
import { RANKS } from '@/lib/ranks'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'

const MANAGED_USER_RANKS = [...RANKS, 'AGENCY_OWNER'] as const
type AgentProfessionalRank = (typeof RANKS)[number]

function isAgentProfessionalRank(value: string | null): value is AgentProfessionalRank {
  return value !== null && RANKS.includes(value as AgentProfessionalRank)
}

export type AdminUserActionState = {
  status: 'idle' | 'success' | 'error'
  message: string
  fieldErrors?: Record<string, string>
}

const profileSchema = z.object({
  userId: z.string().cuid(),
  expectedUpdatedAt: z.string().datetime(),
  expectedAgentUpdatedAt: z.union([z.literal(''), z.string().datetime()]).transform(emptyToNull),
  expectedAgencyUpdatedAt: z.union([z.literal(''), z.string().datetime()]).transform(emptyToNull),
  expectedClientUpdatedAt: z.union([z.literal(''), z.string().datetime()]).transform(emptyToNull),
  name: z.string().trim().min(2).max(100),
  language: z.enum(['PT', 'EN']),
  timeZone: z.string().trim().min(1).max(100).refine(isValidTimeZone),
  phone: z.string().trim().max(32).refine(isValidPhone).transform(normalizePhone),
  npn: z.string().trim().max(40).transform(emptyToNull),
  rank: z.string().trim().refine(
    (value) => value === '' || MANAGED_USER_RANKS.includes(value as (typeof MANAGED_USER_RANKS)[number]),
  ).transform(emptyToNull),
  agencyName: z.string().trim().max(120).transform(emptyToNull),
  clientName: z.string().trim().max(100).transform(emptyToNull),
  clientEmail: z.string().trim().max(254).transform(emptyToNull).refine(isOptionalEmail),
  clientPhone: z.string().trim().max(32).refine(isValidPhone).transform(normalizePhone),
})

const targetSchema = z.object({ userId: z.string().cuid() })
const accessSchema = targetSchema.extend({
  intent: z.enum(['SUSPEND', 'RESTORE']),
  reason: z.string().trim().max(240),
}).superRefine((value, context) => {
  if (value.intent === 'SUSPEND' && value.reason.length < 5) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' })
  }
})

const PLATFORM_MODULE_VALUES = [
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'JOURNEY',
  'AGENCY',
  'TEAM',
  'INTEGRATIONS',
] as const satisfies readonly PlatformModule[]

const productAccessSchema = targetSchema.extend({
  expectedUpdatedAt: z.string().datetime(),
  intent: z.enum(['SAVE_MODULES', 'START_TRIAL', 'REQUIRE_PAYMENT']),
  trialDays: z.coerce.number().int().min(1).max(365).optional(),
  reason: z.string().trim().max(240).default(''),
  modules: z.array(z.enum(PLATFORM_MODULE_VALUES)).default([]),
}).superRefine((value, context) => {
  if (value.intent === 'SAVE_MODULES' && !value.modules.includes('TODAY')) {
    context.addIssue({ code: 'custom', path: ['modules'], message: 'today_required' })
  }
  if (value.intent === 'START_TRIAL' && value.trialDays === undefined) {
    context.addIssue({ code: 'custom', path: ['trialDays'], message: 'trial_days_required' })
  }
  if (value.intent === 'REQUIRE_PAYMENT' && value.reason.length < 5) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'reason_required' })
  }
})

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function emptyToNull(value: string): string | null {
  return value === '' ? null : value
}

function isValidPhone(value: string): boolean {
  if (!value) return true
  if (!/^\+?[0-9\s().-]+$/.test(value)) return false
  const digits = value.replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

function normalizePhone(value: string): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return value.startsWith('+') ? `+${digits}` : digits
}

function isOptionalEmail(value: string | null): boolean {
  return value === null || z.email().safeParse(value).success
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
): AdminUserActionState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || fieldErrors[field]) continue
    const messages: Record<string, string> = {
      userId: copy('Usuário inválido.', 'Invalid user.'),
      expectedUpdatedAt: copy('A versão do perfil é inválida.', 'The profile version is invalid.'),
      expectedAgentUpdatedAt: copy('A versão do agente é inválida.', 'The agent version is invalid.'),
      expectedAgencyUpdatedAt: copy('A versão da agência é inválida.', 'The agency version is invalid.'),
      expectedClientUpdatedAt: copy('A versão do cliente é inválida.', 'The client version is invalid.'),
      name: copy('Informe um nome entre 2 e 100 caracteres.', 'Enter a name between 2 and 100 characters.'),
      language: copy('Selecione um idioma válido.', 'Select a valid language.'),
      timeZone: copy('Selecione um fuso horário válido.', 'Select a valid time zone.'),
      phone: copy('Informe um telefone válido com 7 a 15 dígitos.', 'Enter a valid phone number with 7 to 15 digits.'),
      npn: copy('O NPN deve ter no máximo 40 caracteres.', 'The NPN must be no more than 40 characters.'),
      rank: copy('Selecione um cargo válido.', 'Select a valid rank.'),
      agencyName: copy('O nome da agência deve ter no máximo 120 caracteres.', 'The agency name must be no more than 120 characters.'),
      clientName: copy('O nome do cliente deve ter no máximo 100 caracteres.', 'The client name must be no more than 100 characters.'),
      clientEmail: copy('Informe um e-mail de contato válido.', 'Enter a valid contact email.'),
      clientPhone: copy('Informe um telefone válido com 7 a 15 dígitos.', 'Enter a valid phone number with 7 to 15 digits.'),
      reason: copy('Explique o motivo da suspensão em pelo menos 5 caracteres.', 'Explain the suspension reason in at least 5 characters.'),
    }
    fieldErrors[field] = messages[field] ?? copy('Valor inválido.', 'Invalid value.')
  }
  return {
    status: 'error',
    message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
    fieldErrors,
  }
}

async function readAdminActionContext() {
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  const session = await requireRole('ADMIN')
  return { session, requestHeaders }
}

function publicAuthHeaders(requestHeaders: Headers) {
  const publicHeaders = new Headers(requestHeaders)
  publicHeaders.delete('cookie')
  publicHeaders.delete('authorization')
  return publicHeaders
}

function revalidateUserSurfaces(userId: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  revalidatePath('/admin/agents')
  revalidatePath('/admin/audit')
}

export async function updateManagedUserProfileAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  const { copy } = await getServerI18n()
  const parsed = profileSchema.safeParse({
    userId: formString(formData, 'userId'),
    expectedUpdatedAt: formString(formData, 'expectedUpdatedAt'),
    expectedAgentUpdatedAt: formString(formData, 'expectedAgentUpdatedAt'),
    expectedAgencyUpdatedAt: formString(formData, 'expectedAgencyUpdatedAt'),
    expectedClientUpdatedAt: formString(formData, 'expectedClientUpdatedAt'),
    name: formString(formData, 'name'),
    language: formString(formData, 'language'),
    timeZone: formString(formData, 'timeZone'),
    phone: formString(formData, 'phone'),
    npn: formString(formData, 'npn'),
    rank: formString(formData, 'rank'),
    agencyName: formString(formData, 'agencyName'),
    clientName: formString(formData, 'clientName'),
    clientEmail: formString(formData, 'clientEmail'),
    clientPhone: formString(formData, 'clientPhone'),
  })
  if (!parsed.success) return validationFailure(parsed.error, copy)

  const { session, requestHeaders } = await readAdminActionContext()
  try {
    const snapshotChanged = await prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUnique({
        where: { id: parsed.data.userId },
        select: {
          id: true,
          name: true,
          language: true,
          timeZone: true,
          updatedAt: true,
          agent: {
            select: {
              id: true,
              phone: true,
              npn: true,
              rank: true,
              updatedAt: true,
              adminProvisionedAccess: {
                select: {
                  id: true,
                  updatedAt: true,
                  individualRank: true,
                  platformSubscription: { select: { plan: true } },
                },
              },
              agencyMemberships: {
                where: { endedAt: null, role: 'OWNER' },
                orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
                take: 1,
                select: { agency: { select: { id: true, name: true, updatedAt: true } } },
              },
            },
          },
          client: {
            select: { id: true, name: true, email: true, phone: true, updatedAt: true },
          },
        },
      })
      if (!current) throw new Error('TARGET_NOT_FOUND')
      if (current.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
        throw new Error('STALE_PROFILE')
      }

      const ownerAgency = current.agent?.agencyMemberships[0]?.agency ?? null
      if (
        (current.agent?.updatedAt.toISOString() ?? null) !== parsed.data.expectedAgentUpdatedAt
        || (ownerAgency?.updatedAt.toISOString() ?? null) !== parsed.data.expectedAgencyUpdatedAt
        || (current.client?.updatedAt.toISOString() ?? null) !== parsed.data.expectedClientUpdatedAt
      ) {
        throw new Error('STALE_PROFILE')
      }
      if (parsed.data.agencyName && !ownerAgency) {
        throw new Error('AGENCY_NOT_EDITABLE')
      }
      if (current.agent && !parsed.data.rank) throw new Error('RANK_REQUIRED')
      if (ownerAgency && !parsed.data.agencyName) throw new Error('AGENCY_NAME_REQUIRED')
      if (ownerAgency && parsed.data.rank !== 'AGENCY_OWNER') {
        throw new Error('AGENCY_OWNER_RANK_LOCKED')
      }
      if (current.client && !parsed.data.clientName) throw new Error('CLIENT_NAME_REQUIRED')

      const individualAccess = current.agent?.adminProvisionedAccess ?? null
      const nextIndividualRank = (
        !ownerAgency
        && individualAccess?.platformSubscription.plan === 'AGENT_INDIVIDUAL'
        && isAgentProfessionalRank(parsed.data.rank)
      )
        ? parsed.data.rank
        : null

      const userUpdate = await transaction.user.updateMany({
        where: { id: current.id, updatedAt: new Date(parsed.data.expectedUpdatedAt) },
        data: {
          name: parsed.data.name,
          language: parsed.data.language,
          timeZone: parsed.data.timeZone,
        },
      })
      if (userUpdate.count !== 1) throw new Error('STALE_PROFILE')
      if (current.agent) {
        const agentUpdate = await transaction.agent.updateMany({
          where: {
            id: current.agent.id,
            updatedAt: new Date(parsed.data.expectedAgentUpdatedAt!),
          },
          data: {
            phone: parsed.data.phone,
            npn: parsed.data.npn,
            rank: ownerAgency ? 'AGENCY_OWNER' : (parsed.data.rank ?? current.agent.rank),
          },
        })
        if (agentUpdate.count !== 1) throw new Error('STALE_PROFILE')
      }
      if (individualAccess && nextIndividualRank) {
        const individualRankUpdate = await transaction.adminProvisionedAccess.updateMany({
          where: {
            id: individualAccess.id,
            updatedAt: individualAccess.updatedAt,
            platformSubscription: { plan: 'AGENT_INDIVIDUAL' },
          },
          data: {
            individualRank: nextIndividualRank,
            updatedById: session.user.id,
          },
        })
        if (individualRankUpdate.count !== 1) throw new Error('STALE_PROFILE')
      }
      if (current.client) {
        const clientUpdate = await transaction.client.updateMany({
          where: {
            id: current.client.id,
            updatedAt: new Date(parsed.data.expectedClientUpdatedAt!),
          },
          data: {
            name: parsed.data.clientName ?? current.client.name,
            email: parsed.data.clientEmail,
            phone: parsed.data.clientPhone,
          },
        })
        if (clientUpdate.count !== 1) throw new Error('STALE_PROFILE')
      }
      if (ownerAgency && parsed.data.agencyName) {
        const agencyUpdate = await transaction.agency.updateMany({
          where: {
            id: ownerAgency.id,
            updatedAt: new Date(parsed.data.expectedAgencyUpdatedAt!),
          },
          data: { name: parsed.data.agencyName },
        })
        if (agencyUpdate.count !== 1) throw new Error('STALE_PROFILE')
      }

      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'ADMIN_USER_PROFILE_UPDATED',
          entity: 'User',
          entityId: current.id,
          before: {
            name: current.name,
            language: current.language,
            timeZone: current.timeZone,
            phone: current.agent?.phone ?? current.client?.phone ?? null,
            npn: current.agent?.npn ?? null,
            rank: current.agent?.rank ?? null,
            agencyName: ownerAgency?.name ?? null,
            clientName: current.client?.name ?? null,
            clientEmail: current.client?.email ?? null,
          },
          after: {
            name: parsed.data.name,
            language: parsed.data.language,
            timeZone: parsed.data.timeZone,
            phone: parsed.data.phone ?? parsed.data.clientPhone,
            npn: parsed.data.npn,
            rank: parsed.data.rank ?? current.agent?.rank ?? null,
            agencyName: parsed.data.agencyName ?? ownerAgency?.name ?? null,
            clientName: parsed.data.clientName ?? current.client?.name ?? null,
            clientEmail: parsed.data.clientEmail,
          },
        },
      })

      return current.name !== parsed.data.name || current.language !== parsed.data.language
    })

    let sessionRefreshFailed = false
    if (snapshotChanged) {
      try {
        // Name and language live in Better Auth's session snapshot. Revoking
        // the target sessions applies the committed profile atomically on the
        // next sign-in without issuing a second, unaudited User write.
        await auth.api.revokeUserSessions({
          headers: requestHeaders,
          body: { userId: parsed.data.userId },
        })
      } catch (revokeError) {
        sessionRefreshFailed = true
        console.error('Admin user session refresh failed', revokeError)
      }
    }

    revalidateUserSurfaces(parsed.data.userId)
    return {
      status: 'success',
      message: sessionRefreshFailed
        ? copy(
            'Dados atualizados. Encerre as sessões do usuário para aplicar nome e idioma imediatamente.',
            'Details updated. Revoke the user sessions to apply name and language immediately.',
          )
        : copy('Dados do usuário atualizados.', 'User details updated.'),
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'STALE_PROFILE') {
      return {
        status: 'error',
        message: copy(
          'Este perfil mudou em outra sessão. Atualize a página antes de salvar novamente.',
          'This profile changed in another session. Refresh the page before saving again.',
        ),
      }
    }
    if (error instanceof Error && error.message === 'TARGET_NOT_FOUND') {
      return { status: 'error', message: copy('Usuário não encontrado.', 'User not found.') }
    }
    if (error instanceof Error && error.message === 'AGENCY_NOT_EDITABLE') {
      return {
        status: 'error',
        message: copy('Somente a agência pertencente a este usuário pode ser editada aqui.', 'Only the agency owned by this user can be edited here.'),
      }
    }
    if (error instanceof Error && error.message === 'RANK_REQUIRED') {
      return {
        status: 'error',
        message: copy('Selecione um cargo válido para o agente.', 'Select a valid agent rank.'),
        fieldErrors: { rank: copy('Cargo obrigatório.', 'Rank is required.') },
      }
    }
    if (error instanceof Error && error.message === 'AGENCY_NAME_REQUIRED') {
      return {
        status: 'error',
        message: copy('Informe o nome da agência.', 'Enter the agency name.'),
        fieldErrors: { agencyName: copy('Nome da agência obrigatório.', 'Agency name is required.') },
      }
    }
    if (error instanceof Error && error.message === 'AGENCY_OWNER_RANK_LOCKED') {
      return {
        status: 'error',
        message: copy(
          'O cargo de responsável pela agência é protegido e não pode ser alterado.',
          'The agency owner rank is protected and cannot be changed.',
        ),
      }
    }
    if (error instanceof Error && error.message === 'CLIENT_NAME_REQUIRED') {
      return {
        status: 'error',
        message: copy('Informe o nome do cliente.', 'Enter the client name.'),
        fieldErrors: { clientName: copy('Nome do cliente obrigatório.', 'Client name is required.') },
      }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        status: 'error',
        message: copy('Já existe outro perfil usando este NPN.', 'Another profile already uses this NPN.'),
        fieldErrors: { npn: copy('NPN já cadastrado.', 'NPN already registered.') },
      }
    }
    console.error('Admin user profile update failed', error)
    return {
      status: 'error',
      message: copy('Não foi possível atualizar o usuário agora.', 'We could not update the user right now.'),
    }
  }
}

export async function updateManagedUserAccessAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  const { copy } = await getServerI18n()
  const parsed = accessSchema.safeParse({
    userId: formString(formData, 'userId'),
    intent: formString(formData, 'intent'),
    reason: formString(formData, 'reason'),
  })
  if (!parsed.success) return validationFailure(parsed.error, copy)

  const { session, requestHeaders } = await readAdminActionContext()
  const current = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: {
      id: true,
      role: true,
      banned: true,
      banReason: true,
    },
  })
  if (!current) return { status: 'error', message: copy('Usuário não encontrado.', 'User not found.') }
  if (current.id === session.user.id && parsed.data.intent === 'SUSPEND') {
    return {
      status: 'error',
      message: copy('Você não pode suspender a própria conta.', 'You cannot suspend your own account.'),
    }
  }
  if (current.role === 'ADMIN' && parsed.data.intent === 'SUSPEND') {
    return {
      status: 'error',
      message: copy(
        'Contas administrativas não podem ser suspensas por este painel.',
        'Administrative accounts cannot be suspended from this panel.',
      ),
    }
  }

  const intentMatchesState = parsed.data.intent === 'SUSPEND' ? current.banned : !current.banned
  if (intentMatchesState) {
    return {
      status: 'success',
      message: parsed.data.intent === 'SUSPEND'
        ? copy('A conta já está suspensa.', 'The account is already suspended.')
        : copy('A conta já está ativa.', 'The account is already active.'),
    }
  }

  try {
    if (parsed.data.intent === 'SUSPEND') {
      await auth.api.banUser({
        headers: requestHeaders,
        body: { userId: current.id, banReason: parsed.data.reason },
      })
    } else {
      await auth.api.unbanUser({ headers: requestHeaders, body: { userId: current.id } })
    }

    try {
      await prisma.auditLog.create({
          data: {
            userId: session.user.id,
            action: parsed.data.intent === 'SUSPEND'
              ? 'ADMIN_USER_SUSPENDED'
              : 'ADMIN_USER_RESTORED',
            entity: 'User',
            entityId: current.id,
            before: {
              accessStatus: current.banned ? 'SUSPENDED' : 'ACTIVE',
              reason: current.banReason,
            },
            after: {
              accessStatus: parsed.data.intent === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE',
              reason: parsed.data.intent === 'SUSPEND' ? parsed.data.reason : null,
            },
          },
        })
    } catch (persistenceError) {
      if (parsed.data.intent === 'SUSPEND') {
        await auth.api.unbanUser({ headers: requestHeaders, body: { userId: current.id } })
      } else {
        await auth.api.banUser({
          headers: requestHeaders,
          body: { userId: current.id, banReason: current.banReason ?? 'Suspensão administrativa restaurada' },
        })
      }
      throw persistenceError
    }

    revalidateUserSurfaces(current.id)
    return {
      status: 'success',
      message: parsed.data.intent === 'SUSPEND'
        ? copy('Conta suspensa e sessões encerradas.', 'Account suspended and sessions revoked.')
        : copy('Acesso do usuário restaurado.', 'User access restored.'),
    }
  } catch (error) {
    console.error('Admin user access update failed', error)
    return {
      status: 'error',
      message: copy('Não foi possível alterar o acesso agora.', 'We could not change access right now.'),
    }
  }
}

export async function requestManagedUserPasswordResetAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  const { copy } = await getServerI18n()
  const parsed = targetSchema.safeParse({ userId: formString(formData, 'userId') })
  if (!parsed.success) return validationFailure(parsed.error, copy)
  const { session, requestHeaders } = await readAdminActionContext()
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, email: true, language: true, banned: true },
  })
  if (!target) return { status: 'error', message: copy('Usuário não encontrado.', 'User not found.') }
  if (target.banned) {
    return {
      status: 'error',
      message: copy('Restaure o acesso antes de enviar a redefinição.', 'Restore access before sending a reset.'),
    }
  }

  try {
    await auth.api.requestPasswordReset({
      headers: requestHeaders,
      body: { email: target.email, redirectTo: `/reset-password?lang=${target.language}` },
    })
    try {
      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'ADMIN_PASSWORD_RESET_REQUESTED',
          entity: 'User',
          entityId: target.id,
          after: { delivery: 'EMAIL', recipient: target.email },
        },
      })
    } catch (auditError) {
      // Delivery already succeeded; do not invite duplicate reset emails just
      // because the secondary trace write failed.
      console.error('Admin password reset audit failed after delivery', auditError)
    }
    revalidateUserSurfaces(target.id)
    return {
      status: 'success',
      message: copy(`Enviamos a redefinição para ${target.email}.`, `We sent the reset to ${target.email}.`),
    }
  } catch (error) {
    console.error('Admin password reset request failed', error)
    return {
      status: 'error',
      message: copy('Não foi possível enviar a redefinição agora.', 'We could not send the reset right now.'),
    }
  }
}

export async function resendManagedUserVerificationAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  const { copy } = await getServerI18n()
  const parsed = targetSchema.safeParse({ userId: formString(formData, 'userId') })
  if (!parsed.success) return validationFailure(parsed.error, copy)
  const { session, requestHeaders } = await readAdminActionContext()
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, email: true, emailVerified: true, banned: true },
  })
  if (!target) return { status: 'error', message: copy('Usuário não encontrado.', 'User not found.') }
  if (target.emailVerified) {
    return { status: 'success', message: copy('O e-mail já está verificado.', 'The email is already verified.') }
  }
  if (target.banned) {
    return {
      status: 'error',
      message: copy('Restaure o acesso antes de reenviar a verificação.', 'Restore access before resending verification.'),
    }
  }

  try {
    await auth.api.sendVerificationEmail({
      headers: publicAuthHeaders(requestHeaders),
      body: { email: target.email, callbackURL: '/login?verified=1' },
    })
    try {
      await prisma.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'ADMIN_EMAIL_VERIFICATION_SENT',
          entity: 'User',
          entityId: target.id,
          after: { recipient: target.email },
        },
      })
    } catch (auditError) {
      console.error('Admin verification audit failed after delivery', auditError)
    }
    revalidateUserSurfaces(target.id)
    return {
      status: 'success',
      message: copy(`Verificação reenviada para ${target.email}.`, `Verification resent to ${target.email}.`),
    }
  } catch (error) {
    console.error('Admin verification email failed', error)
    return {
      status: 'error',
      message: copy('Não foi possível enviar a verificação agora.', 'We could not send verification right now.'),
    }
  }
}

export async function revokeManagedUserSessionsAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  const { copy } = await getServerI18n()
  const parsed = targetSchema.safeParse({ userId: formString(formData, 'userId') })
  if (!parsed.success) return validationFailure(parsed.error, copy)
  const { session, requestHeaders } = await readAdminActionContext()
  if (parsed.data.userId === session.user.id) {
    return {
      status: 'error',
      message: copy('Use “Sair” para encerrar sua própria sessão.', 'Use “Sign out” to end your own session.'),
    }
  }
  const target = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true, _count: { select: { sessions: true } } },
  })
  if (!target) return { status: 'error', message: copy('Usuário não encontrado.', 'User not found.') }

  try {
    const delegatedSessions = target.role === 'ADMIN'
      ? await prisma.session.findMany({
          where: { impersonatedBy: target.id },
          select: { token: true },
        })
      : []
    await auth.api.revokeUserSessions({
      headers: requestHeaders,
      body: { userId: target.id },
    })
    // A support preview belongs to the viewed user, not to the administrator
    // who opened it. Revoke those delegated sessions explicitly when a Keepr
    // One staff member's access is being terminated.
    for (const delegated of delegatedSessions) {
      await auth.api.revokeUserSession({
        headers: requestHeaders,
        body: { sessionToken: delegated.token },
      })
    }
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: 'ADMIN_USER_SESSIONS_REVOKED',
        entity: 'User',
        entityId: target.id,
        before: {
          activeSessions: target._count.sessions,
          delegatedPreviewSessions: delegatedSessions.length,
        },
        after: { activeSessions: 0 },
      },
    })
    revalidateUserSurfaces(target.id)
    return {
      status: 'success',
      message: copy('Todas as sessões do usuário foram encerradas.', 'All user sessions were revoked.'),
    }
  } catch (error) {
    console.error('Admin session revocation failed', error)
    return {
      status: 'error',
      message: copy('Não foi possível encerrar as sessões agora.', 'We could not revoke sessions right now.'),
    }
  }
}

export async function updateManagedUserProductAccessAction(
  _previousState: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  const { copy } = await getServerI18n()
  const rawTrialDays = formString(formData, 'trialDays')
  const parsed = productAccessSchema.safeParse({
    userId: formString(formData, 'userId'),
    expectedUpdatedAt: formString(formData, 'expectedUpdatedAt'),
    intent: formString(formData, 'intent'),
    trialDays: rawTrialDays || undefined,
    reason: formString(formData, 'reason'),
    modules: formData.getAll('modules').filter((value): value is string => typeof value === 'string'),
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const field = issue.path[0]
      if (typeof field !== 'string' || fieldErrors[field]) continue
      fieldErrors[field] = field === 'trialDays'
        ? copy('Escolha de 1 a 365 dias.', 'Choose from 1 to 365 days.')
        : field === 'reason'
          ? copy('Explique o motivo em pelo menos 5 caracteres.', 'Explain the reason in at least 5 characters.')
          : field === 'modules'
            ? copy('O módulo Hoje deve permanecer liberado.', 'The Today module must remain enabled.')
            : copy('Valor inválido.', 'Invalid value.')
    }
    return {
      status: 'error',
      message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
      fieldErrors,
    }
  }

  const { session } = await readAdminActionContext()
  const now = new Date()
  try {
    const current = await prisma.adminProvisionedAccess.findFirst({
      where: { agent: { userId: parsed.data.userId } },
      select: {
        id: true,
        updatedAt: true,
        modules: true,
        paymentRequiredAt: true,
        paymentReason: true,
        platformSubscription: {
          select: {
            id: true,
            plan: true,
            status: true,
            currentPeriodStart: true,
            currentPeriodEnd: true,
            stripeCustomerId: true,
            stripeSubscriptionId: true,
            updatedAt: true,
          },
        },
      },
    })
    if (!current) {
      return {
        status: 'error',
        message: copy(
          'Esta conta não foi provisionada pelo painel administrativo.',
          'This account was not provisioned from the admin panel.',
        ),
      }
    }
    if (current.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
      return {
        status: 'error',
        message: copy(
          'O acesso mudou em outra sessão. Atualize a página antes de salvar.',
          'Access changed in another session. Refresh the page before saving.',
        ),
      }
    }

    const providerManaged = Boolean(
      current.platformSubscription.stripeCustomerId
      || current.platformSubscription.stripeSubscriptionId,
    )
    if (providerManaged && parsed.data.intent !== 'SAVE_MODULES') {
      return {
        status: 'error',
        message: copy(
          'Esta assinatura já é gerenciada pelo Stripe. Ajuste a cobrança pelo Stripe.',
          'This subscription is already managed by Stripe. Update billing in Stripe.',
        ),
      }
    }

    const orderedModules = PLATFORM_MODULE_VALUES.filter((module) =>
      parsed.data.modules.includes(module),
    )
    if (
      current.platformSubscription.plan !== 'AGENCY'
      && orderedModules.some((module) => module === 'AGENCY' || module === 'TEAM')
    ) {
      return {
        status: 'error',
        message: copy(
          'Revise os módulos liberados para este plano.',
          'Review the modules enabled for this plan.',
        ),
        fieldErrors: {
          modules: copy(
            'Agência e Equipe exigem o plano Agência.',
            'Agency and Team require the Agency plan.',
          ),
        },
      }
    }
    const trialEndsAt = parsed.data.intent === 'START_TRIAL'
      ? new Date(now.getTime() + parsed.data.trialDays! * 86_400_000)
      : null

    await prisma.$transaction(async (transaction) => {
      const accessUpdate = await transaction.adminProvisionedAccess.updateMany({
        where: { id: current.id, updatedAt: new Date(parsed.data.expectedUpdatedAt) },
        data: parsed.data.intent === 'SAVE_MODULES'
          ? { modules: orderedModules, updatedById: session.user.id, updatedAt: now }
          : parsed.data.intent === 'START_TRIAL'
            ? {
                paymentRequiredAt: null,
                paymentReason: null,
                updatedById: session.user.id,
                updatedAt: now,
              }
            : {
                paymentRequiredAt: now,
                paymentReason: parsed.data.reason,
                updatedById: session.user.id,
                updatedAt: now,
              },
      })
      if (accessUpdate.count !== 1) throw new Error('STALE_PRODUCT_ACCESS')

      if (parsed.data.intent === 'START_TRIAL') {
        const subscriptionUpdate = await transaction.platformSubscription.updateMany({
          where: {
            id: current.platformSubscription.id,
            updatedAt: current.platformSubscription.updatedAt,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
          data: {
            status: 'TRIALING',
            currentPeriodStart: now,
            currentPeriodEnd: trialEndsAt!,
            cancelAtPeriodEnd: false,
            canceledAt: null,
          },
        })
        if (subscriptionUpdate.count !== 1) throw new Error('STALE_PRODUCT_ACCESS')
      } else if (parsed.data.intent === 'REQUIRE_PAYMENT') {
        const subscriptionUpdate = await transaction.platformSubscription.updateMany({
          where: {
            id: current.platformSubscription.id,
            updatedAt: current.platformSubscription.updatedAt,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
          data: {
            status: 'PAST_DUE',
            currentPeriodStart: now,
            currentPeriodEnd: now,
            cancelAtPeriodEnd: false,
            canceledAt: null,
          },
        })
        if (subscriptionUpdate.count !== 1) throw new Error('STALE_PRODUCT_ACCESS')
      }

      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: parsed.data.intent === 'SAVE_MODULES'
            ? 'ADMIN_USER_MODULES_UPDATED'
            : parsed.data.intent === 'START_TRIAL'
              ? 'ADMIN_USER_TRIAL_UPDATED'
              : 'ADMIN_USER_PAYMENT_REQUIRED',
          entity: 'AdminProvisionedAccess',
          entityId: current.id,
          before: {
            modules: current.modules,
            paymentRequiredAt: current.paymentRequiredAt?.toISOString() ?? null,
            paymentReason: current.paymentReason,
            subscriptionStatus: current.platformSubscription.status,
            subscriptionUpdatedAt: current.platformSubscription.updatedAt.toISOString(),
            currentPeriodStart: current.platformSubscription.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: current.platformSubscription.currentPeriodEnd?.toISOString() ?? null,
          },
          after: parsed.data.intent === 'SAVE_MODULES'
            ? { modules: orderedModules }
            : parsed.data.intent === 'START_TRIAL'
              ? {
                  subscriptionStatus: 'TRIALING',
                  currentPeriodStart: now.toISOString(),
                  currentPeriodEnd: trialEndsAt!.toISOString(),
                  paymentRequiredAt: null,
                }
              : {
                  subscriptionStatus: 'PAST_DUE',
                  paymentRequiredAt: now.toISOString(),
                  paymentReason: parsed.data.reason,
                },
        },
      })
    })

    revalidateUserSurfaces(parsed.data.userId)
    return {
      status: 'success',
      message: parsed.data.intent === 'SAVE_MODULES'
        ? copy('Módulos liberados atualizados.', 'Enabled modules updated.')
        : parsed.data.intent === 'START_TRIAL'
          ? copy(
              `Teste liberado por ${parsed.data.trialDays} dias.`,
              `Trial enabled for ${parsed.data.trialDays} days.`,
            )
          : copy(
              'Pagamento exigido. O usuário continuará conseguindo entrar para assinar.',
              'Payment required. The user can still sign in to subscribe.',
            ),
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'STALE_PRODUCT_ACCESS') {
      return {
        status: 'error',
        message: copy(
          'O acesso mudou em outra sessão. Atualize a página antes de salvar.',
          'Access changed in another session. Refresh the page before saving.',
        ),
      }
    }
    console.error('Admin product access update failed', error)
    return {
      status: 'error',
      message: copy(
        'Não foi possível atualizar o acesso ao produto agora.',
        'We could not update product access right now.',
      ),
    }
  }
}
