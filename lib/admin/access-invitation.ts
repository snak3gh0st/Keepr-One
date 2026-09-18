import 'server-only'

import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { Prisma, type AgentOnboardingModule, type PlatformModule } from '@prisma/client'
import { auth } from '@/lib/auth'
import { DEFAULT_MODULES_BY_PLAN } from '@/lib/platform-modules'
import { prisma } from '@/lib/prisma'
import { getStripeCatalogEntry } from '@/lib/stripe/platform-catalog'

const TRIAL_DAYS = 30
const DEFAULT_LANGUAGE = 'PT' as const
const DEFAULT_TIME_ZONE = 'America/New_York'
const ONBOARDING_MODULES = new Set<AgentOnboardingModule>([
  'TODAY',
  'CALENDAR',
  'CRM',
  'MESSAGES',
  'POLICIES',
  'ILLUSTRATIONS',
  'COMMISSIONS',
  'TEAM',
  'INTEGRATIONS',
])

export type AccessInvitationDelivery = 'SENT' | 'FAILED'

export type AccessInvitationResult = {
  leadId: string
  userId: string
  email: string
  accountCreated: boolean
  delivery: AccessInvitationDelivery
}

export class AccessInvitationError extends Error {
  constructor(readonly code: 'LEAD_NOT_FOUND' | 'INCOMPATIBLE_ACCOUNT' | 'CATALOG_UNAVAILABLE' | 'PENDING_INVITATION_CHECKOUT') {
    super(code)
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  return value.trim().startsWith('+') ? `+${digits}` : digits
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

/**
 * Creates the same standalone agent boundary used by the admin user form, or
 * reuses an existing agent account, then sends the first-login reset email.
 * The lead itself remains a Marketing record; this action only grants access.
 */
export async function sendMarketingLeadAccessInvitation(input: {
  leadId: string
  requestedById: string
  requestHeaders: Headers
}): Promise<AccessInvitationResult> {
  const catalog = getStripeCatalogEntry('AGENT_INDIVIDUAL')
  if (!catalog) throw new AccessInvitationError('CATALOG_UNAVAILABLE')

  const now = new Date()
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1_000)
  const modules = [...DEFAULT_MODULES_BY_PLAN.AGENT_INDIVIDUAL] as PlatformModule[]
  const passwordHash = await hashPassword(randomBytes(48).toString('base64url'))

  const account = await prisma.$transaction(async (tx) => {
    const lead = await tx.marketingLead.findUnique({
      where: { id: input.leadId },
      select: { id: true, name: true, email: true, phone: true },
    })
    if (!lead) throw new AccessInvitationError('LEAD_NOT_FOUND')

    const existing = await tx.user.findUnique({
      where: { email: normalizeEmail(lead.email) },
      select: { id: true, email: true, role: true, agent: { select: { id: true } } },
    })
    if (existing) {
      if (existing.role !== 'AGENT' || !existing.agent) {
        throw new AccessInvitationError('INCOMPATIBLE_ACCOUNT')
      }
      return { userId: existing.id, email: existing.email, leadId: lead.id, accountCreated: false }
    }

    const pendingInvitationCheckout = await tx.agencyInvitationCheckout.findFirst({
      where: {
        email: normalizeEmail(lead.email),
        status: 'PENDING',
        checkoutExpiresAt: { gt: now },
      },
      select: { id: true },
    })
    if (pendingInvitationCheckout) throw new AccessInvitationError('PENDING_INVITATION_CHECKOUT')

    const user = await tx.user.create({
      data: {
        email: normalizeEmail(lead.email),
        name: lead.name,
        role: 'AGENT',
        language: DEFAULT_LANGUAGE,
        timeZone: DEFAULT_TIME_ZONE,
      },
      select: { id: true, email: true },
    })
    await tx.account.create({
      data: {
        id: randomUUID(),
        accountId: user.id,
        providerId: 'credential',
        userId: user.id,
        password: passwordHash,
      },
    })
    const agent = await tx.agent.create({
      data: {
        userId: user.id,
        rank: 'AGENT',
        phone: normalizePhone(lead.phone),
        status: 'ACTIVE',
        promotionAccessScope: 'PERSONAL',
      },
      select: { id: true },
    })
    const subscription = await tx.platformSubscription.create({
      data: {
        plan: 'AGENT_INDIVIDUAL',
        status: 'TRIALING',
        agentId: agent.id,
        unitAmountCents: catalog.unitAmountCents,
        currency: catalog.currency.toUpperCase(),
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        stripeProductId: catalog.productId,
        stripePriceId: catalog.priceId,
      },
      select: { id: true },
    })
    const access = await tx.adminProvisionedAccess.create({
      data: {
        agentId: agent.id,
        platformSubscriptionId: subscription.id,
        individualRank: 'AGENT',
        modules,
        provisionedById: input.requestedById,
      },
      select: { id: true },
    })
    await tx.agentOnboarding.create({
      data: {
        agentId: agent.id,
        status: 'IN_PROGRESS',
        currentStep: 'WELCOME',
        requiredModules: onboardingModules(modules),
      },
    })
    await tx.auditLog.create({
      data: {
        userId: input.requestedById,
        action: 'ADMIN_USER_CREATED',
        entity: 'User',
        entityId: user.id,
        after: {
          source: 'MARKETING_LEAD_ACCESS_INVITE',
          leadId: lead.id,
          agentId: agent.id,
          platformSubscriptionId: subscription.id,
          adminProvisionedAccessId: access.id,
          accessMode: 'TRIAL',
          trialDays: TRIAL_DAYS,
          trialEndsAt: trialEndsAt.toISOString(),
          modules,
        },
      },
    })
    return { userId: user.id, email: user.email, leadId: lead.id, accountCreated: true }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

  let delivery: AccessInvitationDelivery = 'FAILED'
  try {
    const response = await auth.api.requestPasswordReset({
      headers: publicAuthHeaders(input.requestHeaders),
      body: { email: account.email, redirectTo: `/reset-password?lang=${DEFAULT_LANGUAGE}` },
    })
    if (!(response as { error?: unknown } | null)?.error) delivery = 'SENT'
  } catch (error) {
    console.error('Marketing access invitation delivery failed', error)
  }

  await prisma.auditLog.create({
    data: {
      userId: input.requestedById,
      action: 'MARKETING_LEAD_ACCESS_INVITE_REQUESTED',
      entity: 'MarketingLead',
      entityId: account.leadId,
      after: {
        userId: account.userId,
        recipient: account.email,
        accountCreated: account.accountCreated,
        delivery,
      },
    },
  })

  return { ...account, delivery }
}
