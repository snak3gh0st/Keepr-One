import 'server-only'

import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { localeFor, type UserLanguage } from '@/lib/i18n/config'
import { formatPlanPrice, getPlatformPlanPriceCents } from '@/lib/plans'
import { sendNoticeEmail } from '@/lib/email/send'
import { renderRetentionOfferEmail } from '@/lib/email/retention-offer'
import { getConfiguredRetentionCouponId } from '@/lib/stripe/retention-offer'
import {
  decideRetentionEmail,
  type RetentionEmailStepKey,
} from './retention-email-schedule'
import {
  RETENTION_OFFER_DURATION_MONTHS,
  RETENTION_OFFER_PERCENT_OFF,
} from './retention-offer-view'
import { retentionEmailOptOutToken } from './retention-email-token'

export const RETENTION_EMAIL_SENT_ACTION = 'BILLING_RETENTION_EMAIL_SENT'
export const RETENTION_EMAIL_OPT_OUT_ACTION = 'BILLING_RETENTION_EMAIL_OPTED_OUT'

const MIN_SECRET_LENGTH = 32
/** A single pass never writes to more addresses than this. */
const MAX_PER_PASS = 200

export type RetentionEmailPassReport = {
  considered: number
  sent: number
  skipped: Record<string, number>
  failed: number
}

type AuthResult = 'OK' | 'DENIED' | 'NOT_CONFIGURED'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/**
 * Same bearer-secret shape as the other internal jobs. With no strong secret
 * configured the endpoint behaves as unavailable rather than as open.
 */
export function authorizeRetentionEmailRequest(
  authorization: string | null,
  secret: string | undefined = process.env.BILLING_RETENTION_EMAIL_CRON_SECRET,
): AuthResult {
  const configured = secret?.trim() ?? ''
  if (configured.length < MIN_SECRET_LENGTH) return 'NOT_CONFIGURED'
  if (!authorization?.startsWith('Bearer ')) return 'DENIED'

  const presented = authorization.slice('Bearer '.length).trim()
  if (!presented) return 'DENIED'
  return timingSafeEqual(digest(presented), digest(configured)) ? 'OK' : 'DENIED'
}

function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL
  return (configured ?? 'https://app.keeprone.com').replace(/\/$/, '')
}

function formatAccessEnd(date: Date | null, language: UserLanguage): string {
  if (!date) return language === 'PT' ? 'uma data não informada' : 'an unavailable date'
  return new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'long',
    timeZone: 'America/New_York',
  }).format(date)
}

/**
 * Sends at most one message per account per pass.
 *
 * Everything the decision needs is read per-subscription rather than joined in
 * one query, because the commercial state lives in founder-access and must not
 * be re-derived here — a second, divergent definition of "still has access" is
 * exactly how somebody who already paid receives a "your trial is ending" note.
 */
