"use client";

import { useEffect } from "react";
import styles from "@/app/founders/founders.module.css";

export function FounderWhatsappRedirect({ url }: { url: string }) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.location.assign(url);
    }, 30_000);

    return () => window.clearTimeout(timeout);
  }, [url]);

  return (
    <p id="whatsapp-redirect" className={styles.whatsappNote}>
      Você será redirecionado automaticamente para o grupo em 30 segundos.
    </p>
  );
}
