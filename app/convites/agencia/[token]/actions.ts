'use server'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { hashPassword } from 'better-auth/crypto'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getRequiredOnboardingModulesForAccess } from '@/lib/agent-onboarding'
import {
  hashAgencyInvitationToken,
  isLocalBillingSimulationEnabled,
  isValidAgencyInvitationToken,
} from '@/lib/agency-invitations'
import { findActiveAgencyInvitationAuthority } from '@/lib/agency-invitation-authority'
import { getDownlineIds } from '@/lib/hierarchy'
import { getAgencyInvitationPriceCents } from '@/lib/plans'
import { prisma } from '@/lib/prisma'
import { createStripeAgencyInvitationCheckout } from '@/lib/stripe/agency-invitation-checkout'

type AcceptedPlan = 'AGENT_AGENCY_MEMBER' | 'AGENCY'
type AgencyInvitationIntendedType = 'AGENT' | 'AGENCY'

export type AgencyInvitationAcceptanceState = {
  status: 'idle' | 'checkout' | 'success' | 'error'
  message: string
  fieldErrors?: Record<string, string[]>
  nextUrl?: string
  createdAccount?: boolean
}

export const INITIAL_AGENCY_INVITATION_ACCEPTANCE_STATE: AgencyInvitationAcceptanceState = {
  status: 'idle',
  message: '',
}

const acceptanceSchema = z.strictObject({
  token: z.string().trim().min(1),
  plan: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.enum(['AGENT_AGENCY_MEMBER', 'AGENCY'], {
      error: 'Escolha um dos planos disponíveis.',
    }).optional(),
  ),
  name: z.string().trim().max(100).default(''),
  agencyName: z.string().trim().max(120).default(''),
  password: z.string().max(128).default(''),
  confirmPassword: z.string().max(128).default(''),
  acceptedTerms: z.string().default(''),
  website: z.string().max(0).default(''),
})

const invitationSelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  expiresAt: true,
  intendedType: true,
  monthlyPriceCents: true,
  recruitmentStage: true,
  stageUpdatedAt: true,
  agency: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, status: true } },
} satisfies Prisma.AgencyInvitationSelect

const userForAcceptanceSelect = {
  id: true,
  email: true,
  role: true,
  agent: {
    select: {
      id: true,
      status: true,
      parentAgentId: true,
      onboarding: { select: { status: true } },
      founderEnrollment: { select: { id: true, accountType: true } },
      adminProvisionedAccess: { select: { id: true } },
      agencyMemberships: {
        where: { endedAt: null },
        orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
        take: 2,
        select: {
          id: true,
          role: true,
          agencyId: true,
          agency: { select: { id: true, name: true, parentAgencyId: true } },
        },
      },
    },
  },
} satisfies Prisma.UserSelect

