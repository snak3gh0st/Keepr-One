import type { Metadata } from 'next'
import { getServerI18n } from '@/lib/i18n/server'
import { OptOutForm } from './OptOutForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Keepr One',
  robots: { index: false, follow: false },
}

/**
 * Confirmation page for the unsubscribe link carried in the nurture emails.
 *
 * Reaching this page changes nothing — the opt-out only happens when the person
 * presses the button, so a link scanner opening the URL cannot unsubscribe them.
 * It is intentionally public: somebody who no longer wants our mail must not be
 * required to log in first.
 */
export default async function RetentionEmailOptOutPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; t?: string }>
}) {
  const { s, t } = await searchParams
  const { copy, language } = await getServerI18n()

  return (
    <main className="grid min-h-svh place-items-center bg-canvas px-4 py-10 text-ink">
      <section className="w-full max-w-[520px] rounded-2xl border border-border-steel bg-paper p-6 shadow-[0_22px_60px_rgba(8,17,12,0.12)] sm:p-8">
        <h1 className="text-xl font-semibold tracking-[-0.025em] sm:text-2xl">
          {copy('Parar de receber lembretes?', 'Stop receiving reminders?')}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          {copy(
            'Você deixará de receber os lembretes sobre a assinatura e a oferta de desconto. E-mails essenciais da conta, como recuperação de senha e recibos, continuam normalmente.',
            'You will stop receiving reminders about your subscription and the discount offer. Essential account emails, such as password resets and receipts, continue as usual.',
          )}
        </p>

        <OptOutForm
          subscriptionId={s ?? ''}
          token={t ?? ''}
          language={language === 'EN' ? 'EN' : 'PT'}
        />
      </section>
    </main>
  )
}
