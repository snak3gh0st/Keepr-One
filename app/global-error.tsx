"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  localeFor,
  normalizeLanguage,
  type UserLanguage,
} from "@/lib/i18n/config";
import { localize } from "@/lib/i18n/catalog";

function subscribeToLanguageCookie() {
  return () => undefined;
}

function getClientLanguage(): UserLanguage {
  const cookieValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LANGUAGE_COOKIE}=`))
    ?.slice(LANGUAGE_COOKIE.length + 1);
  return normalizeLanguage(cookieValue) ?? DEFAULT_LANGUAGE;
}

function getServerLanguage(): UserLanguage {
  return DEFAULT_LANGUAGE;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const language = useSyncExternalStore(
    subscribeToLanguageCookie,
    getClientLanguage,
    getServerLanguage,
  );

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const copy = (portuguese: string, english: string) =>
    localize(language, portuguese, english);

  return (
    <html lang={localeFor(language)}>
      <body className="min-h-full bg-paper font-sans text-ink">
        <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-4 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-teal text-lg font-semibold text-paper">F</span>
          <span className="mt-3 font-sans text-xl font-semibold tracking-tight text-ink">Keepr One</span>
          <p className="mt-6 text-base font-semibold text-ink">
            {copy("Não foi possível carregar a Keepr One.", "Keepr One couldn't be loaded.")}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {copy(
              "Tente novamente. Se o problema continuar, atualize a página.",
              "Try again. If the problem continues, refresh the page.",
            )}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
          >
            {copy("Tentar novamente", "Try again")}
          </button>
        </main>
      </body>
    </html>
  );
}