class InvitationAcceptanceError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message)
    this.name = 'InvitationAcceptanceError'
  }
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function actionError(message: string, field?: string): AgencyInvitationAcceptanceState {
  return {
    status: 'error',
    message,
    ...(field ? { fieldErrors: { [field]: [message] } } : {}),
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function intendedTypePlan(
  intendedType: AgencyInvitationIntendedType,
): AcceptedPlan {
  return intendedType === 'AGENCY' ? 'AGENCY' : 'AGENT_AGENCY_MEMBER'
}

function resolveInvitationPlan(input: {
  intendedType: AgencyInvitationIntendedType | null
  submittedPlan?: AcceptedPlan
}): AcceptedPlan {
  if (input.intendedType !== null) {
    const requiredPlan = intendedTypePlan(input.intendedType)
    if (input.submittedPlan && input.submittedPlan !== requiredPlan) {
      throw new InvitationAcceptanceError(
        'O tipo deste convite foi definido pela agência e não pode ser alterado.',
        'plan',
      )
    }
    return requiredPlan
  }

  if (!input.submittedPlan) {
    throw new InvitationAcceptanceError(
      'Escolha um dos planos disponíveis.',
      'plan',
    )
  }
  return input.submittedPlan
}

function resolveInvitationMonthlyPrice(input: {
  intendedType: AgencyInvitationIntendedType | null
  plan: AcceptedPlan
  monthlyPriceCents: number
}): number {
  // Legacy invitations predate a fixed type. Their stored 4,990 snapshot only
  // represented the member option, so derive the discounted snapshot from the
  // plan selected during acceptance. The atomic claim below persists 8,990
  // when a legacy invitee chooses Agency.
  if (input.intendedType === null) {
    return getAgencyInvitationPriceCents(
      input.plan === 'AGENCY' ? 'AGENCY' : 'AGENT',
    )
  }

  const expectedPrice = getAgencyInvitationPriceCents(input.intendedType)
  if (
    !Number.isSafeInteger(input.monthlyPriceCents)
    || input.monthlyPriceCents !== expectedPrice
  ) {
    throw new InvitationAcceptanceError(
      'O preço deste convite não está mais disponível. Peça à agência para emitir um novo convite.',
    )
  }

  return input.monthlyPriceCents
}

function validateRegistrationFields(input: {
  name: string
  password: string
  confirmPassword: string
}): AgencyInvitationAcceptanceState | null {
  if (input.name.length < 2) {
    return actionError('Informe seu nome completo.', 'name')
  }
  if (input.password.length < 8) {
    return actionError('Crie uma senha com pelo menos 8 caracteres.', 'password')
  }
  if (input.password !== input.confirmPassword) {
    return actionError('As senhas não coincidem.', 'confirmPassword')
  }
  return null
}

function invitationLoginUrl(email: string): string {
  const params = new URLSearchParams({
    invitation: 'accepted',
    email,
  })
  return `/login?${params.toString()}`
}

function subscriptionPeriodEnd(now: Date): Date {
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000)
}

export async function acceptAgencyInvitationAction(
  _previousState: AgencyInvitationAcceptanceState,
  formData: FormData,
): Promise<AgencyInvitationAcceptanceState> {
  const parsed = acceptanceSchema.safeParse({
    token: formString(formData, 'token'),
    plan: formString(formData, 'plan'),
    name: formString(formData, 'name'),
    agencyName: formString(formData, 'agencyName'),
    password: formString(formData, 'password'),
    confirmPassword: formString(formData, 'confirmPassword'),
    acceptedTerms: formString(formData, 'acceptedTerms'),
    website: formString(formData, 'website'),
  })

  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Revise os dados do aceite.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const input = parsed.data
  if (!isValidAgencyInvitationToken(input.token)) {
    return actionError('Este convite é inválido, expirou ou já foi utilizado.')
  }
  if (input.acceptedTerms !== 'on') {
    return actionError('Aceite os termos para confirmar o plano.', 'acceptedTerms')
  }
  const simulationEnabled = isLocalBillingSimulationEnabled()

  const tokenHash = hashAgencyInvitationToken(input.token)
  const now = new Date()
  const invitation = await prisma.agencyInvitation.findUnique({
    where: { tokenHash },
    select: invitationSelect,
  })

  if (
    !invitation
    || invitation.status !== 'PENDING'
    || invitation.expiresAt <= now
    || invitation.invitedBy.status !== 'ACTIVE'
  ) {
    return actionError('Este convite é inválido, expirou ou já foi utilizado.')
  }

  let plan: AcceptedPlan
  let unitAmountCents: number
  try {
    plan = resolveInvitationPlan({
      intendedType: invitation.intendedType,
      submittedPlan: input.plan,
    })
    unitAmountCents = resolveInvitationMonthlyPrice({
      intendedType: invitation.intendedType,
      plan,
      monthlyPriceCents: invitation.monthlyPriceCents,
    })
  } catch (error) {
    if (error instanceof InvitationAcceptanceError) {
      return actionError(error.message, error.field)
    }
    throw error
  }

  const invitedEmail = normalizeEmail(invitation.email)
  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: invitedEmail, mode: 'insensitive' } },
    select: userForAcceptanceSelect,
  })
  const session = await auth.api.getSession({ headers: await headers() })

  if (existingUser) {
    const sessionEmail = session ? normalizeEmail(session.user.email) : null
    if (
      !session
      || session.user.id !== existingUser.id
      || sessionEmail !== invitedEmail
    ) {
      return actionError('Entre com a conta que recebeu este convite antes de continuar.')
    }
    if (existingUser.role !== 'AGENT' || !existingUser.agent || existingUser.agent.status !== 'ACTIVE') {
      return actionError('A conta convidada não está disponível para este tipo de plano.')
    }
    if (existingUser.agent.founderEnrollment && plan === 'AGENT_AGENCY_MEMBER') {
      return actionError(
        'Nesta primeira versão, uma conta Founder deve escolher o plano Agência para mudar de estrutura.',
      )
    }
    if (existingUser.agent.adminProvisionedAccess) {
      return actionError(
        'Esta conta é gerenciada pela Keepr One. A mudança para um plano por convite precisa ser concluída pelo suporte.',
      )
    }
    if (existingUser.agent.id === invitation.invitedBy.id) {
      return actionError('Você não pode aceitar um convite enviado pela própria conta.')
    }
  } else {
    if (session) {
      return actionError('Saia da conta atual antes de criar o acesso deste convite.')
    }
    const registrationError = validateRegistrationFields(input)
    if (registrationError) return registrationError
  }

  const existingOwnedAgency = existingUser?.agent?.agencyMemberships.find(
    (membership) => membership.role === 'OWNER',
  )
  if (plan === 'AGENCY' && !existingOwnedAgency && input.agencyName.length < 2) {
    return actionError('Informe o nome da sua agência.', 'agencyName')
  }

  const passwordHash = existingUser ? null : await hashPassword(input.password)

  if (!simulationEnabled) {
    try {
      const inviterAuthority = await findActiveAgencyInvitationAuthority(prisma, {
        agencyId: invitation.agency.id,
        agentId: invitation.invitedBy.id,
        now,
      })
      if (!inviterAuthority) {
        return actionError(
          'A agência que enviou este convite não possui autorização e assinatura ativas.',
        )
      }

      const currentProviderSubscription = existingUser?.agent
        ? await prisma.platformSubscription.findFirst({
            where: {
              status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
              stripeSubscriptionId: { not: null },
              OR: [
                { agentId: existingUser.agent.id },
                {
                  agencyMembership: {
                    agentId: existingUser.agent.id,
                    endedAt: null,
                  },
                },
                {
                  agency: {
                    memberships: {
                      some: {
                        agentId: existingUser.agent.id,
                        role: 'OWNER',
                        endedAt: null,
                      },
                    },
                  },
                },
              ],
            },
            select: {
              id: true,
              stripeCustomerId: true,
              stripeSubscriptionId: true,
            },
          })
        : null
      if (currentProviderSubscription) {
        return actionError(
          'Esta conta já possui uma assinatura vinculada à Stripe. A troca de plano precisa ser concluída pelo suporte antes de aceitar este convite.',
        )
      }

      const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim()
        || process.env.BETTER_AUTH_URL?.trim()
      if (!configuredOrigin) throw new Error('APP_ORIGIN_MISSING')

      const checkout = await createStripeAgencyInvitationCheckout({
        invitationId: invitation.id,
        invitedEmail,
        name: existingUser?.agent ? invitation.name ?? 'Usuário convidado' : input.name,
        agencyName: plan === 'AGENCY'
          ? input.agencyName || existingOwnedAgency?.agency.name || null
          : null,
        passwordHash,
        userId: existingUser?.id ?? null,
        plan,
        inviterRole: inviterAuthority.role,
        unitAmountCents,
        acceptedTermsAt: now,
        invitationExpiresAt: invitation.expiresAt,
        origin: configuredOrigin.replace(/\/$/, ''),
        invitationToken: input.token,
        stripeCustomerId: null,
      })

      return {
        status: 'checkout',
        message: 'Checkout seguro preparado. Você será direcionado para a Stripe.',
        nextUrl: checkout.checkoutUrl,
        createdAccount: false,
      }
    } catch (error) {
      console.error('Agency invitation Checkout creation failed', {
        code: error instanceof Error ? error.message : 'UNKNOWN',
        invitationId: invitation.id,
      })
      return actionError(
        'Não foi possível abrir o pagamento agora. Nenhuma conta, vínculo ou cobrança foi criada.',
      )
    }
  }

  const currentPeriodEnd = subscriptionPeriodEnd(now)

  try {
    const result = await prisma.$transaction(async (transaction) => {
      const currentInvitation = await transaction.agencyInvitation.findUnique({
        where: { tokenHash },
        select: invitationSelect,
      })
      if (
        !currentInvitation
        || currentInvitation.status !== 'PENDING'
        || currentInvitation.expiresAt <= now
        || currentInvitation.invitedBy.status !== 'ACTIVE'
      ) {
        throw new InvitationAcceptanceError('Este convite é inválido, expirou ou já foi utilizado.')
      }
      const transactionPlan = resolveInvitationPlan({
        intendedType: currentInvitation.intendedType,
        submittedPlan: input.plan,
      })
      if (transactionPlan !== plan) {
        throw new InvitationAcceptanceError(
          'O tipo deste convite mudou enquanto ele era confirmado. Atualize a página e tente novamente.',
          'plan',
        )
      }
      const transactionUnitAmountCents = resolveInvitationMonthlyPrice({
        intendedType: currentInvitation.intendedType,
        plan: transactionPlan,
        monthlyPriceCents: currentInvitation.monthlyPriceCents,
      })
      if (transactionUnitAmountCents !== unitAmountCents) {
        throw new InvitationAcceptanceError(
          'O preço deste convite mudou enquanto ele era confirmado. Atualize a página e tente novamente.',
        )
      }

      // The bearer token proves possession of the invitation, not that its
      // issuer still controls an entitled agency. Recheck both facts in the
      // same serializable transaction before creating any account or link.
      const inviterAuthority = await findActiveAgencyInvitationAuthority(
        transaction,
        {
          agencyId: currentInvitation.agency.id,
          agentId: currentInvitation.invitedBy.id,
          now,
        },
      )
      if (!inviterAuthority) {
        throw new InvitationAcceptanceError(
          'A agência que enviou este convite não possui autorização e assinatura ativas.',
        )
      }

      let user: Prisma.UserGetPayload<{ select: typeof userForAcceptanceSelect }> | null = await transaction.user.findFirst({
        where: { email: { equals: invitedEmail, mode: 'insensitive' } },
        select: userForAcceptanceSelect,
      })
      let createdAccount = false

      if (user) {
        if (
          !existingUser
          || user.id !== existingUser.id
          || user.role !== 'AGENT'
          || !user.agent
          || user.agent.status !== 'ACTIVE'
        ) {
          throw new InvitationAcceptanceError('A conta convidada mudou enquanto o convite era confirmado.')
        }
      } else {
        if (!passwordHash) {
          throw new InvitationAcceptanceError('Não foi possível proteger a nova conta.')
        }
        const createdUser = await transaction.user.create({
          data: {
            email: invitedEmail,
            name: input.name,
            role: 'AGENT',
          },
          select: { id: true, email: true },
        })
        await transaction.account.create({
          data: {
            id: randomUUID(),
            accountId: createdUser.id,
            providerId: 'credential',
            userId: createdUser.id,
            password: passwordHash,
          },
        })
        const createdAgent = await transaction.agent.create({
          data: {
            userId: createdUser.id,
            parentAgentId: currentInvitation.invitedBy.id,
            rank: plan === 'AGENCY' ? 'AGENCY_OWNER' : 'AGENT',
            status: 'ACTIVE',
            promotionAccessScope: plan === 'AGENCY' ? 'AGENCY' : 'PERSONAL',
          },
          select: {
            id: true,
            status: true,
            parentAgentId: true,
            onboarding: { select: { status: true } },
            founderEnrollment: { select: { id: true, accountType: true } },
            adminProvisionedAccess: { select: { id: true } },
            agencyMemberships: {
              where: { endedAt: null },
              select: {
                id: true,
                role: true,
                agencyId: true,
                agency: { select: { id: true, name: true, parentAgencyId: true } },
              },
            },
          },
        })
        user = {
          id: createdUser.id,
          email: createdUser.email,
          role: 'AGENT',
          agent: createdAgent,
        }
        createdAccount = true
      }

      if (!user) {
        throw new InvitationAcceptanceError('Não foi possível preparar a conta convidada.')
      }
      const agent = user.agent
      if (!agent) {
        throw new InvitationAcceptanceError('A conta convidada não possui um perfil de agente.')
      }
      if (agent.adminProvisionedAccess) {
        throw new InvitationAcceptanceError(
          'Esta conta é gerenciada pela Keepr One. A mudança para um plano por convite precisa ser concluída pelo suporte.',
        )
      }
      if (agent.id === currentInvitation.invitedBy.id) {
        throw new InvitationAcceptanceError(
          'Você não pode aceitar um convite enviado pela própria conta.',
        )
      }
      if (
        agent.parentAgentId !== null
        && agent.parentAgentId !== currentInvitation.invitedBy.id
      ) {
        throw new InvitationAcceptanceError('Este agente já pertence a outra estrutura.')
      }

      if (!createdAccount) {
        const hierarchy = await transaction.agent.findMany({
          select: { id: true, parentAgentId: true },
        })
        if (getDownlineIds(hierarchy, agent.id).includes(currentInvitation.invitedBy.id)) {
          throw new InvitationAcceptanceError('Este convite criaria um ciclo na estrutura.')
        }
      }

      const activeMemberships = agent.agencyMemberships
      if (activeMemberships.length > 1) {
        throw new InvitationAcceptanceError('A conta possui mais de um vínculo ativo e precisa de revisão.')
      }
      if (inviterAuthority.role === 'MEMBER' && activeMemberships.length > 0) {
        throw new InvitationAcceptanceError(
          'Este e-mail não está disponível para um novo convite.',
        )
      }
      if (agent.founderEnrollment && plan === 'AGENT_AGENCY_MEMBER') {
        throw new InvitationAcceptanceError(
          'Nesta primeira versão, uma conta Founder deve escolher o plano Agência para mudar de estrutura.',
        )
      }

      let acceptedMembershipId: string
      let acceptedAgencyId: string
      let promotedFrom: {
        invitationId: string
        membershipId: string
        recruitmentStage: string
        stageUpdatedAt: Date
      } | null = null

      if (plan === 'AGENT_AGENCY_MEMBER') {
        if (activeMemberships.length > 0) {
          throw new InvitationAcceptanceError('Este agente já possui um vínculo ativo com uma agência.')
        }

        const membership = await transaction.agencyMembership.create({
          data: {
            agencyId: currentInvitation.agency.id,
            agentId: agent.id,
            role: 'MEMBER',
            invitedByAgentId: currentInvitation.invitedBy.id,
          },
          select: { id: true, agencyId: true },
        })
        acceptedMembershipId = membership.id
        acceptedAgencyId = membership.agencyId

        await transaction.agent.update({
          where: { id: agent.id },
          data: {
            parentAgentId: currentInvitation.invitedBy.id,
            promotionAccessScope: 'PERSONAL',
          },
        })
      } else {
        const existingMembership = activeMemberships[0]
        const isDirectMember = existingMembership?.role === 'MEMBER'
          && existingMembership.agencyId === currentInvitation.agency.id
        const isDirectMemberPromotion = inviterAuthority.role === 'OWNER'
          && isDirectMember
          && currentInvitation.intendedType === 'AGENCY'

        if (
          existingMembership?.role === 'MEMBER'
          && !isDirectMemberPromotion
        ) {
          throw new InvitationAcceptanceError(
            isDirectMember
              ? 'Este vínculo requer um novo convite de Agência.'
              : 'Este agente já está vinculado como membro de outra agência.',
          )
        }

        if (isDirectMemberPromotion && existingMembership) {
          const previousInvitation = await transaction.agencyInvitation.findFirst({
            where: {
              agencyId: currentInvitation.agency.id,
              status: 'ACCEPTED',
              intendedType: 'AGENT',
              acceptedAgentId: agent.id,
              acceptedPlan: 'AGENT_AGENCY_MEMBER',
              acceptedMembershipId: existingMembership.id,
            },
            select: {
              id: true,
              recruitmentStage: true,
              stageUpdatedAt: true,
            },
          })
          const memberSubscription = await transaction.platformSubscription.findFirst({
            where: {
              agencyMembershipId: existingMembership.id,
              plan: 'AGENT_AGENCY_MEMBER',
              status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
            },
            select: { id: true },
          })
          if (!previousInvitation || !memberSubscription) {
            throw new InvitationAcceptanceError(
              'Este vínculo não está disponível para promoção. Solicite um novo convite à agência.',
            )
          }

          // Database guards intentionally require this order: the discounted
          // current plan is canceled before its MEMBER row can be ended. Only
          // then can the one-active-membership constraint admit the new OWNER.
          const canceledMemberPlan = await transaction.platformSubscription.updateMany({
            where: {
              id: memberSubscription.id,
              agencyMembershipId: existingMembership.id,
              plan: 'AGENT_AGENCY_MEMBER',
              status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
            },
            data: {
              status: 'CANCELED',
              canceledAt: now,
              cancelAtPeriodEnd: false,
            },
          })
          if (canceledMemberPlan.count !== 1) {
            throw new InvitationAcceptanceError(
              'Este vínculo mudou enquanto o convite era confirmado. Atualize a página e tente novamente.',
            )
          }

          const endedMembership = await transaction.agencyMembership.updateMany({
            where: {
              id: existingMembership.id,
              agencyId: currentInvitation.agency.id,
              agentId: agent.id,
              role: 'MEMBER',
              endedAt: null,
            },
            data: { endedAt: now },
          })
          if (endedMembership.count !== 1) {
            throw new InvitationAcceptanceError(
              'Este vínculo mudou enquanto o convite era confirmado. Atualize a página e tente novamente.',
            )
          }

          const agency = await transaction.agency.create({
            data: {
              name: input.agencyName,
              parentAgencyId: currentInvitation.agency.id,
            },
            select: { id: true },
          })
          const ownerMembership = await transaction.agencyMembership.create({
            data: {
              agencyId: agency.id,
              agentId: agent.id,
              role: 'OWNER',
              invitedByAgentId: currentInvitation.invitedBy.id,
            },
            select: { id: true },
          })
          acceptedMembershipId = ownerMembership.id
          acceptedAgencyId = agency.id
          promotedFrom = {
            invitationId: previousInvitation.id,
            membershipId: existingMembership.id,
            recruitmentStage: previousInvitation.recruitmentStage,
            stageUpdatedAt: previousInvitation.stageUpdatedAt,
          }
        } else if (existingMembership) {
          if (
            existingMembership.agency.parentAgencyId
            && existingMembership.agency.parentAgencyId !== currentInvitation.agency.id
          ) {
            throw new InvitationAcceptanceError('Esta agência já pertence a outra estrutura.')
          }
          if (existingMembership.agencyId === currentInvitation.agency.id) {
            throw new InvitationAcceptanceError('Uma agência não pode ficar abaixo dela mesma.')
          }

          await transaction.agency.update({
            where: { id: existingMembership.agencyId },
            data: { parentAgencyId: currentInvitation.agency.id },
          })
          acceptedMembershipId = existingMembership.id
          acceptedAgencyId = existingMembership.agencyId
        } else {
          const agency = await transaction.agency.create({
            data: {
              name: input.agencyName,
              parentAgencyId: currentInvitation.agency.id,
            },
            select: { id: true },
          })
          const membership = await transaction.agencyMembership.create({
            data: {
              agencyId: agency.id,
              agentId: agent.id,
              role: 'OWNER',
              invitedByAgentId: currentInvitation.invitedBy.id,
            },
            select: { id: true },
          })
          acceptedMembershipId = membership.id
          acceptedAgencyId = agency.id
        }

        await transaction.agent.update({
          where: { id: agent.id },
          data: {
            parentAgentId: currentInvitation.invitedBy.id,
            rank: 'AGENCY_OWNER',
            promotionAccessScope: 'AGENCY',
          },
        })
      }

      // The person can hold only one current commercial plan. End a previous
      // individual row inside the same transaction before writing the selected
      // invited plan; database triggers enforce the same invariant.
      await transaction.platformSubscription.updateMany({
        where: {
          agentId: agent.id,
          plan: 'AGENT_INDIVIDUAL',
          status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
        },
        data: {
          status: 'CANCELED',
          canceledAt: now,
          cancelAtPeriodEnd: false,
        },
      })

      const existingAgencySubscription = plan === 'AGENCY'
        ? await transaction.platformSubscription.findFirst({
            where: {
              agencyId: acceptedAgencyId,
              plan: 'AGENCY',
              status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
            },
            select: { id: true },
          })
        : null

      if (existingAgencySubscription) {
        await transaction.platformSubscription.update({
          where: { id: existingAgencySubscription.id },
          data: {
            status: 'ACTIVE',
            unitAmountCents: transactionUnitAmountCents,
            currency: 'USD',
            currentPeriodStart: now,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
            canceledAt: null,
          },
        })
      } else {
        await transaction.platformSubscription.create({
          data: plan === 'AGENCY'
            ? {
                plan,
                status: 'ACTIVE',
                agencyId: acceptedAgencyId,
                unitAmountCents: transactionUnitAmountCents,
                currency: 'USD',
                currentPeriodStart: now,
                currentPeriodEnd,
              }
            : {
                plan,
                status: 'ACTIVE',
                agencyMembershipId: acceptedMembershipId,
                unitAmountCents: transactionUnitAmountCents,
                currency: 'USD',
                currentPeriodStart: now,
                currentPeriodEnd,
              },
        })
      }

      if (createdAccount) {
        await transaction.agentOnboarding.create({
          data: {
            agentId: agent.id,
            status: 'IN_PROGRESS',
            currentStep: 'WELCOME',
            requiredModules: getRequiredOnboardingModulesForAccess({
              canManageTeam: plan === 'AGENCY',
              canAccessIntegrations: true,
            }),
          },
        })
      }

      if (agent.founderEnrollment && plan === 'AGENCY') {
        await transaction.founderEnrollment.update({
          where: { id: agent.founderEnrollment.id },
          data: {
            accountType: 'AGENCY',
            agencyId: acceptedAgencyId,
          },
        })
      }

      const recruitmentStage = createdAccount || agent.onboarding?.status === 'IN_PROGRESS'
        ? 'ONBOARDING'
        : 'ACTIVE'
      const acceptedIntendedType: AgencyInvitationIntendedType =
        currentInvitation.intendedType ?? (plan === 'AGENCY' ? 'AGENCY' : 'AGENT')
      await transaction.agencyInvitation.updateMany({
        where: {
          acceptedAgentId: agent.id,
          isCurrentCommercial: true,
        },
        data: { isCurrentCommercial: false },
      })
      const claimed = await transaction.agencyInvitation.updateMany({
        where: {
          id: currentInvitation.id,
          agencyId: currentInvitation.agency.id,
          status: 'PENDING',
          intendedType: currentInvitation.intendedType,
          expiresAt: { gt: now },
        },
        data: {
          status: 'ACCEPTED',
          acceptedAt: now,
          acceptedAgentId: agent.id,
          acceptedPlan: plan,
          acceptedMembershipId,
          isCurrentCommercial: true,
          intendedType: acceptedIntendedType,
          monthlyPriceCents: transactionUnitAmountCents,
          recruitmentStage,
          stageUpdatedAt: now,
        },
      })
      if (claimed.count !== 1) {
        throw new InvitationAcceptanceError('Este convite já foi utilizado por outra solicitação.')
      }

      if (promotedFrom && promotedFrom.recruitmentStage !== 'PAUSED') {
        const pausedPreviousInvitation = await transaction.agencyInvitation.updateMany({
          where: {
            id: promotedFrom.invitationId,
            status: 'ACCEPTED',
            acceptedAgentId: agent.id,
            acceptedMembershipId: promotedFrom.membershipId,
            stageUpdatedAt: promotedFrom.stageUpdatedAt,
          },
          data: {
            recruitmentStage: 'PAUSED',
            stageUpdatedAt: now,
          },
        })
        if (pausedPreviousInvitation.count !== 1) {
          throw new InvitationAcceptanceError(
            'O histórico deste vínculo mudou enquanto o convite era confirmado. Atualize a página e tente novamente.',
          )
        }
      }

      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: 'AGENCY_INVITATION_ACCEPTED',
          entity: 'AgencyInvitation',
          entityId: currentInvitation.id,
          after: {
            acceptedPlan: plan,
            acceptedAgentId: agent.id,
            acceptedMembershipId,
            intendedType: acceptedIntendedType,
            monthlyPriceCents: transactionUnitAmountCents,
            recruitmentStage,
            previousRecruitmentStage: currentInvitation.recruitmentStage,
            parentAgentId: currentInvitation.invitedBy.id,
            parentAgencyId: currentInvitation.agency.id,
            simulatedBilling: true,
            currentPeriodEnd: currentPeriodEnd.toISOString(),
            ...(promotedFrom
              ? {
                  promotedFromInvitationId: promotedFrom.invitationId,
                  promotedFromMembershipId: promotedFrom.membershipId,
                }
              : {}),
          },
        },
      })

      return { createdAccount }
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    })

    revalidatePath('/agent/agency')
    revalidatePath('/agent/hierarchy')

    return {
      status: 'success',
      message: result.createdAccount
        ? 'Conta criada e assinatura de demonstração ativada por 30 dias. Nenhuma cobrança real foi realizada.'
        : 'Plano atualizado e assinatura de demonstração ativada por 30 dias. Nenhuma cobrança real foi realizada.',
      nextUrl: result.createdAccount ? invitationLoginUrl(invitedEmail) : '/agent/agency',
      createdAccount: result.createdAccount,
    }
  } catch (error) {
    if (error instanceof InvitationAcceptanceError) {
      return actionError(error.message, error.field)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002' || error.code === 'P2034') {
        return actionError('Este convite já foi utilizado ou a conta mudou. Atualize a página e tente novamente.')
      }
    }

    console.error('Agency invitation acceptance failed', error)
    return actionError('Não foi possível aceitar o convite agora. Nenhuma cobrança foi realizada.')
  }
}
