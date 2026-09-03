'use server'

import {
  Prisma,
  type AgentProfessionalRank,
  type PlatformModule,
} from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'
import { getServerI18n } from '@/lib/i18n/server'
import { normalizePlatformModules } from '@/lib/platform-modules'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { assertSameOriginAction } from '@/lib/security/same-origin-action'
import {
  migrateStripePlatformSubscriptionPlan,
  StripeAdminPlanChangeError,
  type StripeAdminPlanChangeContext,
  type StripeAdminPlanChangeReceipt,
} from '@/lib/stripe/admin-plan-change'
import { getStripeCatalogEntry } from '@/lib/stripe/platform-catalog'

export type ManagedUserPlanActionState = {
  status: 'idle' | 'success' | 'error'
  message: string
  fieldErrors?: Record<string, string>
}

const MANAGED_PLANS = ['AGENT_INDIVIDUAL', 'AGENCY'] as const
const PROFESSIONAL_RANKS = ['AGENT', 'MANAGER', 'DIRECTOR'] as const
type ManagedPlan = (typeof MANAGED_PLANS)[number]

const PLAN_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 30_000,
} as const

const managedPlanSchema = z.object({
  userId: z.string().cuid(),
  expectedUpdatedAt: z.string().datetime(),
  targetPlan: z.enum(MANAGED_PLANS),
  agencyName: z.string().trim().max(120).default(''),
  confirmDowngrade: z.boolean(),
})

type Copy = (portuguese: string, english: string) => string

type PlanChangeCode =
  | 'ACCESS_NOT_MANAGED'
  | 'STALE_PRODUCT_ACCESS'
  | 'UNSUPPORTED_PLAN'
  | 'PLAN_ALREADY_SELECTED'
  | 'STRIPE_CUSTOMER_INCOMPLETE'
  | 'STRIPE_PLAN_CHANGE_FAILED'
  | 'STRIPE_RECONCILIATION_REQUIRED'
  | 'INVITATION_MANAGED'
  | 'INVALID_PLAN_SUBJECT'
  | 'ACTIVE_AGENCY_LINK'
  | 'AGENCY_NAME_REQUIRED'
  | 'HIERARCHY_REQUIRES_REVIEW'
  | 'AGENCY_HAS_TEAM'
  | 'AGENCY_HAS_CHILDREN'
  | 'AGENCY_HAS_PARENT'
  | 'AGENCY_HAS_INVITES'
  | 'DOWNGRADE_CONFIRMATION_REQUIRED'
  | 'PLAN_CHANGED_CONCURRENTLY'

class ManagedPlanChangeError extends Error {
  constructor(
    readonly code: PlanChangeCode,
    readonly stripeContext: StripeAdminPlanChangeContext | null = null,
  ) {
    super(code)
    this.name = 'ManagedPlanChangeError'
  }
}

function formString(formData: FormData, key: string): string {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function validationFailure(
  error: z.ZodError,
  copy: Copy,
): ManagedUserPlanActionState {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== 'string' || fieldErrors[field]) continue
    fieldErrors[field] = field === 'agencyName'
      ? copy('Informe o nome da nova agência.', 'Enter the new agency name.')
      : field === 'targetPlan'
        ? copy('Selecione um plano válido.', 'Select a valid plan.')
        : copy('Valor inválido.', 'Invalid value.')
  }
  return {
    status: 'error',
    message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
    fieldErrors,
  }
}

