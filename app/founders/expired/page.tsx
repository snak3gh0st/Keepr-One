import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FounderSignOutButton } from '@/components/founders/FounderSignOutButton'
import { Logo } from '@/components/Logo'
import { resolveFounderAccessForAgent } from '@/lib/founder-access'
import { localeFor, type UserLanguage } from '@/lib/i18n/config'
import { getServerI18n } from '@/lib/i18n/server'
import { formatPlatformPlanPrice } from '@/lib/plans'
import { prisma } from '@/lib/prisma'
import { requireRoleWithoutFounderAccess } from '@/lib/require-role'
import { buildAccessRequiredPresentation } from './presentation'
import { getStripeCatalogEntry } from '@/lib/stripe/platform-catalog'

export async function generateMetadata(): Promise<Metadata> {
  const { copy } = await getServerI18n()
  return {
    title: copy('Continuar na Keepr One', 'Continue with Keepr One'),
    description: copy(
      'Ative sua assinatura para continuar usando a Keepr One.',
      'Activate your subscription to continue using Keepr One.',
    ),
    robots: { index: false, follow: false },
  }
}

function formatDate(date: Date | null, language: UserLanguage): string {
  if (!date) {
    return language === 'PT'
      ? 'uma data não informada'
      : 'an unavailable date'
  }
  return new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'long',
    timeZone: 'America/New_York',
  }).format(date)
}

