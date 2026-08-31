import type { Metadata } from "next";
import { cache } from "react";
import { Logo } from "@/components/Logo";
import { getPublicSchedulingPage } from "@/lib/scheduling/availability";
import { getServerLanguage } from "@/lib/i18n/server";
import { localize } from "@/lib/i18n/catalog";
import type { UserLanguage } from "@/lib/i18n/config";
import { PublicScheduling } from "./PublicScheduling";

const resolvePageLanguage = cache(async (slug: string): Promise<UserLanguage> => {
  try {
    return (await getPublicSchedulingPage(slug)).ownerLanguage;
  } catch {
    return getServerLanguage();
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const language = await resolvePageLanguage(slug);
  return {
    title: localize(language, "Agendar reunião", "Schedule a meeting"),
    description: localize(
      language,
      "Escolha um horário disponível para sua reunião.",
      "Choose an available time for your meeting.",
    ),
    robots: { index: false, follow: false },
  };
}

export default async function PublicSchedulingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const language = await resolvePageLanguage(slug);
  const copy = (portuguese: string, english: string) => localize(language, portuguese, english);

  return (
    <main className="public-scheduling-root keepr-grid">
      <header className="public-scheduling-nav">
        <Logo size={32} className="public-scheduling-logo text-white" />
        <span className="public-scheduling-trust">{copy("Agendamento seguro", "Secure scheduling")}</span>
      </header>
      <PublicScheduling slug={slug} initialLanguage={language} />
      <footer className="public-scheduling-footer">
        <span>Keepr One</span>
        <p>{copy("Seus dados serão usados somente para organizar esta reunião.", "Your information will only be used to organize this meeting.")}</p>
      </footer>
    </main>
  );
}
