"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { registerFounderAction } from "@/app/founders/actions";
import { authClient } from "@/lib/auth-client";

type AccountType = "AGENT" | "AGENCY";
type FieldErrors = Record<string, string[]>;

type SuccessState = {
  email: string;
  loginHref: string;
  message: string;
  trialEndsAt?: string;
};

const fieldOrder = [
  "accountType",
  "accessCode",
  "name",
  "agencyName",
  "email",
  "phone",
  "npn",
  "password",
  "confirmPassword",
  "acceptedTerms",
] as const;

function firstError(errors: FieldErrors, name: string) {
  return errors[name]?.[0];
}

function describedBy(name: string, error?: string, hasHint = false) {
  return [hasHint ? `${name}-hint` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

function FieldFeedback({
  name,
  error,
  hint,
}: {
  name: string;
  error?: string;
  hint?: string;
}) {
  if (error) {
    return (
      <p className="founders-field-error" id={`${name}-error`} role="alert">
        {error}
      </p>
    );
  }

  if (hint) {
    return (
      <p className="founders-field-hint" id={`${name}-hint`}>
        {hint}
      </p>
    );
  }

  return null;
}

function formatTrialEnd(value?: string) {
  if (!value) return "30 dias após a criação da conta";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "30 dias após a criação da conta";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function trustedLoginUrl(value: string | undefined, email: string) {
  const fallback = new URL("/login", window.location.origin);

  try {
    const target = new URL(value || fallback.toString(), window.location.origin);
    const hostname = target.hostname.toLowerCase();
    const trustedHost =
      target.origin === window.location.origin ||
      hostname === "keeprone.com" ||
      hostname.endsWith(".keeprone.com") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";

    if (!trustedHost || !["http:", "https:"].includes(target.protocol)) {
      fallback.searchParams.set("email", email);
      fallback.searchParams.set("founder", "created");
      return fallback;
    }

    if (target.origin !== window.location.origin || target.pathname.includes("login")) {
      target.searchParams.set("email", email);
      target.searchParams.set("founder", "created");
    }

    return target;
  } catch {
    fallback.searchParams.set("email", email);
    fallback.searchParams.set("founder", "created");
    return fallback;
  }
}

export function FounderRegistrationForm({
  registrationOpen,
}: {
  registrationOpen: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [accountType, setAccountType] = useState<AccountType>("AGENT");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function clearFieldError(name: string) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    if (formError) setFormError(null);
  }

  function focusFirstInvalid(errors: FieldErrors) {
    const firstInvalid = fieldOrder.find((name) => errors[name]?.length);
    if (!firstInvalid) return;

    window.requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(
        `[name="${firstInvalid}"]`,
      );
      target?.focus();
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const formData = new FormData(event.currentTarget);
    formData.set("accountType", accountType);
    if (accountType === "AGENT") formData.delete("agencyName");

    const submittedEmail = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();
    const submittedPassword = String(formData.get("password") ?? "");

    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const result = await registerFounderAction(formData);

      if (!result.ok) {
        const nextErrors = result.fieldErrors ?? {};
        setFieldErrors(nextErrors);
        setFormError(
          result.message ?? "Revise os campos destacados e tente novamente.",
        );
        focusFirstInvalid(nextErrors);
        return;
      }

      const founderEmail = result.email ?? submittedEmail;
      const loginTarget = trustedLoginUrl(result.loginUrl, founderEmail);
      const successMessage =
        result.message ?? "Seu acesso Founder foi criado com sucesso.";

      setSuccess({
        email: founderEmail,
        loginHref: loginTarget.toString(),
        message: successMessage,
        trialEndsAt: result.trialEndsAt,
      });

      // Cookies de sessão não atravessam hosts automaticamente. Quando o
      // acesso final vive em app.keeprone.com, encaminhamos a pessoa para o
      // login daquele host com o e-mail já identificado.
      if (loginTarget.origin !== window.location.origin) {
        window.location.assign(loginTarget.toString());
        return;
      }

      const { error: signInError } = await authClient.signIn.email({
        email: founderEmail,
        password: submittedPassword,
      });

      if (signInError) {
        setSuccess({
          email: founderEmail,
          loginHref: loginTarget.toString(),
          message:
            "Seu acesso foi criado. Entre com o e-mail e a senha cadastrados para começar.",
          trialEndsAt: result.trialEndsAt,
        });
        return;
      }

      const destination = loginTarget.pathname.includes("login")
        ? new URL("/agent", window.location.origin).toString()
        : loginTarget.toString();
      window.location.assign(destination);
    } catch {
      setFormError(
        "Não foi possível criar seu acesso agora. Tente novamente em alguns instantes.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!registrationOpen) {
    return (
      <section
        className="founders-form-panel founders-paused"
        aria-labelledby="founders-paused-title"
      >
        <div className="founders-paused-mark" aria-hidden="true">
          K1
        </div>
        <p className="founders-form-eyebrow">Programa Founders</p>
        <h2 id="founders-paused-title">Inscrições pausadas.</h2>
        <p>
          O cadastro está temporariamente indisponível. Se você recebeu um
          convite, aguarde a confirmação da equipe Keepr One antes de tentar
          novamente.
        </p>
        <Link className="founders-secondary-link" href="/">
          Voltar para a página inicial
          <span aria-hidden="true">↗</span>
        </Link>
      </section>
    );
  }

  if (success) {
    return (
      <section className="founders-form-panel founders-success" aria-live="polite">
        <div className="founders-success-mark" aria-hidden="true">
          ✓
        </div>
        <p className="founders-form-eyebrow">Acesso Founder criado</p>
        <h2>Seu período gratuito está pronto.</h2>
        <p className="founders-success-message">{success.message}</p>

        <dl className="founders-success-details">
          <div>
            <dt>Conta</dt>
            <dd>{success.email}</dd>
          </div>
          <div>
            <dt>Acesso gratuito até</dt>
            <dd>{formatTrialEnd(success.trialEndsAt)}</dd>
          </div>
        </dl>

        <a className="founders-submit founders-success-link" href={success.loginHref}>
          <span>Entrar na plataforma</span>
          <i aria-hidden="true">↗</i>
        </a>

        <p className="founders-submit-note">
          No 31º dia, uma assinatura será necessária para manter o acesso.
        </p>
      </section>
    );
  }

  const accountTypeError = firstError(fieldErrors, "accountType");
  const accessCodeError = firstError(fieldErrors, "accessCode");
  const nameError = firstError(fieldErrors, "name");
  const agencyNameError = firstError(fieldErrors, "agencyName");
  const emailError = firstError(fieldErrors, "email");
  const phoneError = firstError(fieldErrors, "phone");
  const npnError = firstError(fieldErrors, "npn");
  const passwordError = firstError(fieldErrors, "password");
  const confirmPasswordError = firstError(fieldErrors, "confirmPassword");
  const acceptedTermsError = firstError(fieldErrors, "acceptedTerms");

  return (
    <section className="founders-form-panel" aria-labelledby="founders-form-title">
      <div className="founders-form-heading">
        <div>
          <p className="founders-form-eyebrow">Cadastro Founder</p>
          <h2 id="founders-form-title">Crie seu acesso.</h2>
          <p>
            O teste começa assim que a conta for criada. Nenhuma cobrança é
            feita agora.
          </p>
        </div>
        <div className="founders-trial-seal" aria-label="30 dias gratuitos">
          <strong>30</strong>
          <span>dias</span>
        </div>
      </div>

      <form
        ref={formRef}
        className="founders-form"
        onSubmit={handleSubmit}
        aria-busy={submitting}
        aria-describedby={formError ? "founders-form-error" : undefined}
      >
        <fieldset className="founders-profile-fieldset">
          <legend>Como você vai usar a Keepr One?</legend>
          <div
            className="founders-profile-options"
            aria-describedby={describedBy(
              "accountType",
              accountTypeError,
              true,
            )}
          >
            <label>
              <input
                type="radio"
                name="accountType"
                value="AGENT"
                checked={accountType === "AGENT"}
                onChange={() => {
                  setAccountType("AGENT");
                  clearFieldError("accountType");
                  clearFieldError("agencyName");
                }}
                required
              />
              <span className="founders-profile-dot" aria-hidden="true" />
              <span>
                <strong>Sou agente</strong>
                <small>Minha carteira e operação individual</small>
              </span>
            </label>

            <label>
              <input
                type="radio"
                name="accountType"
                value="AGENCY"
                checked={accountType === "AGENCY"}
                onChange={() => {
                  setAccountType("AGENCY");
                  clearFieldError("accountType");
                }}
                required
              />
              <span className="founders-profile-dot" aria-hidden="true" />
              <span>
                <strong>Represento uma agência</strong>
                <small>Equipe, produção e gestão da agência</small>
              </span>
            </label>
          </div>
          <p className="founders-profile-hint" id="accountType-hint">
            Você receberá todas as funções disponíveis para o perfil escolhido.
          </p>
          <FieldFeedback name="accountType" error={accountTypeError} />
        </fieldset>

        <div className="founders-fields-grid">
          <div className="founders-field founders-field-wide founders-access-code">
            <label htmlFor="founder-access-code">Código Founder</label>
            <input
              id="founder-access-code"
              name="accessCode"
              type="text"
              autoComplete="off"
              maxLength={120}
              required
              aria-invalid={Boolean(accessCodeError)}
              aria-describedby={describedBy(
                "accessCode",
                accessCodeError,
                true,
              )}
              onChange={() => clearFieldError("accessCode")}
              placeholder="Digite o código recebido"
            />
            <FieldFeedback
              name="accessCode"
              error={accessCodeError}
              hint="O código de acesso vem no convite enviado pela Keepr One."
            />
          </div>

          <div className="founders-field founders-field-wide">
            <label htmlFor="founder-name">Nome completo</label>
            <input
              id="founder-name"
              name="name"
              type="text"
              autoComplete="name"
              maxLength={120}
              required
              aria-invalid={Boolean(nameError)}
              aria-describedby={describedBy("name", nameError)}
              onChange={() => clearFieldError("name")}
              placeholder="Como devemos chamar você?"
            />
            <FieldFeedback name="name" error={nameError} />
          </div>

          {accountType === "AGENCY" ? (
            <div className="founders-field founders-field-wide">
              <label htmlFor="founder-agency-name">Nome da agência</label>
              <input
                id="founder-agency-name"
                name="agencyName"
                type="text"
                autoComplete="organization"
                maxLength={120}
                required
                aria-invalid={Boolean(agencyNameError)}
                aria-describedby={describedBy("agencyName", agencyNameError)}
                onChange={() => clearFieldError("agencyName")}
                placeholder="Nome que sua equipe reconhece"
              />
              <FieldFeedback name="agencyName" error={agencyNameError} />
            </div>
          ) : null}

          <div className="founders-field">
            <label htmlFor="founder-email">E-mail</label>
            <input
              id="founder-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              aria-invalid={Boolean(emailError)}
              aria-describedby={describedBy("email", emailError)}
              onChange={() => clearFieldError("email")}
              placeholder="voce@email.com"
            />
            <FieldFeedback name="email" error={emailError} />
          </div>

          <div className="founders-field">
            <label htmlFor="founder-phone">Telefone</label>
            <input
              id="founder-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={32}
              required
              aria-invalid={Boolean(phoneError)}
              aria-describedby={describedBy("phone", phoneError)}
              onChange={() => clearFieldError("phone")}
              placeholder="(000) 000-0000"
            />
            <FieldFeedback name="phone" error={phoneError} />
          </div>

          <div className="founders-field founders-field-wide">
            <label htmlFor="founder-npn">
              NPN <span>opcional</span>
            </label>
            <input
              id="founder-npn"
              name="npn"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={20}
              aria-invalid={Boolean(npnError)}
              aria-describedby={describedBy("npn", npnError, true)}
              onChange={() => clearFieldError("npn")}
              placeholder="Seu número de produtor"
            />
            <FieldFeedback
              name="npn"
              error={npnError}
              hint="Você poderá completar essa informação depois."
            />
          </div>

          <div className="founders-field">
            <label htmlFor="founder-password">Crie uma senha</label>
            <div className="founders-password-control">
              <input
                id="founder-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                aria-invalid={Boolean(passwordError)}
                aria-describedby={describedBy("password", passwordError, true)}
                onChange={() => clearFieldError("password")}
                placeholder="Mínimo de 8 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senhas" : "Mostrar senhas"}
                aria-pressed={showPassword}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            <FieldFeedback
              name="password"
              error={passwordError}
              hint="Use pelo menos 8 caracteres."
            />
          </div>

          <div className="founders-field">
            <label htmlFor="founder-confirm-password">Confirme a senha</label>
            <input
              id="founder-confirm-password"
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              aria-invalid={Boolean(confirmPasswordError)}
              aria-describedby={describedBy(
                "confirmPassword",
                confirmPasswordError,
              )}
              onChange={() => clearFieldError("confirmPassword")}
              placeholder="Repita a senha"
            />
            <FieldFeedback name="confirmPassword" error={confirmPasswordError} />
          </div>
        </div>

        <div className="founders-honeypot" aria-hidden="true">
          <label htmlFor="founder-website">Website</label>
          <input
            id="founder-website"
            name="website"
            type="text"
            autoComplete="off"
            tabIndex={-1}
          />
        </div>

        <div className="founders-terms-field">
          <label>
            <input
              name="acceptedTerms"
              type="checkbox"
              value="on"
              required
              aria-invalid={Boolean(acceptedTermsError)}
              aria-describedby={describedBy(
                "acceptedTerms",
                acceptedTermsError,
                true,
              )}
              onChange={() => clearFieldError("acceptedTerms")}
            />
            <span aria-hidden="true">✓</span>
            <p>
              Confirmo que participo do Programa Founders e aceito o uso dos
              meus dados conforme a <a href="/privacy">Política de Privacidade</a>.
            </p>
          </label>
          <p className="founders-field-hint" id="acceptedTerms-hint">
            Seu teste dura 30 dias. Depois disso, o acesso dependerá de uma
            assinatura ativa.
          </p>
          <FieldFeedback name="acceptedTerms" error={acceptedTermsError} />
        </div>

        {formError ? (
          <p className="founders-form-error" id="founders-form-error" role="alert">
            <span aria-hidden="true">!</span>
            {formError}
          </p>
        ) : null}

        <button className="founders-submit" type="submit" disabled={submitting}>
          <span>{submitting ? "Criando seu acesso…" : "Começar meus 30 dias"}</span>
          <i aria-hidden="true">{submitting ? "·" : "↗"}</i>
        </button>

        <p className="founders-submit-note">
          Sem cobrança agora. No 31º dia, será necessário escolher e pagar um
          plano para continuar.
        </p>
      </form>
    </section>
  );
}
