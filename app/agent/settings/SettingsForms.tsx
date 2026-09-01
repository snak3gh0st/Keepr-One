"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import {
  changePasswordAction,
  requestEmailChangeAction,
  updateAgencyProfileAction,
  updatePersonalProfileAction,
} from "./actions";
import {
  INITIAL_SETTINGS_ACTION_STATE,
  type SettingsActionState,
} from "./state";
import { KBotCredentialSettings } from "./KBotCredentialSettings";
import type { NationalLifeCredentialSummary } from "@/lib/national-life/credentials/settings-service";

type AccessKind = "INDIVIDUAL" | "AGENCY_MEMBER" | "AGENCY_OWNER";

export type SettingsFormsProps = {
  personal: {
    name: string;
    phone: string;
    timeZone: string;
  };
  professional: {
    npn: string | null;
    rank: string;
    status: string;
  };
  security: {
    email: string;
    emailVerified: boolean;
  };
  agency: {
    kind: AccessKind;
    name: string | null;
    subscriptionStatus: string | null;
    canEditAgency: boolean;
  };
  kbot: {
    enabled: boolean;
    credentialBrokerEnabled: boolean;
    credentialSummary: NationalLifeCredentialSummary;
  };
};

const TIME_ZONE_OPTIONS = [
  { value: "America/New_York", label: "Leste dos EUA — Eastern Time" },
  { value: "America/Chicago", label: "Centro dos EUA — Central Time" },
  { value: "America/Denver", label: "Montanhas — Mountain Time" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Oeste dos EUA — Pacific Time" },
  { value: "America/Anchorage", label: "Alasca" },
  { value: "Pacific/Honolulu", label: "Havaí" },
] as const;

const SECTION_CLASS =
  "scroll-mt-24 border-b border-border-steel py-8 first:pt-0 last:border-b-0 last:pb-0";

function describedBy(id: string, error?: string, hasHint = false) {
  return [hasHint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

function fieldError(state: SettingsActionState, name: string) {
  return state.fieldErrors?.[name];
}

function ActionMessage({
  state,
  id,
}: {
  state: SettingsActionState;
  id: string;
}) {
  if (!state.message) return null;

  return (
    <p
      id={id}
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`text-sm leading-6 ${
        state.status === "error" ? "text-danger" : "text-success"
      }`}
    >
      {state.message}
    </p>
  );
}

function SubmitButton({
  label,
  pendingLabel,
}: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="primary"
      disabled={pending}
      aria-busy={pending}
      className="w-full sm:w-auto"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

function SectionHeading({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="text-xl font-semibold tracking-[-0.025em] text-ink">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{description}</p>
    </div>
  );
}

function PersonalProfileForm({
  personal,
}: {
  personal: SettingsFormsProps["personal"];
}) {
  const [state, action] = useActionState(
    updatePersonalProfileAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const nameError = fieldError(state, "name");
  const phoneError = fieldError(state, "phone");
  const timeZoneError = fieldError(state, "timeZone");
  const hasKnownTimeZone = TIME_ZONE_OPTIONS.some(
    ({ value }) => value === personal.timeZone,
  );

  return (
    <section id="perfil" aria-labelledby="settings-profile-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-profile-title"
        title="Perfil"
        description="Atualize como seu nome aparece na plataforma e os dados usados para contato e agenda."
      />

      <form action={action} className="mt-6 max-w-3xl" aria-describedby={state.message ? "settings-profile-message" : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Nome completo"
              htmlFor="settings-name"
              error={nameError}
              required
            >
              <Input
                id="settings-name"
                name="name"
                type="text"
                autoComplete="name"
                maxLength={100}
                defaultValue={personal.name}
                required
                aria-invalid={Boolean(nameError)}
                aria-describedby={describedBy("settings-name", nameError)}
              />
            </Field>
          </div>

          <Field
            label="Telefone (opcional)"
            htmlFor="settings-phone"
            hint="Use um número em que sua operação possa falar com você."
            error={phoneError}
          >
            <Input
              id="settings-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              maxLength={32}
              defaultValue={personal.phone}
              aria-invalid={Boolean(phoneError)}
              aria-describedby={describedBy("settings-phone", phoneError, true)}
            />
          </Field>

          <Field
            label="Fuso horário"
            htmlFor="settings-time-zone"
            hint="Agenda e lembretes usam este horário."
            error={timeZoneError}
            required
          >
            <Select
              id="settings-time-zone"
              name="timeZone"
              defaultValue={personal.timeZone}
              required
              className="w-full"
              aria-invalid={Boolean(timeZoneError)}
              aria-describedby={describedBy("settings-time-zone", timeZoneError, true)}
            >
              {!hasKnownTimeZone ? (
                <option value={personal.timeZone}>{personal.timeZone}</option>
              ) : null}
              {TIME_ZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
          <ActionMessage state={state} id="settings-profile-message" />
          <SubmitButton label="Salvar perfil" pendingLabel="Salvando perfil…" />
        </div>
      </form>
    </section>
  );
}

function humanizeRank(rank: string) {
  const labels: Record<string, string> = {
    AGENT: "Agente",
    AGENCY_OWNER: "Responsável pela agência",
  };
  return labels[rank] ?? rank.replaceAll("_", " ");
}

function humanizeStatus(status: string) {
  return status === "ACTIVE" ? "Conta ativa" : status === "INACTIVE" ? "Conta inativa" : status;
}

function ProfessionalProfile({
  professional,
}: {
  professional: SettingsFormsProps["professional"];
}) {
  return (
    <section id="profissional" aria-labelledby="settings-professional-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-professional-title"
        title="Dados profissionais"
        description="Estes dados identificam sua produção e são mantidos pela operação da Keepr One."
      />

      <dl className="mt-6 grid gap-x-6 sm:grid-cols-3">
        <div className="border-b border-border-steel py-4 sm:border-b-0">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">NPN</dt>
          <dd className="mt-2 font-mono text-sm font-semibold text-ink">{professional.npn || "Não informado"}</dd>
        </div>
        <div className="border-b border-border-steel py-4 sm:border-b-0">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Perfil profissional</dt>
          <dd className="mt-2 text-sm font-semibold text-ink">{humanizeRank(professional.rank)}</dd>
        </div>
        <div className="py-4">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Situação</dt>
          <dd className="mt-2 inline-flex rounded-full bg-success-pale px-2.5 py-1 text-xs font-semibold text-success">
            {humanizeStatus(professional.status)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 max-w-2xl rounded-xl bg-panel px-4 py-3 text-xs leading-5 text-ink-muted">
        Para corrigir o NPN ou o perfil profissional, fale com o suporte Keepr One. Isso evita divergências com dados da National Life e importações da operação.
      </p>
    </section>
  );
}

function EmailChangeForm({
  security,
}: {
  security: SettingsFormsProps["security"];
}) {
  const [state, action] = useActionState(
    requestEmailChangeAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const emailError = fieldError(state, "newEmail");
  const passwordError = fieldError(state, "currentPassword");

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">E-mail de acesso</h3>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Seu e-mail atual é <strong className="font-semibold text-ink">{security.email}</strong>.
          </p>
        </div>
        <span
          className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
            security.emailVerified
              ? "bg-success-pale text-success"
              : "bg-gold-pale text-gold-ink"
          }`}
        >
          {security.emailVerified ? "E-mail verificado" : "Verificação pendente"}
        </span>
      </div>

      <form action={action} className="mt-5 max-w-3xl" aria-describedby={state.message ? "settings-email-message" : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Novo e-mail"
            htmlFor="settings-new-email"
            hint="O e-mail atual continua válido até a confirmação do novo endereço."
            error={emailError}
            required
          >
            <Input
              id="settings-new-email"
              name="newEmail"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              required
              placeholder="novo@email.com"
              aria-invalid={Boolean(emailError)}
              aria-describedby={describedBy("settings-new-email", emailError, true)}
            />
          </Field>

          <Field
            label="Senha atual para trocar o e-mail"
            htmlFor="settings-email-password"
            error={passwordError}
            required
          >
            <div className="relative">
              <Input
                id="settings-email-password"
                name="currentPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                maxLength={128}
                required
                className="w-full pr-24"
                aria-invalid={Boolean(passwordError)}
                aria-describedby={describedBy("settings-email-password", passwordError)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Ocultar senha da troca de e-mail" : "Mostrar senha da troca de e-mail"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 min-w-20 rounded-r-xl px-3 text-xs font-semibold text-ink-muted hover:text-ink"
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ActionMessage state={state} id="settings-email-message" />
          <SubmitButton label="Alterar e-mail" pendingLabel="Solicitando alteração…" />
        </div>
      </form>
    </div>
  );
}

function PasswordChangeForm() {
  const [state, action] = useActionState(
    changePasswordAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const [showPasswords, setShowPasswords] = useState(false);
  const currentPasswordError = fieldError(state, "currentPassword");
  const newPasswordError = fieldError(state, "newPassword");
  const confirmPasswordError = fieldError(state, "confirmPassword");

  return (
    <div className="mt-8 border-t border-border-steel pt-8">
      <h3 className="text-base font-semibold text-ink">Senha</h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">
        Confirme sua senha atual e crie uma nova com pelo menos 8 caracteres.
      </p>

      <form action={action} className="mt-5 max-w-3xl" aria-describedby={state.message ? "settings-password-message" : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Senha atual"
              htmlFor="settings-current-password"
              error={currentPasswordError}
              required
            >
              <Input
                id="settings-current-password"
                name="currentPassword"
                type={showPasswords ? "text" : "password"}
                autoComplete="current-password"
                maxLength={128}
                required
                className="w-full"
                aria-invalid={Boolean(currentPasswordError)}
                aria-describedby={describedBy("settings-current-password", currentPasswordError)}
              />
            </Field>
          </div>

          <Field
            label="Nova senha"
            htmlFor="settings-new-password"
            hint="Use pelo menos 8 caracteres."
            error={newPasswordError}
            required
          >
            <Input
              id="settings-new-password"
              name="newPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              aria-invalid={Boolean(newPasswordError)}
              aria-describedby={describedBy("settings-new-password", newPasswordError, true)}
            />
          </Field>

          <Field
            label="Confirme a nova senha"
            htmlFor="settings-confirm-password"
            error={confirmPasswordError}
            required
          >
            <Input
              id="settings-confirm-password"
              name="confirmPassword"
              type={showPasswords ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              aria-invalid={Boolean(confirmPasswordError)}
              aria-describedby={describedBy("settings-confirm-password", confirmPasswordError)}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setShowPasswords((current) => !current)}
            aria-pressed={showPasswords}
            className="min-h-11 w-fit rounded-full border border-border-steel bg-paper px-4 text-xs font-semibold text-ink-muted hover:border-ink-muted hover:text-ink"
          >
            {showPasswords ? "Ocultar senhas" : "Mostrar senhas"}
          </button>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              name="revokeOtherSessions"
              value="true"
              defaultChecked
              className="h-4 w-4 accent-teal"
            />
            Encerrar minhas outras sessões
          </label>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
          <ActionMessage state={state} id="settings-password-message" />
          <SubmitButton label="Alterar senha" pendingLabel="Alterando senha…" />
        </div>
      </form>
    </div>
  );
}

function SecuritySettings({
  security,
}: {
  security: SettingsFormsProps["security"];
}) {
  return (
    <section id="seguranca" aria-labelledby="settings-security-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-security-title"
        title="Segurança"
        description="Mantenha seu acesso atualizado. Alterações de e-mail e senha sempre exigem sua senha atual."
      />

      <div className="mt-6">
        <EmailChangeForm security={security} />
        <PasswordChangeForm />
      </div>
    </section>
  );
}

function KBotSettings({
  kbot,
}: {
  kbot: SettingsFormsProps["kbot"];
}) {
  return (
    <section id="kbot" aria-labelledby="settings-kbot-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-kbot-title"
        title="K-Bot e National Life"
        description="Controle a conexão do K-Bot neste computador e revise como a autenticação da seguradora funciona."
      />
      <div className="mt-6">
        <KBotCredentialSettings
          connectorEnabled={kbot.enabled}
          credentialBrokerEnabled={kbot.credentialBrokerEnabled}
          summary={kbot.credentialSummary}
        />
      </div>
    </section>
  );
}

function subscriptionLabel(status: string | null) {
  const labels: Record<string, string> = {
    TRIALING: "Período de teste",
    ACTIVE: "Assinatura ativa",
    PAST_DUE: "Pagamento pendente",
    CANCELED: "Assinatura cancelada",
    EXPIRED: "Assinatura expirada",
  };
  return status ? labels[status] ?? status : "Sem assinatura ativa";
}

function AgencySettings({
  agency,
}: {
  agency: SettingsFormsProps["agency"];
}) {
  const [state, action] = useActionState(
    updateAgencyProfileAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const agencyNameError = fieldError(state, "agencyName");

  return (
    <section id="agencia" aria-labelledby="settings-agency-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-agency-title"
        title="Agência"
        description={
          agency.kind === "AGENCY_OWNER" && agency.canEditAgency
            ? "Edite a identificação da sua própria agência. Plano, vínculo e hierarquia permanecem protegidos."
            : agency.kind === "AGENCY_OWNER"
              ? "Sua agência permanece vinculada à conta enquanto os controles de gestão estão temporariamente limitados."
              : "Consulte seu vínculo comercial e acesse os detalhes do plano."
        }
      />

      {agency.kind === "AGENCY_OWNER" && agency.canEditAgency ? (
        <form action={action} className="mt-6 max-w-3xl" aria-describedby={state.message ? "settings-agency-message" : undefined}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Field
              label="Nome da agência"
              htmlFor="settings-agency-name"
              error={agencyNameError}
              required
            >
              <Input
                id="settings-agency-name"
                name="agencyName"
                type="text"
                autoComplete="organization"
                maxLength={120}
                defaultValue={agency.name ?? ""}
                required
                aria-invalid={Boolean(agencyNameError)}
                aria-describedby={describedBy("settings-agency-name", agencyNameError)}
              />
            </Field>
            <div className="rounded-xl bg-panel px-4 py-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Plano</p>
              <p className="mt-2 text-sm font-semibold text-ink">{subscriptionLabel(agency.subscriptionStatus)}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
            <ActionMessage state={state} id="settings-agency-message" />
            <SubmitButton label="Salvar agência" pendingLabel="Salvando agência…" />
          </div>
        </form>
      ) : agency.kind === "AGENCY_OWNER" ? (
        <div className="mt-6 flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Agência vinculada</p>
            <p className="mt-2 text-sm font-semibold text-ink">{agency.name ?? "Agência não identificada"}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              Regularize o Plano Agência para voltar a editar os dados e gerenciar a equipe.
            </p>
          </div>
          <Link href="/agent/agency" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted">
            Regularizar plano
          </Link>
        </div>
      ) : agency.kind === "AGENCY_MEMBER" ? (
        <div className="mt-6 flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Agência vinculada</p>
            <p className="mt-2 text-sm font-semibold text-ink">{agency.name ?? "Agência não identificada"}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">Seu vínculo é administrado pelo responsável da agência.</p>
          </div>
          <Link href="/agent/agency" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted">
            Ver plano e vínculo
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">Operação individual</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">Nenhuma agência está vinculada à sua conta.</p>
          </div>
          <Link href="/agent/agency" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted">
            Ver meu plano
          </Link>
        </div>
      )}
    </section>
  );
}

const SETTINGS_SECTIONS = [
  { href: "#perfil", label: "Perfil" },
  { href: "#profissional", label: "Dados profissionais" },
  { href: "#seguranca", label: "Segurança" },
  { href: "#kbot", label: "K-Bot e National Life" },
  { href: "#agencia", label: "Agência" },
] as const;

export function SettingsForms({
  personal,
  professional,
  security,
  agency,
  kbot,
}: SettingsFormsProps) {
  return (
    <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label="Seções das configurações"
        className="self-start rounded-2xl border border-border-steel bg-paper/90 p-2 lg:sticky lg:top-24"
      >
        <p className="px-3 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Nesta página
        </p>
        <ul className="grid grid-cols-2 gap-1 lg:grid-cols-1">
          {SETTINGS_SECTIONS.map((section) => (
            <li key={section.href}>
              <a
                href={section.href}
                className="flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-panel hover:text-ink focus-visible:bg-panel"
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="module-main-surface">
        <PersonalProfileForm personal={personal} />
        <ProfessionalProfile professional={professional} />
        <SecuritySettings security={security} />
        <KBotSettings kbot={kbot} />
        <AgencySettings agency={agency} />
      </div>
    </div>
  );
}
