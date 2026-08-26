import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { FounderRegistrationForm } from "@/components/founders/FounderRegistrationForm";
import { isFounderRegistrationOpen } from "@/lib/founder-invite-config";

const appLoginUrl = `${(
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.BETTER_AUTH_URL ??
  "https://app.keeprone.com"
).replace(/\/$/, "")}/login`;

// The registration switch is a server-only runtime setting. Keeping this
// route dynamic prevents a build made without the code from permanently
// baking the "paused" state into production.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Programa Founders — 30 dias de acesso",
  description:
    "Crie seu acesso Founder como agente ou agência e use todas as funções do perfil escolhido gratuitamente por 30 dias.",
  alternates: {
    canonical: "/founders",
  },
  openGraph: {
    title: "Programa Founders · Keepr One",
    description:
      "Acesso antecipado à Keepr One por 30 dias, sem cobrança agora. Escolha seu perfil e comece a testar a plataforma.",
    type: "website",
    images: [
      {
        url: "/keepr-one-og.png",
        width: 1734,
        height: 907,
        alt: "Programa Founders da Keepr One",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Programa Founders · Keepr One",
    description:
      "Crie seu acesso e use a Keepr One gratuitamente por 30 dias.",
    images: ["/keepr-one-og.png"],
  },
};

const founderSteps = [
  {
    index: "01",
    title: "Escolha seu perfil",
    detail: "Agente individual ou agência.",
  },
  {
    index: "02",
    title: "Crie seu acesso",
    detail: "Seus dados ficam ligados ao plano escolhido.",
  },
  {
    index: "03",
    title: "Use por 30 dias",
    detail: "Todas as funções do perfil, sem cobrança agora.",
  },
];

export default function FoundersPage() {
  const registrationOpen = isFounderRegistrationOpen();

  return (
    <main className="founders-root">
      <div className="founders-grid-texture" aria-hidden="true" />
      <div className="founders-grain" aria-hidden="true" />

      <header className="founders-header">
        <nav className="founders-nav" aria-label="Navegação do Programa Founders">
          <Link
            className="founders-brand"
            href="/"
            aria-label="Keepr One — página inicial"
          >
            <Logo size={32} className="text-white" />
          </Link>

          <div className="founders-nav-actions">
            <Link className="founders-back-link" href="/">
              Voltar ao site
            </Link>
            <Link className="founders-login-link" href={appLoginUrl}>
              Já tenho acesso
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </nav>
      </header>

      <section className="founders-stage" aria-labelledby="founders-title">
        <div className="founders-story">
          <p className="founders-kicker">
            <span aria-hidden="true" />
            Programa Founders · Acesso antecipado
          </p>

          <h1 id="founders-title">30 dias para colocar sua operação em movimento.</h1>

          <p className="founders-intro">
            Se você recebeu nosso convite, cadastre-se como agente ou agência e
            conheça a Keepr One com todas as funções do perfil escolhido. Seu
            período gratuito começa quando o acesso é criado.
          </p>

          <ol className="founders-steps" aria-label="Como funciona o acesso Founder">
            {founderSteps.map((step) => (
              <li key={step.index}>
                <span>{step.index}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="founders-trial-note">
            <span>Depois do teste</span>
            <p>
              No 31º dia, será necessário escolher e pagar uma assinatura para
              continuar usando a plataforma.
            </p>
          </div>
        </div>

        <div className="founders-form-column">
          <FounderRegistrationForm registrationOpen={registrationOpen} />
        </div>
      </section>

      <footer className="founders-footer">
        <p>© {new Date().getFullYear()} Keepr One</p>
        <div>
          <span>30 dias gratuitos · sem cobrança agora</span>
          <Link href="/privacy">Política de privacidade</Link>
        </div>
      </footer>
    </main>
  );
}
