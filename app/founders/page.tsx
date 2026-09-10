import type { Metadata } from "next";
import { FounderLeadForm } from "@/components/founders/FounderLeadForm";
import {
  FounderSignal,
  FoundersShell,
} from "@/components/founders/FoundersShell";
import styles from "./founders.module.css";

export const metadata: Metadata = {
  title: "Seja Founder da Keepr One",
  description:
    "Faça parte do início da Keepr One. Cadastre seu interesse e receba novidades sobre a liberação do seu acesso com 30 dias grátis.",
  alternates: { canonical: "/founders" },
  openGraph: {
    title: "O próximo capítulo começa com você. | Keepr One",
    description:
      "Seja Founder. Acesso antecipado e 30 dias grátis quando seu acesso for liberado.",
    type: "website",
    images: [
      { url: "/keepr-one-og.png", width: 1734, height: 907, alt: "Keepr One" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Seja Founder da Keepr One",
    description:
      "Faça parte do início. Cadastre-se para receber novidades sobre seu acesso.",
    images: ["/keepr-one-og.png"],
  },
};

export default async function FoundersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams;
  const attribution = Object.fromEntries(
    ["marketing_campaign", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map((key) => {
      const raw = params[key];
      return [key, (Array.isArray(raw) ? raw[0] ?? "" : raw ?? "").slice(0, 200)];
    }),
  );
  return (
    <FoundersShell>
      <section className={styles.signup} aria-labelledby="founders-title">
        <div className={styles.story}>
          <h1 id="founders-title" className="w-full max-w-5xl">
            <span className={styles.titleLine} data-founders-title-line>
              O próximo capítulo
            </span>{" "}
            <span className={styles.titleLine} data-founders-title-line>
              começa <em>com você.</em>
            </span>
          </h1>
          <p className={styles.intro} data-founders-intro>
            Faça parte do início da Keepr One. Uma nova forma de conectar sua
            operação, suas oportunidades e o que vem pela frente.
          </p>
          <div className={styles.benefit}>
            <span className={styles.benefitIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="m5 12 4 4L19 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <p>
              <strong>Acesso antecipado. 30 dias grátis.</strong>
              <span>
                Seu período gratuito começa quando o acesso for liberado.
              </span>
            </p>
          </div>
          <div className={styles.storyVisual} data-founders-visual>
            <FounderSignal />
            <p>
              O futuro da sua operação
              <br />
              <span>começa por uma conexão.</span>
            </p>
          </div>
        </div>
        <FounderLeadForm attribution={attribution} />
      </section>
    </FoundersShell>
  );
}
