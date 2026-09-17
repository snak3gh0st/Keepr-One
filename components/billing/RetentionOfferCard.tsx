import type { RetentionOfferView } from '@/lib/billing/retention-offer-view'
import { localize } from '@/lib/i18n/catalog'
import type { UserLanguage } from '@/lib/i18n/config'

/**
 * The discounted activation offer, rendered above the full-price action.
 *
 * It states the full price alongside the discounted one and says plainly when
 * the discount ends, so nobody subscribes expecting the reduced amount to be
 * permanent. The form posts to the same checkout endpoint as full price; the
 * server decides whether the coupon actually applies.
 */
export function RetentionOfferCard({
  offer,
  language,
  disabled = false,
}: {
  offer: RetentionOfferView
  language: UserLanguage
  disabled?: boolean
}) {
  const copy = (portuguese: string, english: string) => localize(language, portuguese, english)

  const headline = offer.reason === 'CANCEL_RETENTION'
    ? copy('Antes de ir: continue com 50% de desconto', 'Before you go: stay with 50% off')
    : copy('Ative agora com 50% de desconto', 'Activate now with 50% off')

  const rationale = offer.reason === 'CANCEL_RETENTION'
    ? copy(
        'Sua carteira, seus clientes e seu histórico continuam exatamente como estão.',
        'Your book, your clients, and your history stay exactly as they are.',
      )
    : copy(
        'Seu período de teste está terminando. Ative sem perder nada do que já construiu.',
        'Your trial is ending. Activate without losing anything you have built.',
      )

  const durationNote = offer.durationInMonths
    ? copy(
        `Desconto válido nos primeiros ${offer.durationInMonths} meses. Depois, ${offer.fullPriceLabel}/mês.`,
        `Discount applies to the first ${offer.durationInMonths} months. After that, ${offer.fullPriceLabel}/month.`,
      )
    : copy(
        `Desconto válido enquanto a assinatura estiver ativa. Preço cheio: ${offer.fullPriceLabel}/mês.`,
        `Discount applies while the subscription stays active. Full price: ${offer.fullPriceLabel}/month.`,
      )

  return (
    <section
      aria-labelledby="retention-offer-title"
      className="mt-6 overflow-hidden rounded-xl border border-mint/40 bg-mint/[0.07]"
    >
      <div className="p-4 sm:p-5">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-teal">
          {copy('Oferta', 'Offer')}
        </span>
        <h2
          id="retention-offer-title"
          className="mt-1.5 text-lg font-semibold tracking-[-0.02em] text-ink"
        >
          {headline}
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-ink-muted">{rationale}</p>

        <p className="mt-4 flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold text-ink">
            {offer.discountedPriceLabel}
          </span>
          <span className="text-sm text-ink-muted">/ {copy('mês', 'month')}</span>
          <span className="font-mono text-sm text-ink-muted line-through">
            {offer.fullPriceLabel}
          </span>
        </p>

        {disabled ? (
          <p className="mt-4 rounded-lg bg-panel px-4 py-3 text-sm text-ink-muted">
            {copy(
              'O pagamento fica desabilitado durante a visualização de suporte.',
              'Payment is disabled during support preview.',
            )}
          </p>
        ) : (
          <form action={offer.checkoutPath} method="post">
            <button
              type="submit"
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-mint px-5 text-sm font-semibold text-rail-strong transition-colors hover:bg-mint/85 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            >
              {copy(
                `Assinar por ${offer.discountedPriceLabel}/mês`,
                `Subscribe for ${offer.discountedPriceLabel}/month`,
              )}
              <span aria-hidden>↗</span>
            </button>
          </form>
        )}

        <p className="mt-3 text-xs leading-5 text-ink-muted">{durationNote}</p>
      </div>
    </section>
  )
}