export default async function FounderExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>
}) {
  const { language, copy } = await getServerI18n()
  const billingState = (await searchParams).billing
  let session
  try {
    session = await requireRoleWithoutFounderAccess('AGENT')
  } catch {
    redirect('/login')
  }

  const agent = await prisma.agent.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!agent) redirect('/login')

  const access = await resolveFounderAccessForAgent(agent.id)
  if (access.hasAccess || access.state === 'LEGACY') redirect('/agent')

  const presentation = buildAccessRequiredPresentation(
    access,
    formatDate(access.trialEndsAt, language),
    language,
  )
  const price = formatPlatformPlanPrice(presentation.plan, localeFor(language))
  const billingContactUrl = process.env.NEXT_PUBLIC_BILLING_CONTACT_URL
    ?? 'https://keeprone.com/#planos'
  const stripePlan = getStripeCatalogEntry(presentation.plan)
  const linkedBilling = access.subscription
    ? await prisma.platformSubscription.findUnique({
        where: { id: access.subscription.id },
        select: { stripeCustomerId: true, stripeSubscriptionId: true },
      })
    : null
  const hasLinkedStripeSubscription = Boolean(
    linkedBilling?.stripeCustomerId && linkedBilling.stripeSubscriptionId,
  )
  const impersonatedBy = (session.session as { impersonatedBy?: unknown }).impersonatedBy
  const isSupportPreview = typeof impersonatedBy === 'string'

  return (
    <main className="relative isolate min-h-svh overflow-hidden bg-canvas px-4 py-5 text-ink sm:px-7 sm:py-7">
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-[38vh] min-h-[300px] bg-[#08110c]" />

      <div className="mx-auto flex min-h-[calc(100svh-2.5rem)] w-full max-w-[1120px] flex-col sm:min-h-[calc(100svh-3.5rem)]">
        <header className="flex items-center justify-between gap-6 border-b border-white/10 pb-5 text-white">
          <Link href="/" aria-label={copy('Keepr One — início', 'Keepr One — home')}>
            <Logo size={32} className="text-white" />
          </Link>
          <span className="font-mono text-xs uppercase tracking-[0.12em] text-white/55">
            {presentation.programLabel}
          </span>
        </header>

        <div className="flex flex-1 items-center justify-center py-10 sm:py-14">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-required-title"
            className="w-full max-w-[760px] overflow-hidden rounded-2xl border border-border-steel bg-paper shadow-[0_22px_60px_rgba(8,17,12,0.16)]"
          >
            <div className="h-1.5 bg-mint" />
            <div className="p-5 sm:p-8 lg:p-10">
              <div className="flex items-start justify-between gap-5 border-b border-border-steel pb-6">
              <div>
                  <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-teal">
                    {presentation.eyebrow}
                  </span>
                  <h1 id="payment-required-title" className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-ink sm:text-3xl">
                    {access.paymentRequiredAt
                      ? copy('Pagamento necessário para continuar', 'Payment required to continue')
                      : copy('Seu período de teste terminou', 'Your free trial has ended')}
                  </h1>
              </div>
                <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-teal-pale text-lg font-semibold text-teal">$</span>
              </div>

              <p className="mt-6 max-w-2xl text-sm leading-6 text-ink-muted sm:text-base">
                {presentation.description}
              </p>

              <dl className="mt-6 grid gap-3 rounded-xl border border-border-steel bg-panel/60 p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-ink-muted">{copy('Plano', 'Plan')}</dt>
                  <dd className="mt-1 text-sm font-semibold text-ink">{presentation.planLabel}</dd>
                </div>
                <div className="sm:text-right">
                  <dt className="text-xs text-ink-muted">{copy('Mensalidade', 'Monthly price')}</dt>
                  <dd className="mt-1 font-mono text-sm font-semibold text-ink">{price} / {copy('mês', 'month')}</dd>
                </div>
              </dl>

            {billingState === 'canceled' && (
                <p className="mt-5 rounded-lg border border-border-steel bg-panel px-4 py-3 text-sm text-ink-muted">
                {copy(
                  'Ativação cancelada. Nenhuma nova assinatura foi vinculada.',
                  'Activation canceled. No new subscription was linked.',
                )}
              </p>
            )}
            {(billingState === 'pending' || billingState === 'invalid') && (
                <p className="mt-5 rounded-lg border border-gold/25 bg-gold-pale px-4 py-3 text-sm text-gold-ink">
                {copy(
                  'Ainda não foi possível confirmar a assinatura no Stripe. Você pode tentar novamente; seus dados continuam preservados.',
                  "We couldn't confirm the Stripe subscription yet. You can try again; your data remains preserved.",
                )}
              </p>
            )}

              {!isSupportPreview && stripePlan ? (
                <form action={hasLinkedStripeSubscription ? '/api/billing/portal' : '/api/billing/checkout'} method="post">
                <button
                  type="submit"
                    className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-rail-strong px-5 text-sm font-semibold text-paper transition-colors hover:bg-rail focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
                >
                    {hasLinkedStripeSubscription
                      ? copy('Resolver pagamento no Stripe', 'Resolve payment in Stripe')
                      : copy(`Ativar plano por ${price}/mês`, `Activate plan for ${price}/month`)}
                  <span aria-hidden>↗</span>
                </button>
              </form>
              ) : !isSupportPreview ? (
              <Link
                href={billingContactUrl}
                  className="mt-6 flex min-h-12 items-center justify-center gap-2 rounded-full bg-rail-strong px-5 text-sm font-semibold text-paper transition-colors hover:bg-rail focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
              >
                {copy('Falar com a Keepr One', 'Contact Keepr One')}
                <span aria-hidden>↗</span>
              </Link>
              ) : (
                <p className="mt-6 rounded-lg bg-panel px-4 py-3 text-sm text-ink-muted">
                  {copy(
                    'O pagamento fica desabilitado durante a visualização de suporte. Volte ao painel Keepr One para continuar.',
                    'Payment is disabled during support preview. Return to the Keepr One admin to continue.',
                  )}
                </p>
              )}
              <p className="mt-4 text-center text-xs leading-5 text-ink-muted">
              {stripePlan && !isSupportPreview
                ? copy(
                      'Pagamento seguro processado pelo Stripe. Seus dados operacionais não são enviados para a cobrança.',
                      'Secure payment processed by Stripe. Your operations data is not sent to billing.',
                  )
                : copy(
                      'Seus registros e configurações permanecem preservados.',
                      'Your records and settings remain preserved.',
                  )}
            </p>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-border-steel pt-5 text-xs text-ink-muted">
          <span>© {new Date().getFullYear()} Keepr One</span>
          <FounderSignOutButton />
        </footer>
      </div>
    </main>
  )
}
