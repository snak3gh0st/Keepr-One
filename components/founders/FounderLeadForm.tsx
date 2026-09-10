"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerFounderLeadAction } from "@/app/founders/lead-actions";
import { ArrowIcon } from "./FoundersShell";
import styles from "@/app/founders/founders.module.css";

type FieldName = "name" | "email" | "phone";
type FieldErrors = Partial<Record<FieldName, string[]>>;
const fieldOrder: FieldName[] = ["name", "email", "phone"];

function formatPhone(value: string) {
  // Preserve foreign prefixes/letters so server validation can explain them.
  if (
    !/^\+?[\d()\s.-]+$/.test(value.trim()) ||
    (value.trim().startsWith("+") && !value.trim().startsWith("+1"))
  )
    return value;
  const digits = value.replace(/\D/g, "");
  const local =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function FounderLeadForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [phone, setPhone] = useState("");

  function clearError(field: FieldName) {
    setErrors((current) => ({ ...current, [field]: undefined }));
    setMessage(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    const data = new FormData(event.currentTarget);
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await registerFounderLeadAction(data);
        if (result.ok) {
          router.push("/founders/obrigado");
          return;
        }
        setErrors(result.fieldErrors ?? {});
        setMessage(result.message ?? null);
        const firstInvalid = fieldOrder.find(
          (field) => result.fieldErrors?.[field]?.length,
        );
        requestAnimationFrame(() => {
          if (firstInvalid)
            formRef.current
              ?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)
              ?.focus();
          else
            formRef.current
              ?.querySelector<HTMLParagraphElement>("[role='alert']")
              ?.focus();
        });
      } catch {
        setMessage(
          "Não foi possível enviar agora. Confira sua conexão e tente novamente.",
        );
      } finally {
        submittingRef.current = false;
      }
    });
  }

  return (
    <div className={styles.formPanel} data-founders-panel>
      <div className={styles.formHeading}>
        <h2>Seja um Founder.</h2>
        <p>Deixe seu contato. Avisaremos quando for a hora de entrar.</p>
      </div>
      <form
        ref={formRef}
        className={styles.form}
        method="post"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={pending}
      >
        <noscript>
          <p className={styles.formError}>
            Ative o JavaScript no navegador para enviar seu cadastro.
          </p>
        </noscript>
        <div className={styles.field}>
          <label htmlFor="founder-name">Nome completo</label>
          <input
            id="founder-name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Como podemos chamar você?"
            required
            minLength={2}
            maxLength={100}
            disabled={pending}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "founder-name-error" : undefined}
            onChange={() => clearError("name")}
          />
          {errors.name && (
            <p id="founder-name-error" className={styles.fieldError}>
              {errors.name[0]}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="founder-email">E-mail</label>
          <input
            id="founder-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="voce@exemplo.com"
            required
            maxLength={254}
            disabled={pending}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "founder-email-error" : undefined}
            onChange={() => clearError("email")}
          />
          {errors.email && (
            <p id="founder-email-error" className={styles.fieldError}>
              {errors.email[0]}
            </p>
          )}
        </div>
        <div className={styles.field}>
          <label htmlFor="founder-phone">
            Telefone <span>Estados Unidos</span>
          </label>
          <div
            className={styles.phoneControl}
            data-invalid={Boolean(errors.phone)}
          >
            <span className={styles.phonePrefix} aria-hidden="true">
              <svg viewBox="0 0 24 16" fill="none">
                <path fill="#d4dfd8" d="M0 0h24v16H0z" />
                <path
                  stroke="#a34f58"
                  strokeWidth="1.2"
                  d="M0 1h24M0 3.4h24M0 5.8h24M0 8.2h24M0 10.6h24M0 13h24M0 15.4h24"
                />
                <path fill="#435775" d="M0 0h10v9H0z" />
                <path
                  stroke="#e1e9e3"
                  strokeWidth="1"
                  strokeDasharray="1 2"
                  d="M1.5 2h7M1.5 4.5h7M1.5 7h7"
                />
              </svg>
              +1
            </span>
            <input
              id="founder-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              aria-label="Telefone dos Estados Unidos, código +1"
              placeholder="(201) 555-0123"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                clearError("phone");
              }}
              onBlur={() => setPhone(formatPhone(phone))}
              required
              maxLength={40}
              disabled={pending}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={
                errors.phone ? "founder-phone-error" : undefined
              }
            />
          </div>
          {errors.phone && (
            <p id="founder-phone-error" className={styles.fieldError}>
              {errors.phone[0]}
            </p>
          )}
        </div>
        <div className={styles.honeypot} aria-hidden="true">
          <label htmlFor="founder-website">Website</label>
          <input
            id="founder-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        {message && (
          <p className={styles.formError} role="alert" tabIndex={-1}>
            {message}
          </p>
        )}
        <button
          className={styles.primaryButton}
          type="submit"
          disabled={pending}
        >
          <span>{pending ? "ENVIANDO CADASTRO…" : "QUERO SER FOUNDER"}</span>
          {pending ? (
            <span className={styles.spinner} aria-hidden="true" />
          ) : (
            <ArrowIcon />
          )}
        </button>
        <p className={styles.privacy}>
          Ao se cadastrar, você concorda em receber novidades sobre o Programa
          Founders. Seus dados são tratados conforme nossa{" "}
          <Link href="/privacy">Política de Privacidade</Link>.
        </p>
        <div className={styles.formStatus}>
          <span aria-hidden="true" />
          Seu primeiro passo para fazer parte.
        </div>
      </form>
    </div>
  );
}
