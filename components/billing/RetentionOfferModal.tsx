"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RetentionOfferView } from "@/lib/billing/retention-offer-view";
import { useI18n } from "@/components/i18n/LanguageProvider";

const DISMISS_KEY = "keepr-one:retention-offer-dismissed";

/**
 * Mount detection without an effect. The modal must not be server-rendered,
 * because whether it was already dismissed lives in sessionStorage and is
 * unknowable on the server — rendering it there would flash it at an agent who
 * already closed it.
 */
const NO_OP_SUBSCRIBE = () => () => {};

function readDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private browsing and blocked site data must not suppress the offer.
    return false;
  }
}

/**
 * The discount offer, shown in-product while the agent still has access:
 * near the end of the trial, or once a cancellation has been scheduled.
 *
 * It is deliberately dismissible and remembered for the session. Neither moment
 * is a wall — the trial one precedes the real gate at /founders/expired, and an
 * agent who scheduled a cancellation keeps working until the period ends. A
 * modal that could not be closed would block paid access.
 */
export function RetentionOfferModal({ offer }: { offer: RetentionOfferView }) {
  const { language } = useI18n();
  const mounted = useSyncExternalStore(NO_OP_SUBSCRIBE, () => true, () => false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const open = mounted && !dismissedNow && !readDismissed();

  const dismiss = useCallback(() => {
    setDismissedNow(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Losing the dismissal only means the offer returns on the next page.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, dismiss]);

  if (!open) return null;

  const copy = (portuguese: string, english: string) =>
    language === "PT" ? portuguese : english;

  const isCancellation = offer.reason === "CANCEL_RETENTION";

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
                {isCancellation
                  ? copy("Sua assinatura será encerrada", "Your subscription is ending")
                  : copy("Seu teste está terminando", "Your trial is ending")}
              </span>
              <h2
                id="retention-modal-title"
                className="mt-1.5 text-xl font-semibold tracking-[-0.025em] text-ink"
              >
                {isCancellation
                  ? copy("Antes de ir: fique com 50% de desconto", "Before you go: stay with 50% off")
                  : copy("Continue com 50% de desconto", "Continue with 50% off")}
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
            {isCancellation
              ? copy(
                  "O cancelamento é desfeito e sua carteira, seus clientes e seu histórico seguem exatamente como estão.",
                  "The cancellation is undone and your book, clients, and history stay exactly as they are.",
                )
              : copy(
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
              {isCancellation
                ? copy(
                    `Continuar por ${offer.discountedPriceLabel}/mês`,
                    `Continue for ${offer.discountedPriceLabel}/month`,
                  )
                : copy(
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
