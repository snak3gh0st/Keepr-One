import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { PublicScheduling } from "./PublicScheduling";

export const metadata: Metadata = {
  title: "Agendar reunião",
  description: "Escolha um horário disponível para sua reunião.",
  robots: { index: false, follow: false },
};

export default async function PublicSchedulingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="public-scheduling-root keepr-grid">
      <header className="public-scheduling-nav">
        <Logo size={32} className="public-scheduling-logo text-white" />
        <span className="public-scheduling-trust">Agendamento seguro</span>
      </header>
      <PublicScheduling slug={slug} />
      <footer className="public-scheduling-footer">
        <span>Keepr One</span>
        <p>Seus dados serão usados somente para organizar esta reunião.</p>
      </footer>
    </main>
  );
}
