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

  return (
    <main className="relative isolate min-h-svh overflow-hidden bg-[#050706] px-5 py-6 text-white sm:px-8 sm:py-8">
      <div
        aria-hidden
        className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_76%_20%,rgba(101,228,151,0.12),transparent_28%),radial-gradient(circle_at_16%_88%,rgba(255,255,255,0.06),transparent_34%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-35 [background-image:linear-gradient(rgba(101,228,151,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(101,228,151,0.07)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_82%)]"
      />

      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-[1320px] flex-col sm:min-h-[calc(100svh-4rem)]">
        <header className="flex items-center justify-between gap-6 border-b border-white/10 pb-5">
          <Link href="/" aria-label={copy('Keepr One — início', 'Keepr One — home')}>
            <Logo size={32} className="text-white" />
          </Link>
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-white/48">
            {presentation.programLabel}
          </span>
        </header>

        <section className="my-auto grid items-center gap-12 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.65fr)] lg:gap-24">
          <div>
            <p className="mb-7 flex items-center gap-3 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-mint">
              <span aria-hidden className="h-px w-10 bg-mint" />
              {presentation.eyebrow}
            </p>
            <h1 className="max-w-4xl font-[var(--font-outfit)] text-[clamp(3.35rem,7.3vw,7.3rem)] font-medium leading-[0.88] tracking-[-0.068em]">
              {copy('Sua operação continua aqui.', 'Your operations continue here.')}
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-8 text-white/58 sm:text-lg">
              {presentation.description}
            </p>
          </div>

          <aside className="border border-white/14 bg-white/[0.045] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:p-8">
            <div className="flex items-start justify-between gap-5 border-b border-white/12 pb-6">
              <div>
                <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-mint">
                  {copy('Continuidade', 'Continuity')}
                </span>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{presentation.planLabel}</h2>
              </div>
              <span aria-hidden className="grid h-10 w-10 place-items-center border border-mint/35 text-mint">↗</span>
            </div>

            <div className="py-7">
              <p className="text-sm text-white/48">{copy('Mensalidade do plano', 'Monthly plan fee')}</p>
              <p className="mt-2 font-[var(--font-outfit)] text-5xl font-medium tracking-[-0.06em]">{price}</p>
              <p className="mt-2 text-xs text-white/42">{copy('por mês · cobrança em USD', 'per month · billed in USD')}</p>
            </div>

            <ul className="space-y-3 border-t border-white/12 pt-6 text-sm leading-6 text-white/66">
              <li className="flex gap-3"><span className="text-mint">✓</span> {copy('Seus registros permanecem preservados.', 'Your records remain preserved.')}</li>
              <li className="flex gap-3"><span className="text-mint">✓</span> {copy('O acesso volta após a ativação comercial.', 'Access returns after subscription activation.')}</li>
              <li className="flex gap-3"><span className="text-mint">✓</span> {presentation.profileBenefit}</li>
            </ul>

            {billingState === 'canceled' && (
              <p className="mt-6 border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white/66">
                {copy(
                  'Ativação cancelada. Nenhuma nova assinatura foi vinculada.',
                  'Activation canceled. No new subscription was linked.',
                )}
              </p>
            )}
            {(billingState === 'pending' || billingState === 'invalid') && (
              <p className="mt-6 border border-amber-300/25 bg-amber-200/[0.06] px-4 py-3 text-sm text-amber-100/80">
                {copy(
                  'Ainda não foi possível confirmar a assinatura no Stripe. Você pode tentar novamente; seus dados continuam preservados.',
                  "We couldn't confirm the Stripe subscription yet. You can try again; your data remains preserved.",
                )}
              </p>
            )}

            {stripePlan ? (
              <form action="/api/billing/checkout" method="post">
                <button
                  type="submit"
                  className="mt-8 flex min-h-14 w-full items-center justify-between bg-white px-5 text-sm font-bold text-black transition-colors hover:bg-mint focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mint"
                >
                  {copy('Ativar assinatura segura', 'Activate secure subscription')}
                  <span aria-hidden>↗</span>
                </button>
              </form>
            ) : (
              <Link
                href={billingContactUrl}
                className="mt-8 flex min-h-14 items-center justify-between bg-white px-5 text-sm font-bold text-black transition-colors hover:bg-mint focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mint"
              >
                {copy('Falar com a Keepr One', 'Contact Keepr One')}
                <span aria-hidden>↗</span>
              </Link>
            )}
            <p className="mt-4 text-xs leading-5 text-white/42">
              {stripePlan
                ? copy(
                    'Pagamento e renovação são processados pelo Stripe. Seus dados da National Life não são enviados para a cobrança.',
                    'Payment and renewal are processed by Stripe. Your National Life data is not sent to billing.',
                  )
                : copy(
                    'A ativação deste plano é concluída com a equipe da Keepr One.',
                    'This plan is activated with the Keepr One team.',
                  )}
            </p>
          </aside>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-5 border-t border-white/10 pt-5 text-xs text-white/42">
          <span>© {new Date().getFullYear()} Keepr One</span>
          <FounderSignOutButton />
        </footer>
      </div>
    </main>
  )
}
