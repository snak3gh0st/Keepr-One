import Link from "next/link";
import { getServerI18n } from "@/lib/i18n/server";

export default async function NotFound() {
  const { copy } = await getServerI18n();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-4 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-md bg-teal text-lg font-semibold text-paper">F</span>
      <span className="mt-3 font-sans text-xl font-semibold tracking-tight text-ink">Keepr One</span>
      <p className="mt-6 text-base font-semibold text-ink">
        {copy("Página não encontrada.", "Page not found.")}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {copy(
          "O link pode estar desatualizado, ou você não tem acesso a este conteúdo.",
          "The link may be outdated, or you may not have access to this content.",
        )}
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-md bg-teal px-4 py-2.5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-teal-deep focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
      >
        {copy("Ir para o início", "Go to home")}
      </Link>
    </main>
  );
}
