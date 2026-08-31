"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/components/i18n/LanguageProvider";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { copy } = useI18n();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-4 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-md bg-teal text-lg font-semibold text-paper">F</span>
      <span className="mt-3 font-sans text-xl font-semibold tracking-tight text-ink">Keepr One</span>
      <p className="mt-6 text-base font-semibold text-ink">
        {copy("Algo deu errado nesta página.", "Something went wrong on this page.")}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {copy(
          "Nada foi perdido. Tente novamente ou volte para o início.",
          "Nothing was lost. Try again or return home.",
        )}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          {copy("Tentar novamente", "Try again")}
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-150 hover:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          {copy("Ir para o início", "Go to home")}
        </Link>
      </div>
    </main>
  );
}
