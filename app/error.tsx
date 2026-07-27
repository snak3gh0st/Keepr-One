"use client";

import Link from "next/link";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-4 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-md bg-teal text-lg font-semibold text-paper">F</span>
      <span className="mt-3 font-sans text-xl font-semibold tracking-tight text-ink">Keepr One</span>
      <p className="mt-6 text-base font-semibold text-ink">Algo deu errado nesta página.</p>
      <p className="mt-1 text-sm text-ink-muted">
        Nada foi perdido. Tente novamente ou volte para o início.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          Tentar novamente
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-border-steel bg-paper px-4 py-2.5 text-sm font-semibold text-ink transition-colors duration-150 hover:border-teal focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
        >
          Ir para o início
        </Link>
      </div>
    </main>
  );
}
