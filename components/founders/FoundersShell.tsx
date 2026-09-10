import type { ReactNode } from "react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/Logo";
import { FoundersMotion } from "./FoundersMotion";
import styles from "@/app/founders/founders.module.css";

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.3-4.8A8.5 8.5 0 1 1 20.5 11.7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M8.1 7.5c.3-.2.6-.1.8.3l1 1.8c.1.3 0 .6-.4.9l-.4.4c.7 1.4 1.6 2.3 3 3l.5-.6c.2-.3.5-.4.8-.2l1.8.9c.4.2.5.4.3.9-.4 1-1.1 1.4-2.1 1.2-3.3-.6-6.2-3.4-6.8-6.5-.2-.9.3-1.8 1.5-2.1Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function FoundersShell({ children }: { children: ReactNode }) {
  return (
    <FoundersMotion className={styles.root}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/"
          aria-label="Keepr One — página inicial"
        >
          <Logo size={30} />
        </Link>
        <span className={styles.program}>Programa Founders</span>
        <Link className={styles.siteLink} href="/">
          Conheça a Keepr One <ArrowIcon />
        </Link>
      </header>
      {children}
      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Keepr One</p>
        <span>Feito para o seu próximo capítulo.</span>
        <Link href="/privacy">Política de privacidade</Link>
      </footer>
    </FoundersMotion>
  );
}

/** Brand geometry: orbiting connections converge on the Keepr mark. */
export function FounderSignal({ large = false }: { large?: boolean }) {
  return (
    <div
      className={`${styles.signal} ${large ? styles.signalLarge : ""}`}
      data-founders-signal
      aria-hidden="true"
    >
      <svg className={styles.signalLines} viewBox="0 0 480 480" fill="none">
        <circle cx="240" cy="240" r="194" />
        <circle cx="240" cy="240" r="148" strokeDasharray="2 7" />
        <circle cx="240" cy="240" r="97" />
        <path d="M46 240h97m194 0h97M240 46v97m0 194v97M103 103l68 68m138 138 68 68M103 377l68-68m138-138 68-68" />
        <ellipse
          cx="240"
          cy="240"
          rx="194"
          ry="73"
          transform="rotate(-35 240 240)"
        />
        <g className={styles.signalTrace}>
          <path d="M240 46a194 194 0 0 1 194 194" />
          <path d="M240 434A194 194 0 0 1 46 240" />
          <circle cx="240" cy="46" r="4" />
          <circle cx="240" cy="434" r="4" />
        </g>
        <circle className={styles.signalNode} cx="119" cy="326" r="5" />
        <circle className={styles.signalNode} cx="361" cy="154" r="5" />
      </svg>
      <div className={styles.signalCore}>
        <LogoMark size={large ? 84 : 46} />
      </div>
    </div>
  );
}