function errorState(code: PlanChangeCode, copy: Copy): ManagedUserPlanActionState {
  if (code === 'AGENCY_NAME_REQUIRED') {
    return {
      status: 'error',
      message: copy('Revise os campos destacados.', 'Review the highlighted fields.'),
      fieldErrors: {
        agencyName: copy('Informe o nome da nova agência.', 'Enter the new agency name.'),
      },
    }
  }
  const messages: Record<PlanChangeCode, string> = {
    ACCESS_NOT_MANAGED: copy(
      'A troca está disponível apenas para contas criadas pelo painel administrativo.',
      'Plan changes are only available for accounts created from the admin panel.',
    ),
    STALE_PRODUCT_ACCESS: copy(
      'O acesso mudou em outra sessão. Atualize a página antes de continuar.',
      'Access changed in another session. Refresh the page before continuing.',
    ),
    UNSUPPORTED_PLAN: copy(
      'Este tipo de plano segue um fluxo comercial próprio e não pode ser alterado aqui.',
      'This plan type follows its own commercial flow and cannot be changed here.',
    ),
    PLAN_ALREADY_SELECTED: copy(
      'Este usuário já está no plano selecionado.',
      'This user is already on the selected plan.',
    ),
    STRIPE_CUSTOMER_INCOMPLETE: copy(
      'Esta conta possui um cliente no Stripe, mas ainda não tem uma assinatura vinculada. Conclua ou cancele o checkout pendente antes de alterar o plano.',
      'This account has a Stripe customer but no linked subscription. Complete or cancel the pending checkout before changing the plan.',
    ),
    STRIPE_PLAN_CHANGE_FAILED: copy(
      'Não foi possível sincronizar o novo plano com o Stripe. Nenhuma alteração local foi aplicada.',
      'We could not synchronize the new plan with Stripe. No local changes were applied.',
    ),
    STRIPE_RECONCILIATION_REQUIRED: copy(
      'A cobrança precisa de revisão manual no Stripe antes de continuar. A equipe técnica foi avisada.',
      'Billing requires manual review in Stripe before continuing. The technical team has been notified.',
    ),
    INVITATION_MANAGED: copy(
      'Esta conta possui um vínculo comercial por convite. Altere esse vínculo pelo fluxo da agência.',
      'This account has an invitation-based commercial relationship. Update it through the agency flow.',
    ),
    INVALID_PLAN_SUBJECT: copy(
      'A estrutura atual do plano está inconsistente. Revise a conta antes de alterá-la.',
      'The current plan structure is inconsistent. Review the account before changing it.',
    ),
    ACTIVE_AGENCY_LINK: copy(
      'O agente já possui um vínculo ativo com uma agência. Encerre ou regularize esse vínculo primeiro.',
      'The agent already has an active agency relationship. End or resolve it first.',
    ),
    AGENCY_NAME_REQUIRED: copy(
      'Informe o nome da nova agência.',
      'Enter the new agency name.',
    ),
    HIERARCHY_REQUIRES_REVIEW: copy(
      'O agente possui vínculos na hierarquia atual. Reorganize essa estrutura antes de criar a agência.',
      'The agent has relationships in the current hierarchy. Reorganize them before creating the agency.',
    ),
    AGENCY_HAS_TEAM: copy(
      'Transfira ou encerre os vínculos dos membros ativos antes de mudar para o Plano Agente.',
      'Transfer or end active team memberships before switching to the Agent plan.',
    ),
    AGENCY_HAS_CHILDREN: copy(
      'A agência possui subagências. Reorganize a cadeia antes de mudar para o Plano Agente.',
      'The agency has child agencies. Reorganize the hierarchy before switching to the Agent plan.',
    ),
    AGENCY_HAS_PARENT: copy(
      'Esta agência pertence a uma agência base. Remova o vínculo hierárquico antes de mudar o plano.',
      'This agency belongs to a parent agency. Remove the hierarchy relationship before changing the plan.',
    ),
    AGENCY_HAS_INVITES: copy(
      'Cancele ou conclua os convites pendentes antes de mudar para o Plano Agente.',
      'Cancel or complete pending invitations before switching to the Agent plan.',
    ),
    DOWNGRADE_CONFIRMATION_REQUIRED: copy(
      'Confirme que deseja encerrar a estrutura da agência e remover seus módulos exclusivos.',
      'Confirm that you want to end the agency structure and remove its exclusive modules.',
    ),
    PLAN_CHANGED_CONCURRENTLY: copy(
      'O plano mudou durante a operação. Atualize a página e tente novamente.',
      'The plan changed during the operation. Refresh the page and try again.',
    ),
  }
  return { status: 'error', message: messages[code] }
}

