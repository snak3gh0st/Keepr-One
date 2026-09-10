import type { Metadata } from "next";
import {
  ArrowIcon,
  FoundersShell,
  WhatsAppIcon,
} from "@/components/founders/FoundersShell";
import { FounderDashboardPreview } from "@/components/founders/FounderDashboardPreview";
import { FounderWhatsappRedirect } from "@/components/founders/FounderWhatsappRedirect";
import { getFounderWhatsappGroupUrl } from "@/lib/founder-community-config";
import styles from "../founders.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Cadastro recebido · Programa Founders",
  description:
    "Em breve, seu acesso à Keepr One será liberado com 30 dias grátis.",
  robots: { index: false, follow: false },
};

export default function FounderThankYouPage() {
  const whatsappUrl = getFounderWhatsappGroupUrl();
  return (
    <FoundersShell>
      <section className={styles.thankYou} aria-labelledby="thank-you-title">
        <div className={styles.thankYouStory}>
          <div className={styles.confirmation}>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="m8 12 3 3 5-6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Cadastro recebido
          </div>
          <h1 id="thank-you-title">
            <span className={styles.titleLine} data-founders-title-line>
              Você faz parte
            </span>{" "}
            <span className={styles.titleLine} data-founders-title-line>
              do <em>começo.</em>
            </span>
          </h1>
          <p className={styles.intro} data-founders-intro>
            Obrigado por dar esse passo com a Keepr One. Em breve, vamos liberar
            seu acesso com <strong>30 dias grátis</strong> para conhecer a
            plataforma.
          </p>
          <p className={styles.releaseNote}>
            Avisaremos pelos contatos que você cadastrou. Seu período gratuito
            só começa com a liberação do acesso.
          </p>
          <div className={styles.community}>
            <h2>Vamos dar o próximo passo juntos.</h2>
            <p>
              Entre no grupo de Founders no WhatsApp para acompanhar as
              novidades e a abertura dos acessos.
            </p>
            {whatsappUrl ? (
              <>
                <a
                  className={styles.primaryButton}
                  href={whatsappUrl}
                  aria-describedby="whatsapp-redirect"
                >
                  <WhatsAppIcon />
                  <span>ENTRAR NO GRUPO DO WHATSAPP</span>
                  <ArrowIcon />
                </a>
                <FounderWhatsappRedirect url={whatsappUrl} />
              </>
            ) : (
              <>
                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled
                  aria-describedby="whatsapp-pending"
                >
                  <WhatsAppIcon />
                  <span>ENTRAR NO GRUPO DO WHATSAPP</span>
                  <ArrowIcon />
                </button>
                <p id="whatsapp-pending" className={styles.whatsappNote}>
                  O link do grupo será disponibilizado em breve.
                </p>
              </>
            )}
          </div>
        </div>
        <div className={styles.thankYouVisual} data-founders-visual>
          <FounderDashboardPreview />
          <div className={styles.accessTicket}>
            <span>SEU ACESSO FOUNDER</span>
            <p>
              <strong>30</strong> dias para explorar
              <br />o que vem a seguir.
            </p>
            <div>
              <span aria-hidden="true" />
              Liberação em breve
            </div>
          </div>
        </div>
      </section>
    </FoundersShell>
  );
}
