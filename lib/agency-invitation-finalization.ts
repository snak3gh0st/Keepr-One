import 'server-only'

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { getRequiredOnboardingModulesForAccess } from '@/lib/agent-onboarding'
import { findActiveAgencyInvitationAuthority } from '@/lib/agency-invitation-authority'
import { getDownlineIds } from '@/lib/hierarchy'
import { getAgencyInvitationPriceCents } from '@/lib/plans'
import { prisma } from '@/lib/prisma'

type InvitedPlan = 'AGENT_AGENCY_MEMBER' | 'AGENCY'
type ProviderStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'

const invitationSelect = {
  id: true,
  email: true,
  status: true,
  expiresAt: true,
  intendedType: true,
  monthlyPriceCents: true,
  recruitmentStage: true,
  stageUpdatedAt: true,
  agency: { select: { id: true, name: true } },
  invitedBy: { select: { id: true, status: true } },
} satisfies Prisma.AgencyInvitationSelect

const userSelect = {
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
      agencyMemberships: {
        where: { endedAt: null },
        orderBy: [{ joinedAt: 'desc' as const }, { id: 'desc' as const }],
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

export class AgencyInvitationFinalizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgencyInvitationFinalizationError'
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function expectedInvitationPlan(
  intendedType: 'AGENT' | 'AGENCY' | null,
  selectedPlan: InvitedPlan,
): InvitedPlan {
  if (intendedType === 'AGENT') return 'AGENT_AGENCY_MEMBER'
  if (intendedType === 'AGENCY') return 'AGENCY'
  return selectedPlan
}

function expectedInvitationAmount(input: {
  intendedType: 'AGENT' | 'AGENCY' | null
  plan: InvitedPlan
  storedAmount: number
}): number {
  const intendedType = input.intendedType
    ?? (input.plan === 'AGENCY' ? 'AGENCY' : 'AGENT')
  const expected = getAgencyInvitationPriceCents(intendedType)
  if (input.intendedType !== null && input.storedAmount !== expected) {
    throw new AgencyInvitationFinalizationError(
      'O preço deste convite não está mais disponível.',
    )
  }
  return input.intendedType === null ? expected : input.storedAmount
}

export type FinalizeAgencyInvitationAccessInput = {
  checkoutId: string | null
  invitationId: string
  expectedUserId: string | null
  invitedEmail: string
  name: string
  agencyName: string | null
  passwordHash: string | null
  plan: InvitedPlan
  unitAmountCents: number
  provider: {
    status: ProviderStatus
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    stripeProductId: string | null
    stripePriceId: string | null
    currentPeriodStart: Date
    currentPeriodEnd: Date
    cancelAtPeriodEnd: boolean
    canceledAt: Date | null
  }
}

export async function finalizeAgencyInvitationAccess(
  input: FinalizeAgencyInvitationAccessInput,
): Promise<{ platformSubscriptionId: string; createdAccount: boolean }> {
  if (input.provider.status !== 'ACTIVE' && input.provider.status !== 'TRIALING') {
    throw new AgencyInvitationFinalizationError(
      'A assinatura ainda não foi confirmada pelo provedor.',
    )
  }
  if (input.provider.currentPeriodEnd <= input.provider.currentPeriodStart) {
    throw new AgencyInvitationFinalizationError('O período da assinatura é inválido.')
  }

  const now = new Date()
  return prisma.$transaction(async (transaction) => {
    let reservedAt: Date | null = null
    let reservedInviterRole: 'OWNER' | 'MEMBER' | null = null
    if (input.checkoutId) {
      const checkout = await transaction.agencyInvitationCheckout.findUnique({
        where: { id: input.checkoutId },
        select: {
          id: true,
          invitationId: true,
          email: true,
          userId: true,
          plan: true,
          inviterRole: true,
          status: true,
          unitAmountCents: true,
          acceptedTermsAt: true,
          stripeSubscriptionId: true,
          platformSubscriptionId: true,
        },
      })
      if (!checkout) {
        throw new AgencyInvitationFinalizationError('O checkout deste convite não existe.')
      }
      if (checkout.status === 'FINALIZED') {
        if (
          checkout.invitationId !== input.invitationId
          || checkout.stripeSubscriptionId !== input.provider.stripeSubscriptionId
          || !checkout.platformSubscriptionId
        ) {
          throw new AgencyInvitationFinalizationError('O checkout finalizado não corresponde à assinatura.')
        }
        return {
          platformSubscriptionId: checkout.platformSubscriptionId,
          createdAccount: false,
        }
      }
      if (
        checkout.invitationId !== input.invitationId
        || normalizeEmail(checkout.email) !== normalizeEmail(input.invitedEmail)
        || checkout.userId !== input.expectedUserId
        || checkout.plan !== input.plan
        || checkout.unitAmountCents !== input.unitAmountCents
      ) {
        throw new AgencyInvitationFinalizationError('Os dados do checkout não correspondem ao convite.')
      }
      reservedAt = checkout.acceptedTermsAt
      reservedInviterRole = checkout.inviterRole
    }

    const invitation = await transaction.agencyInvitation.findUnique({
      where: { id: input.invitationId },
      select: invitationSelect,
    })
    if (
      !invitation
      || invitation.status !== 'PENDING'
      || (reservedAt ? reservedAt > invitation.expiresAt : invitation.expiresAt <= now)
      || (!reservedAt && invitation.invitedBy.status !== 'ACTIVE')
    ) {
      throw new AgencyInvitationFinalizationError('Este convite expirou ou já foi utilizado.')
    }
    if (normalizeEmail(invitation.email) !== normalizeEmail(input.invitedEmail)) {
      throw new AgencyInvitationFinalizationError('O e-mail do convite mudou durante o pagamento.')
    }

    const plan = expectedInvitationPlan(invitation.intendedType, input.plan)
    if (plan !== input.plan) {
      throw new AgencyInvitationFinalizationError('O plano confirmado não corresponde ao convite.')
    }
    const unitAmountCents = expectedInvitationAmount({
      intendedType: invitation.intendedType,
      plan,
      storedAmount: invitation.monthlyPriceCents,
    })
    if (unitAmountCents !== input.unitAmountCents) {
      throw new AgencyInvitationFinalizationError('O valor confirmado não corresponde ao convite.')
    }

    const inviterAuthority = reservedInviterRole
      ? { role: reservedInviterRole }
      : await findActiveAgencyInvitationAuthority(transaction, {
          agencyId: invitation.agency.id,
          agentId: invitation.invitedBy.id,
          now,
        })
    if (!inviterAuthority) {
      throw new AgencyInvitationFinalizationError(
        'A agência que enviou este convite não possui autorização e assinatura ativas.',
      )
    }

    let user: Prisma.UserGetPayload<{ select: typeof userSelect }> | null =
      await transaction.user.findFirst({
        where: { email: { equals: normalizeEmail(input.invitedEmail), mode: 'insensitive' } },
        select: userSelect,
      })
    let createdAccount = false

    if (user) {
      if (
        input.expectedUserId !== user.id
        || user.role !== 'AGENT'
        || !user.agent
        || user.agent.status !== 'ACTIVE'
      ) {
        throw new AgencyInvitationFinalizationError('A conta convidada mudou durante o pagamento.')
      }
    } else {
      if (input.expectedUserId || !input.passwordHash) {
        throw new AgencyInvitationFinalizationError('Não foi possível proteger a nova conta.')
      }
      const createdUser = await transaction.user.create({
        data: {
          email: normalizeEmail(input.invitedEmail),
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
          password: input.passwordHash,
        },
      })
      const createdAgent = await transaction.agent.create({
        data: {
          userId: createdUser.id,
          parentAgentId: invitation.invitedBy.id,
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

    const agent = user.agent
    if (!agent) {
      throw new AgencyInvitationFinalizationError('A conta convidada não possui um perfil de agente.')
    }
    if (agent.id === invitation.invitedBy.id) {
      throw new AgencyInvitationFinalizationError('Você não pode aceitar seu próprio convite.')
    }
    if (agent.parentAgentId !== null && agent.parentAgentId !== invitation.invitedBy.id) {
      throw new AgencyInvitationFinalizationError('Este agente já pertence a outra estrutura.')
    }
    if (!createdAccount) {
      const hierarchy = await transaction.agent.findMany({
        select: { id: true, parentAgentId: true },
      })
      if (getDownlineIds(hierarchy, agent.id).includes(invitation.invitedBy.id)) {
        throw new AgencyInvitationFinalizationError('Este convite criaria um ciclo na estrutura.')
      }
    }

    const activeMemberships = agent.agencyMemberships
    if (activeMemberships.length > 1) {
      throw new AgencyInvitationFinalizationError('A conta possui mais de um vínculo ativo.')
    }
    if (inviterAuthority.role === 'MEMBER' && activeMemberships.length > 0) {
      throw new AgencyInvitationFinalizationError('Este e-mail não está disponível para um novo convite.')
    }
    if (agent.founderEnrollment && plan === 'AGENT_AGENCY_MEMBER') {
      throw new AgencyInvitationFinalizationError(
        'Uma conta Founder deve escolher o plano Agência para mudar de estrutura.',
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
        throw new AgencyInvitationFinalizationError('Este agente já possui vínculo com uma agência.')
      }
      const membership = await transaction.agencyMembership.create({
        data: {
          agencyId: invitation.agency.id,
          agentId: agent.id,
          role: 'MEMBER',
          invitedByAgentId: invitation.invitedBy.id,
        },
        select: { id: true, agencyId: true },
      })
      acceptedMembershipId = membership.id
      acceptedAgencyId = membership.agencyId
      await transaction.agent.update({
        where: { id: agent.id },
        data: {
          parentAgentId: invitation.invitedBy.id,
          promotionAccessScope: 'PERSONAL',
        },
      })
    } else {
      const existingMembership = activeMemberships[0]
      const isDirectMember = existingMembership?.role === 'MEMBER'
        && existingMembership.agencyId === invitation.agency.id
      const isDirectMemberPromotion = inviterAuthority.role === 'OWNER'
        && isDirectMember
        && invitation.intendedType === 'AGENCY'

      if (existingMembership?.role === 'MEMBER' && !isDirectMemberPromotion) {
        throw new AgencyInvitationFinalizationError(
          isDirectMember
            ? 'Este vínculo requer um novo convite de Agência.'
            : 'Este agente já está vinculado como membro de outra agência.',
        )
      }

      if (isDirectMemberPromotion && existingMembership) {
        const previousInvitation = await transaction.agencyInvitation.findFirst({
          where: {
            agencyId: invitation.agency.id,
            status: 'ACCEPTED',
            intendedType: 'AGENT',
            acceptedAgentId: agent.id,
            acceptedPlan: 'AGENT_AGENCY_MEMBER',
            acceptedMembershipId: existingMembership.id,
          },
          select: { id: true, recruitmentStage: true, stageUpdatedAt: true },
        })
        const memberSubscription = await transaction.platformSubscription.findFirst({
          where: {
            agencyMembershipId: existingMembership.id,
            plan: 'AGENT_AGENCY_MEMBER',
            status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
          },
          select: { id: true, stripeSubscriptionId: true },
        })
        if (!previousInvitation || !memberSubscription) {
          throw new AgencyInvitationFinalizationError(
            'Este vínculo não está disponível para promoção.',
          )
        }
        if (input.checkoutId && memberSubscription.stripeSubscriptionId) {
          throw new AgencyInvitationFinalizationError(
            'A assinatura atual precisa ser migrada antes desta promoção.',
          )
        }

        const canceledMemberPlan = await transaction.platformSubscription.updateMany({
          where: {
            id: memberSubscription.id,
            agencyMembershipId: existingMembership.id,
            plan: 'AGENT_AGENCY_MEMBER',
            status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
          },
          data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
        })
        if (canceledMemberPlan.count !== 1) {
          throw new AgencyInvitationFinalizationError('O vínculo mudou durante a confirmação.')
        }
        const endedMembership = await transaction.agencyMembership.updateMany({
          where: {
            id: existingMembership.id,
            agencyId: invitation.agency.id,
            agentId: agent.id,
            role: 'MEMBER',
            endedAt: null,
          },
          data: { endedAt: now },
        })
        if (endedMembership.count !== 1) {
          throw new AgencyInvitationFinalizationError('O vínculo mudou durante a confirmação.')
        }

        const agency = await transaction.agency.create({
          data: { name: input.agencyName ?? '', parentAgencyId: invitation.agency.id },
          select: { id: true },
        })
        const ownerMembership = await transaction.agencyMembership.create({
          data: {
            agencyId: agency.id,
            agentId: agent.id,
            role: 'OWNER',
            invitedByAgentId: invitation.invitedBy.id,
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
          && existingMembership.agency.parentAgencyId !== invitation.agency.id
        ) {
          throw new AgencyInvitationFinalizationError('Esta agência já pertence a outra estrutura.')
        }
        if (existingMembership.agencyId === invitation.agency.id) {
          throw new AgencyInvitationFinalizationError('Uma agência não pode ficar abaixo dela mesma.')
        }
        await transaction.agency.update({
          where: { id: existingMembership.agencyId },
          data: { parentAgencyId: invitation.agency.id },
        })
        acceptedMembershipId = existingMembership.id
        acceptedAgencyId = existingMembership.agencyId
      } else {
        if (!input.agencyName || input.agencyName.trim().length < 2) {
          throw new AgencyInvitationFinalizationError('Informe o nome da agência.')
        }
        const agency = await transaction.agency.create({
          data: { name: input.agencyName, parentAgencyId: invitation.agency.id },
          select: { id: true },
        })
        const membership = await transaction.agencyMembership.create({
          data: {
            agencyId: agency.id,
            agentId: agent.id,
            role: 'OWNER',
            invitedByAgentId: invitation.invitedBy.id,
          },
          select: { id: true },
        })
        acceptedMembershipId = membership.id
        acceptedAgencyId = agency.id
      }

      await transaction.agent.update({
        where: { id: agent.id },
        data: {
          parentAgentId: invitation.invitedBy.id,
          rank: 'AGENCY_OWNER',
          promotionAccessScope: 'AGENCY',
        },
      })
    }

    await transaction.platformSubscription.updateMany({
      where: {
        agentId: agent.id,
        plan: 'AGENT_INDIVIDUAL',
        status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
      },
      data: { status: 'CANCELED', canceledAt: now, cancelAtPeriodEnd: false },
    })

    const existingAgencySubscription = plan === 'AGENCY'
      ? await transaction.platformSubscription.findFirst({
          where: {
            agencyId: acceptedAgencyId,
            plan: 'AGENCY',
            status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
          },
          select: { id: true, stripeSubscriptionId: true },
        })
      : null
    if (
      input.checkoutId
      && existingAgencySubscription?.stripeSubscriptionId
      && existingAgencySubscription.stripeSubscriptionId !== input.provider.stripeSubscriptionId
    ) {
      throw new AgencyInvitationFinalizationError(
        'A assinatura atual da agência precisa ser migrada antes deste convite.',
      )
    }

    const subscriptionData = {
      status: input.provider.status,
      unitAmountCents,
      currency: 'USD',
      currentPeriodStart: input.provider.currentPeriodStart,
      currentPeriodEnd: input.provider.currentPeriodEnd,
      cancelAtPeriodEnd: input.provider.cancelAtPeriodEnd,
      canceledAt: input.provider.canceledAt,
      stripeCustomerId: input.provider.stripeCustomerId,
      stripeSubscriptionId: input.provider.stripeSubscriptionId,
      stripeProductId: input.provider.stripeProductId,
      stripePriceId: input.provider.stripePriceId,
    }
    let platformSubscriptionId: string
    if (existingAgencySubscription) {
      const updated = await transaction.platformSubscription.update({
        where: { id: existingAgencySubscription.id },
        data: subscriptionData,
      })
      platformSubscriptionId = updated.id
    } else {
      const created = await transaction.platformSubscription.create({
        data: plan === 'AGENCY'
          ? { plan, agencyId: acceptedAgencyId, ...subscriptionData }
          : { plan, agencyMembershipId: acceptedMembershipId, ...subscriptionData },
      })
      platformSubscriptionId = created.id
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
        data: { accountType: 'AGENCY', agencyId: acceptedAgencyId },
      })
    }

    const recruitmentStage = createdAccount || agent.onboarding?.status === 'IN_PROGRESS'
      ? 'ONBOARDING'
      : 'ACTIVE'
    const acceptedIntendedType = invitation.intendedType
      ?? (plan === 'AGENCY' ? 'AGENCY' : 'AGENT')
    const claimed = await transaction.agencyInvitation.updateMany({
      where: {
        id: invitation.id,
        agencyId: invitation.agency.id,
        status: 'PENDING',
        intendedType: invitation.intendedType,
        expiresAt: { gt: now },
      },
      data: {
        status: 'ACCEPTED',
        acceptedAt: now,
        acceptedAgentId: agent.id,
        acceptedPlan: plan,
        acceptedMembershipId,
        intendedType: acceptedIntendedType,
        monthlyPriceCents: unitAmountCents,
        recruitmentStage,
        stageUpdatedAt: now,
      },
    })
    if (claimed.count !== 1) {
      throw new AgencyInvitationFinalizationError('Este convite já foi utilizado.')
    }

    if (promotedFrom && promotedFrom.recruitmentStage !== 'PAUSED') {
      const paused = await transaction.agencyInvitation.updateMany({
        where: {
          id: promotedFrom.invitationId,
          status: 'ACCEPTED',
          acceptedAgentId: agent.id,
          acceptedMembershipId: promotedFrom.membershipId,
          stageUpdatedAt: promotedFrom.stageUpdatedAt,
        },
        data: { recruitmentStage: 'PAUSED', stageUpdatedAt: now },
      })
      if (paused.count !== 1) {
        throw new AgencyInvitationFinalizationError('O histórico deste vínculo mudou.')
      }
    }

    if (input.checkoutId) {
      const finalized = await transaction.agencyInvitationCheckout.updateMany({
        where: {
          id: input.checkoutId,
          invitationId: invitation.id,
          status: 'PENDING',
        },
        data: {
          status: 'FINALIZED',
          userId: user.id,
          stripeCustomerId: input.provider.stripeCustomerId,
          stripeSubscriptionId: input.provider.stripeSubscriptionId,
          platformSubscriptionId,
          finalizedAt: now,
          passwordHash: null,
        },
      })
      if (finalized.count !== 1) {
        throw new AgencyInvitationFinalizationError('O checkout já foi finalizado por outra solicitação.')
      }
    }

    await transaction.auditLog.create({
      data: {
        userId: user.id,
        action: 'AGENCY_INVITATION_ACCEPTED',
        entity: 'AgencyInvitation',
        entityId: invitation.id,
        after: {
          acceptedPlan: plan,
          acceptedAgentId: agent.id,
          acceptedMembershipId,
          intendedType: acceptedIntendedType,
          monthlyPriceCents: unitAmountCents,
          recruitmentStage,
          previousRecruitmentStage: invitation.recruitmentStage,
          parentAgentId: invitation.invitedBy.id,
          parentAgencyId: invitation.agency.id,
          simulatedBilling: input.checkoutId === null,
          stripeSubscriptionId: input.provider.stripeSubscriptionId,
          currentPeriodEnd: input.provider.currentPeriodEnd.toISOString(),
          ...(promotedFrom
            ? {
                promotedFromInvitationId: promotedFrom.invitationId,
                promotedFromMembershipId: promotedFrom.membershipId,
              }
            : {}),
        },
      },
    })

    return { platformSubscriptionId, createdAccount }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  })
}