async function readAdminActionContext() {
  const requestHeaders = await headers()
  assertSameOriginAction({
    origin: requestHeaders.get('origin'),
    host: requestHeaders.get('host'),
    forwardedHost: requestHeaders.get('x-forwarded-host'),
    forwardedProto: requestHeaders.get('x-forwarded-proto'),
  })
  return requireRole('ADMIN')
}

function revalidatePlanSurfaces(userId: string) {
  revalidatePath('/admin')
  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  revalidatePath('/admin/audit')
  revalidatePath('/agent')
  revalidatePath('/agent/agency')
  revalidatePath('/agent/hierarchy')
}

function targetModules(
  current: readonly PlatformModule[],
  targetPlan: (typeof MANAGED_PLANS)[number],
): PlatformModule[] {
  if (targetPlan === 'AGENCY') {
    return normalizePlatformModules([...current, 'AGENCY', 'TEAM']) as PlatformModule[]
  }
  return normalizePlatformModules(
    current.filter((module) => module !== 'AGENCY' && module !== 'TEAM'),
  ) as PlatformModule[]
}

function professionalRank(
  rank: string,
  fallback: AgentProfessionalRank,
): AgentProfessionalRank {
  return PROFESSIONAL_RANKS.includes(rank as AgentProfessionalRank)
    ? rank as AgentProfessionalRank
    : fallback
}

