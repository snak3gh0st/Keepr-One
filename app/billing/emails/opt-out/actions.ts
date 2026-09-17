'use server'

import { prisma } from '@/lib/prisma'
import { RETENTION_EMAIL_OPT_OUT_ACTION } from '@/lib/billing/retention-email-runner'
import { verifyRetentionEmailOptOutToken } from '@/lib/billing/retention-email-token'

export type OptOutState = { status: 'idle' | 'done' | 'error'; message: string }

/**
 * Records the opt-out.
 *
 * Deliberately a POST-only server action rather than a link target: inbox link
 * scanners follow every URL in a message, and a GET that unsubscribes would
 * silently opt people out of mail they never chose to stop.
 */
export async function optOutOfRetentionEmailsAction(
  _previous: OptOutState,
  formData: FormData,
): Promise<OptOutState> {
  const subscriptionId = String(formData.get('s') ?? '')
  const token = String(formData.get('t') ?? '')

  if (!subscriptionId || !token || !verifyRetentionEmailOptOutToken(subscriptionId, token)) {
    return { status: 'error', message: 'INVALID_LINK' }
  }

  const subscription = await prisma.platformSubscription.findUnique({
    where: { id: subscriptionId },
    select: { id: true, agent: { select: { userId: true } } },
  })
  const userId = subscription?.agent?.userId
  if (!subscription || !userId) {
    return { status: 'error', message: 'INVALID_LINK' }
  }

  const existing = await prisma.auditLog.findFirst({
    where: {
      action: RETENTION_EMAIL_OPT_OUT_ACTION,
      entity: 'PlatformSubscription',
      entityId: subscription.id,
    },
    select: { id: true },
  })
  if (existing) return { status: 'done', message: 'ALREADY_OPTED_OUT' }

  await prisma.auditLog.create({
    data: {
      userId,
      action: RETENTION_EMAIL_OPT_OUT_ACTION,
      entity: 'PlatformSubscription',
      entityId: subscription.id,
      after: { source: 'EMAIL_LINK' },
    },
  })

  return { status: 'done', message: 'OPTED_OUT' }
}