export async function runRetentionEmailPass(now = new Date()): Promise<RetentionEmailPassReport> {
  const report: RetentionEmailPassReport = { considered: 0, sent: 0, skipped: {}, failed: 0 }

  function skip(reason: string) {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1
  }

  if (!getConfiguredRetentionCouponId()) {
    skip('OFFER_DISABLED')
    return report
  }

  const candidates = await prisma.platformSubscription.findMany({
    where: {
      OR: [
        { status: { in: ['TRIALING', 'PAST_DUE', 'CANCELED', 'EXPIRED'] } },
        { cancelAtPeriodEnd: true },
      ],
      agentId: { not: null },
    },
    select: { id: true, agentId: true },
    take: MAX_PER_PASS,
  })

  for (const candidate of candidates) {
    if (!candidate.agentId) continue
    report.considered += 1

    try {
      const agent = await prisma.agent.findUnique({
        where: { id: candidate.agentId },
        select: { user: { select: { id: true, email: true, name: true, language: true } } },
      })
      const user = agent?.user
      if (!user?.email) {
        skip('NO_EMAIL')
        continue
      }

      const access = await resolveFounderAccessForAgent(candidate.agentId)
      if (access.state === 'LEGACY') {
        skip('LEGACY_ACCESS')
        continue
      }

      const history = await prisma.auditLog.findMany({
        where: {
          action: { in: [RETENTION_EMAIL_SENT_ACTION, RETENTION_EMAIL_OPT_OUT_ACTION] },
          entity: 'PlatformSubscription',
          entityId: candidate.id,
        },
        select: { action: true, after: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })

      const optedOut = history.some((row) => row.action === RETENTION_EMAIL_OPT_OUT_ACTION)
      const sends = history.filter((row) => row.action === RETENTION_EMAIL_SENT_ACTION)
      const sentKeys = sends
        .map((row) => (row.after as { step?: unknown } | null)?.step)
        .filter((step): step is RetentionEmailStepKey => typeof step === 'string')
      const lapsedSends = sentKeys.filter((step) => step === 'ACCESS_LAPSED').length

      const decision = decideRetentionEmail(
        {
          sentKeys,
          lastSentAt: sends[0]?.createdAt ?? null,
          lapsedSends,
          optedOut,
          subscribed:
            access.state === 'PAID' && access.subscription?.cancelAtPeriodEnd !== true,
          accessEndsAt: access.trialEndsAt ?? access.subscription?.currentPeriodEnd ?? null,
        },
        now,
      )

      if (!decision.send) {
        skip(decision.reason)
        continue
      }

      const language: UserLanguage = user.language === 'EN' ? 'EN' : 'PT'
      const plan = access.requiredPlan ?? 'AGENT_INDIVIDUAL'
      const fullCents = getPlatformPlanPriceCents(plan)
      const locale = localeFor(language)
      const content = renderRetentionOfferEmail({
        step: decision.step,
        agentName: user.name?.split(' ')[0] || (language === 'PT' ? 'Olá' : 'Hello'),
        percentOff: RETENTION_OFFER_PERCENT_OFF,
        durationInMonths: RETENTION_OFFER_DURATION_MONTHS,
        fullPriceLabel: formatPlanPrice(fullCents, locale),
        discountedPriceLabel: formatPlanPrice(
          Math.round(fullCents * (1 - RETENTION_OFFER_PERCENT_OFF / 100)),
          locale,
        ),
        accessEndsLabel: formatAccessEnd(
          access.trialEndsAt ?? access.subscription?.currentPeriodEnd ?? null,
          language,
        ),
        language,
      })

      const optOutToken = retentionEmailOptOutToken(candidate.id)
      const optOutHtml = optOutToken
        ? `<p style="margin:24px 0 0; font-size:12px; opacity:0.6;"><a href="${appUrl()}/billing/emails/opt-out?s=${encodeURIComponent(candidate.id)}&t=${encodeURIComponent(optOutToken)}" style="color:inherit;">${
            language === 'PT'
              ? 'Não quero mais receber estes lembretes'
              : 'Stop sending me these reminders'
          }</a></p>`
        : ''

      await sendNoticeEmail({
        to: user.email,
        subject: content.subject,
        heading: content.heading,
        bodyHtml: `${content.bodyHtml}${optOutHtml}`,
        ctaLabel: content.ctaLabel,
        ctaUrl: `${appUrl()}/founders/expired`,
        language,
      })

      // Written only after the provider accepted the message, so a delivery
      // failure retries on the next pass instead of silently skipping a step.
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: RETENTION_EMAIL_SENT_ACTION,
          entity: 'PlatformSubscription',
          entityId: candidate.id,
          after: { step: decision.step, sequenceNumber: decision.sequenceNumber },
        },
      })
      report.sent += 1
    } catch (error) {
      report.failed += 1
      console.error('Retention email failed for a subscription', {
        subscriptionId: candidate.id,
        code: error instanceof Error ? error.message : 'UNKNOWN',
      })
    }
  }

  return report
}
