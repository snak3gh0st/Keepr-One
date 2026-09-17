"use client";

import { useEffect, useRef, useState } from "react";
import type { RetentionOfferView } from "@/lib/billing/retention-offer-view";
import { useI18n } from "@/components/i18n/LanguageProvider";

const DISMISS_KEY = "keepr-one:retention-offer-dismissed";

/**
 * The trial-conversion offer, shown in-product while the trial is still running.
 *
 * It is deliberately dismissible and remembered for the session: once the trial
 * actually expires the agent is redirected to /founders/expired, which is the
 * hard gate. This modal is the warning before that wall, not a second wall — an
 * agent still inside a paid-for trial must be able to keep working.
 */
export function RetentionOfferModal({ offer }: { offer: RetentionOfferView }) {
  const { language } = useI18n();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // Private browsing and blocked site data must not suppress the offer.
      dismissed = false;
    }
    if (!dismissed) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function dismiss() {
    setOpen(false);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Losing the dismissal only means the offer returns on the next page.
    }
  }

  if (!open) return null;

  const copy = (portuguese: string, english: string) =>
    language === "PT" ? portuguese : english;

  const durationNote = offer.durationInMonths
    ? copy(
        `Desconto nos primeiros ${offer.durationInMonths} meses. Depois, ${offer.fullPriceLabel}/mês.`,
        `Discounted for the first ${offer.durationInMonths} months. After that, ${offer.fullPriceLabel}/month.`,
      )
    : copy(
        `Desconto enquanto a assinatura estiver ativa. Preço cheio: ${offer.fullPriceLabel}/mês.`,
        `Discounted while the subscription stays active. Full price: ${offer.fullPriceLabel}/month.`,
      );

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#08110c]/55 px-4 py-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="retention-modal-title"
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-border-steel bg-paper shadow-[0_22px_60px_rgba(8,17,12,0.22)]"
      >
        <div className="h-1.5 bg-mint" />
        <div className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-teal">
                {copy("Seu teste está terminando", "Your trial is ending")}
              </span>
              <h2
                id="retention-modal-title"
                className="mt-1.5 text-xl font-semibold tracking-[-0.025em] text-ink"
              >
                {copy("Continue com 50% de desconto", "Continue with 50% off")}
              </h2>
            </div>
            <button
              ref={closeButton}
              type="button"
              onClick={dismiss}
              aria-label={copy("Fechar", "Close")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-panel focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
            >
              <span aria-hidden>×</span>
            </button>
          </div>

          <p className="mt-3 text-sm leading-6 text-ink-muted">
            {copy(
              "Sua carteira, seus clientes e seu histórico continuam exatamente como estão.",
              "Your book, your clients, and your history stay exactly as they are.",
            )}
          </p>

          <p className="mt-4 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-ink">
              {offer.discountedPriceLabel}
            </span>
            <span className="text-sm text-ink-muted">/ {copy("mês", "month")}</span>
            <span className="font-mono text-sm text-ink-muted line-through">
              {offer.fullPriceLabel}
            </span>
          </p>

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

          <button
            type="button"
            onClick={dismiss}
            className="mt-2.5 min-h-11 w-full rounded-full px-5 text-sm font-medium text-ink-muted transition-colors hover:bg-panel focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          >
            {copy("Agora não", "Not now")}
          </button>

          <p className="mt-3 text-xs leading-5 text-ink-muted">{durationNote}</p>
        </div>
      </div>
    </div>
  );
}