async function lockManagedPlanChange(
  transaction: Prisma.TransactionClient,
  userId: string,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`keepr:admin-user-plan:${userId}`}, 0)
    )::text AS locked
  `
}

async function compensateStripePlanChange(input: {
  userId: string
  targetPlan: ManagedPlan
  receipt: StripeAdminPlanChangeReceipt
}): Promise<'ADOPTED' | 'RESTORED'> {
  return prisma.$transaction(async (transaction) => {
    await lockManagedPlanChange(transaction, input.userId)
    const current = await transaction.adminProvisionedAccess.findFirst({
      where: { agent: { userId: input.userId } },
      select: {
        platformSubscription: {
          select: {
            plan: true,
            stripeSubscriptionId: true,
            stripePriceId: true,
          },
        },
      },
    })

    if (
      current?.platformSubscription.plan === input.targetPlan
      && current.platformSubscription.stripeSubscriptionId
        === input.receipt.provider.stripeSubscriptionId
      && current.platformSubscription.stripePriceId === input.receipt.targetPriceId
    ) {
      return 'ADOPTED'
    }

    await input.receipt.rollback()
    return 'RESTORED'
  }, PLAN_TRANSACTION_OPTIONS)
}

async function recordStripeReconciliationRequired(input: {
  adminUserId: string
  targetUserId: string
  targetPlan: ManagedPlan
  receipt: StripeAdminPlanChangeReceipt | null
  stripeContext?: StripeAdminPlanChangeContext | null
  cause: unknown
}) {
  const previousPlan: ManagedPlan = input.targetPlan === 'AGENCY'
    ? 'AGENT_INDIVIDUAL'
    : 'AGENCY'
  const stripeSubscriptionId = input.receipt?.provider.stripeSubscriptionId
    ?? input.stripeContext?.stripeSubscriptionId
    ?? null
  const previousPriceId = input.receipt?.previousPriceId
    ?? input.stripeContext?.previousPriceId
    ?? null
  const targetPriceId = input.receipt?.targetPriceId
    ?? input.stripeContext?.targetPriceId
    ?? null
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.adminUserId,
        action: 'ADMIN_USER_PLAN_RECONCILIATION_REQUIRED',
        entity: 'User',
        entityId: input.targetUserId,
        before: {
          plan: previousPriceId ? previousPlan : null,
          stripePriceId: previousPriceId,
        },
        after: {
          plan: input.targetPlan,
          stripeSubscriptionId,
          stripePriceId: targetPriceId,
          reconciliationStatus: 'MANUAL_REVIEW_REQUIRED',
        },
      },
    })
  } catch (auditError) {
    console.error('Admin managed plan reconciliation audit failed', {
      cause: input.cause,
      auditError,
      targetUserId: input.targetUserId,
    })
  }
}

export async function updateManagedUserPlanAction(
  _previousState: ManagedUserPlanActionState,
  formData: FormData,
): Promise<ManagedUserPlanActionState> {
  const { copy } = await getServerI18n()
  const parsed = managedPlanSchema.safeParse({
    userId: formString(formData, 'userId'),
    expectedUpdatedAt: formString(formData, 'expectedUpdatedAt'),
    targetPlan: formString(formData, 'targetPlan'),
    agencyName: formString(formData, 'agencyName'),
    confirmDowngrade: formString(formData, 'confirmDowngrade') === 'yes',
  })
  if (!parsed.success) return validationFailure(parsed.error, copy)

  const session = await readAdminActionContext()
  const catalog = getStripeCatalogEntry(parsed.data.targetPlan)
  if (!catalog) return errorState('UNSUPPORTED_PLAN', copy)
  const now = new Date()
  let stripeChange: StripeAdminPlanChangeReceipt | null = null

  try {
    const result = await prisma.$transaction(async (transaction) => {
      await lockManagedPlanChange(transaction, parsed.data.userId)
      const current = await transaction.adminProvisionedAccess.findFirst({
        where: { agent: { userId: parsed.data.userId } },
        select: {
          id: true,
          updatedAt: true,
          individualRank: true,
          modules: true,
          paymentRequiredAt: true,
          paymentReason: true,
          agent: {
            select: {
              id: true,
              updatedAt: true,
              rank: true,
              promotionAccessScope: true,
              parentAgentId: true,
              _count: { select: { subAgents: true } },
              agencyInvitationsAccepted: {
                where: { status: 'ACCEPTED', isCurrentCommercial: true },
                take: 1,
                select: { id: true },
              },
              agencyMemberships: {
                where: { endedAt: null },
                orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
                select: {
                  id: true,
                  agencyId: true,
                  agentId: true,
                  role: true,
                  agency: {
                    select: {
                      id: true,
                      name: true,
                      parentAgencyId: true,
                      _count: {
                        select: {
                          memberships: { where: { endedAt: null } },
                          childAgencies: true,
                        },
                      },
                      invitations: {
                        where: {
                          OR: [
                            { status: 'PENDING', expiresAt: { gt: now } },
                            {
                              checkout: {
                                is: { status: 'PENDING', checkoutExpiresAt: { gt: now } },
                              },
                            },
                          ],
                        },
                        take: 1,
                        select: { id: true },
                      },
                    },
                  },
                },
              },
            },
          },
          platformSubscription: {
            select: {
              id: true,
              plan: true,
              status: true,
              agentId: true,
              agencyId: true,
              agencyMembershipId: true,
              unitAmountCents: true,
              currency: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              canceledAt: true,
              stripeCustomerId: true,
              stripeSubscriptionId: true,
              stripeProductId: true,
              stripePriceId: true,
              updatedAt: true,
            },
          },
        },
      })

      if (!current) throw new ManagedPlanChangeError('ACCESS_NOT_MANAGED')
      if (current.updatedAt.toISOString() !== parsed.data.expectedUpdatedAt) {
        throw new ManagedPlanChangeError('STALE_PRODUCT_ACCESS')
      }

      const subscription = current.platformSubscription
      if (!MANAGED_PLANS.includes(subscription.plan as (typeof MANAGED_PLANS)[number])) {
        throw new ManagedPlanChangeError('UNSUPPORTED_PLAN')
      }
      if (subscription.plan === parsed.data.targetPlan) {
        throw new ManagedPlanChangeError('PLAN_ALREADY_SELECTED')
      }
      if (subscription.stripeCustomerId && !subscription.stripeSubscriptionId) {
        throw new ManagedPlanChangeError('STRIPE_CUSTOMER_INCOMPLETE')
      }
      if (current.agent.agencyInvitationsAccepted.length > 0) {
        throw new ManagedPlanChangeError('INVITATION_MANAGED')
      }

      const modules = targetModules(current.modules, parsed.data.targetPlan)
      let agencyId: string | null = null
      let ownerMembershipId: string | null = null

      if (subscription.plan === 'AGENT_INDIVIDUAL') {
        if (parsed.data.agencyName.length < 2) {
          throw new ManagedPlanChangeError('AGENCY_NAME_REQUIRED')
        }
        if (
          subscription.agentId !== current.agent.id
          || subscription.agencyId !== null
          || subscription.agencyMembershipId !== null
        ) {
          throw new ManagedPlanChangeError('INVALID_PLAN_SUBJECT')
        }
        if (current.agent.agencyMemberships.length > 0) {
          throw new ManagedPlanChangeError('ACTIVE_AGENCY_LINK')
        }
        if (current.agent.parentAgentId || current.agent._count.subAgents > 0) {
          throw new ManagedPlanChangeError('HIERARCHY_REQUIRES_REVIEW')
        }

        const agency = await transaction.agency.create({
          data: { name: parsed.data.agencyName },
          select: { id: true },
        })
        agencyId = agency.id
        const membership = await transaction.agencyMembership.create({
          data: {
            agencyId: agency.id,
            agentId: current.agent.id,
            role: 'OWNER',
          },
          select: { id: true },
        })
        ownerMembershipId = membership.id
      } else {
        if (!parsed.data.confirmDowngrade) {
          throw new ManagedPlanChangeError('DOWNGRADE_CONFIRMATION_REQUIRED')
        }
        const membership = current.agent.agencyMemberships[0]
        if (
          current.agent.agencyMemberships.length !== 1
          || !membership
          || membership.role !== 'OWNER'
          || membership.agentId !== current.agent.id
          || membership.agencyId !== subscription.agencyId
          || subscription.agentId !== null
          || subscription.agencyMembershipId !== null
        ) {
          throw new ManagedPlanChangeError('INVALID_PLAN_SUBJECT')
        }
        if (membership.agency._count.memberships > 1) {
          throw new ManagedPlanChangeError('AGENCY_HAS_TEAM')
        }
        if (membership.agency._count.childAgencies > 0) {
          throw new ManagedPlanChangeError('AGENCY_HAS_CHILDREN')
        }
        if (membership.agency.parentAgencyId) {
          throw new ManagedPlanChangeError('AGENCY_HAS_PARENT')
        }
        if (current.agent.parentAgentId || current.agent._count.subAgents > 0) {
          throw new ManagedPlanChangeError('HIERARCHY_REQUIRES_REVIEW')
        }
        if (membership.agency.invitations.length > 0) {
          throw new ManagedPlanChangeError('AGENCY_HAS_INVITES')
        }
        agencyId = membership.agencyId
        ownerMembershipId = membership.id
      }

      if (subscription.stripeSubscriptionId) {
        try {
          stripeChange = await migrateStripePlatformSubscriptionPlan({
            platformSubscriptionId: subscription.id,
            stripeSubscriptionId: subscription.stripeSubscriptionId,
            currentPlan: subscription.plan as (typeof MANAGED_PLANS)[number],
            targetPlan: parsed.data.targetPlan,
            idempotencyKey: [
              'keeprone-admin-plan-change',
              current.id,
              current.updatedAt.toISOString(),
              parsed.data.targetPlan,
            ].join(':'),
          })
        } catch (error) {
          if (
            error instanceof StripeAdminPlanChangeError
            && error.code === 'STRIPE_ADMIN_PLAN_CHANGE_RECONCILIATION_REQUIRED'
          ) {
            throw new ManagedPlanChangeError(
              'STRIPE_RECONCILIATION_REQUIRED',
              error.context,
            )
          }
          throw new ManagedPlanChangeError('STRIPE_PLAN_CHANGE_FAILED')
        }
      }

      let nextSubscriptionId: string

      if (stripeChange) {
        const providerSubscription = await transaction.platformSubscription.updateMany({
          where: {
            id: subscription.id,
            updatedAt: subscription.updatedAt,
            plan: subscription.plan,
            agentId: subscription.agentId,
            agencyId: subscription.agencyId,
            agencyMembershipId: subscription.agencyMembershipId,
            stripeSubscriptionId: stripeChange.provider.stripeSubscriptionId,
          },
          data: {
            plan: parsed.data.targetPlan,
            agentId: parsed.data.targetPlan === 'AGENT_INDIVIDUAL'
              ? current.agent.id
              : null,
            agencyId: parsed.data.targetPlan === 'AGENCY' ? agencyId! : null,
            agencyMembershipId: null,
            ...stripeChange.provider,
          },
        })
        if (providerSubscription.count !== 1) {
          throw new ManagedPlanChangeError('PLAN_CHANGED_CONCURRENTLY')
        }
        nextSubscriptionId = subscription.id
      } else {
        const canceled = await transaction.platformSubscription.updateMany({
          where: {
            id: subscription.id,
            updatedAt: subscription.updatedAt,
            plan: subscription.plan,
            agentId: subscription.agentId,
            agencyId: subscription.agencyId,
            agencyMembershipId: subscription.agencyMembershipId,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
          },
          data: {
            status: 'CANCELED',
            canceledAt: now,
            cancelAtPeriodEnd: false,
          },
        })
        if (canceled.count !== 1) {
          throw new ManagedPlanChangeError('PLAN_CHANGED_CONCURRENTLY')
        }
      }

      if (subscription.plan === 'AGENCY') {
        const endedMembership = await transaction.agencyMembership.updateMany({
          where: {
            id: ownerMembershipId!,
            agencyId: agencyId!,
            agentId: current.agent.id,
            role: 'OWNER',
            endedAt: null,
          },
          data: { endedAt: now },
        })
        if (endedMembership.count !== 1) {
          throw new ManagedPlanChangeError('PLAN_CHANGED_CONCURRENTLY')
        }
      }

      if (!stripeChange) {
        const nextSubscription = await transaction.platformSubscription.create({
          data: {
            plan: parsed.data.targetPlan,
            status: subscription.status,
            ...(parsed.data.targetPlan === 'AGENCY'
              ? { agencyId: agencyId! }
              : { agentId: current.agent.id }),
            unitAmountCents: catalog.unitAmountCents,
            currency: catalog.currency.toUpperCase(),
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.status === 'CANCELED' ? subscription.canceledAt : null,
            stripeProductId: catalog.productId,
            stripePriceId: catalog.priceId,
          },
          select: { id: true },
        })
        nextSubscriptionId = nextSubscription.id
      }

      const accessUpdate = await transaction.adminProvisionedAccess.updateMany({
        where: {
          id: current.id,
          platformSubscriptionId: subscription.id,
          updatedAt: new Date(parsed.data.expectedUpdatedAt),
        },
        data: {
          platformSubscriptionId: nextSubscriptionId!,
          modules,
          individualRank: subscription.plan === 'AGENT_INDIVIDUAL'
            ? professionalRank(current.agent.rank, current.individualRank)
            : current.individualRank,
          updatedById: session.user.id,
          updatedAt: now,
        },
      })
      if (accessUpdate.count !== 1) {
        throw new ManagedPlanChangeError('STALE_PRODUCT_ACCESS')
      }

      const agentUpdate = await transaction.agent.updateMany({
        where: { id: current.agent.id, updatedAt: current.agent.updatedAt },
        data: parsed.data.targetPlan === 'AGENCY'
          ? { rank: 'AGENCY_OWNER', promotionAccessScope: 'AGENCY' }
          : { rank: current.individualRank, promotionAccessScope: 'PERSONAL' },
      })
      if (agentUpdate.count !== 1) {
        throw new ManagedPlanChangeError('PLAN_CHANGED_CONCURRENTLY')
      }

      await transaction.auditLog.create({
        data: {
          userId: session.user.id,
          action: 'ADMIN_USER_PLAN_CHANGED',
          entity: 'User',
          entityId: parsed.data.userId,
          before: {
            plan: subscription.plan,
            subscriptionId: subscription.id,
            agencyId: subscription.agencyId,
            unitAmountCents: subscription.unitAmountCents,
            currency: subscription.currency,
            rank: current.agent.rank,
            promotionAccessScope: current.agent.promotionAccessScope,
            modules: current.modules,
          },
          after: {
            plan: parsed.data.targetPlan,
            subscriptionId: nextSubscriptionId!,
            agencyId: parsed.data.targetPlan === 'AGENCY' ? agencyId : null,
            ownerMembershipId: parsed.data.targetPlan === 'AGENCY' ? ownerMembershipId : null,
            unitAmountCents: catalog.unitAmountCents,
            currency: catalog.currency.toUpperCase(),
            rank: parsed.data.targetPlan === 'AGENCY'
              ? 'AGENCY_OWNER'
              : current.individualRank,
            promotionAccessScope: parsed.data.targetPlan === 'AGENCY' ? 'AGENCY' : 'PERSONAL',
            modules,
          },
        },
      })

      return { targetPlan: parsed.data.targetPlan }
    }, PLAN_TRANSACTION_OPTIONS)

    const providerPlanChanged = Boolean(stripeChange)
    stripeChange = null
    revalidatePlanSurfaces(parsed.data.userId)
    return {
      status: 'success',
      message: result.targetPlan === 'AGENCY'
        ? providerPlanChanged
          ? copy(
              'Plano alterado para Agência. O novo preço foi sincronizado no Stripe para a próxima renovação.',
              'Plan changed to Agency. The new price was synchronized with Stripe for the next renewal.',
            )
          : copy(
              'Plano alterado para Agência. A estrutura e os módulos de gestão já estão disponíveis.',
              'Plan changed to Agency. The organization and management modules are now available.',
            )
        : providerPlanChanged
          ? copy(
              'Plano alterado para Agente. A estrutura foi encerrada e o novo preço foi sincronizado para a próxima renovação.',
              'Plan changed to Agent. The organization was closed and the new price was synchronized for the next renewal.',
            )
          : copy(
              'Plano alterado para Agente. A estrutura anterior foi encerrada e os módulos exclusivos foram removidos.',
              'Plan changed to Agent. The previous organization was closed and exclusive modules were removed.',
            ),
    }
  } catch (error) {
    if (stripeChange) {
      try {
        const compensation = await compensateStripePlanChange({
          userId: parsed.data.userId,
          targetPlan: parsed.data.targetPlan,
          receipt: stripeChange,
        })
        stripeChange = null
        if (compensation === 'ADOPTED') {
          revalidatePlanSurfaces(parsed.data.userId)
          return {
            status: 'success',
            message: copy(
              'O plano já havia sido alterado por outra solicitação. Os dados exibidos foram atualizados.',
              'The plan had already been changed by another request. The displayed data has been refreshed.',
            ),
          }
        }
      } catch (rollbackError) {
        console.error('Admin managed plan change Stripe rollback failed', {
          cause: error,
          rollbackError,
        })
        await recordStripeReconciliationRequired({
          adminUserId: session.user.id,
          targetUserId: parsed.data.userId,
          targetPlan: parsed.data.targetPlan,
          receipt: stripeChange,
          cause: new AggregateError(
            [error, rollbackError],
            'Admin plan change compensation failed',
          ),
        })
        return errorState('STRIPE_RECONCILIATION_REQUIRED', copy)
      }
    }
    if (error instanceof ManagedPlanChangeError) {
      if (error.code === 'STRIPE_RECONCILIATION_REQUIRED') {
        await recordStripeReconciliationRequired({
          adminUserId: session.user.id,
          targetUserId: parsed.data.userId,
          targetPlan: parsed.data.targetPlan,
          receipt: null,
          stripeContext: error.stripeContext,
          cause: error,
        })
      }
      return errorState(error.code, copy)
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034')
    ) {
      return errorState('PLAN_CHANGED_CONCURRENTLY', copy)
    }
    console.error('Admin managed plan change failed', error)
    return {
      status: 'error',
      message: copy(
        'Não foi possível alterar o plano agora.',
        'We could not change the plan right now.',
      ),
    }
  }
}
