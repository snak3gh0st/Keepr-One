"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { KBotAvatar } from "@/components/kbot/KBotAvatar";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { UserLanguage } from "@/lib/i18n/config";
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
  { value: "America/New_York", pt: "Leste dos EUA — Eastern Time", en: "US East — Eastern Time" },
  { value: "America/Chicago", pt: "Centro dos EUA — Central Time", en: "US Central — Central Time" },
  { value: "America/Denver", pt: "Montanhas — Mountain Time", en: "Mountain — Mountain Time" },
  { value: "America/Phoenix", pt: "Arizona", en: "Arizona" },
  { value: "America/Los_Angeles", pt: "Oeste dos EUA — Pacific Time", en: "US West — Pacific Time" },
  { value: "America/Anchorage", pt: "Alasca", en: "Alaska" },
  { value: "Pacific/Honolulu", pt: "Havaí", en: "Hawaii" },
] as const;

const SECTION_CLASS =
  "scroll-mt-28 rounded-3xl border border-border-steel bg-paper p-5 shadow-[0_18px_50px_-38px_rgba(15,29,19,0.35)] sm:p-7";

function describedBy(id: string, error?: string, hasHint = false) {
  return [hasHint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ") || undefined;
}

const SETTINGS_MESSAGE_EN: Record<string, string> = {
  "Revise os campos destacados.": "Review the highlighted fields.",
  "Informe seu nome completo.": "Enter your full name.",
  "O nome deve ter no máximo 100 caracteres.": "Name must be no more than 100 characters.",
  "O telefone informado é muito longo.": "The phone number is too long.",
  "Informe um telefone válido.": "Enter a valid phone number.",
  "Informe um telefone com 7 a 15 dígitos.": "Enter a phone number with 7 to 15 digits.",
  "Selecione seu fuso horário.": "Select your time zone.",
  "O fuso horário informado é inválido.": "The selected time zone is invalid.",
  "Selecione um fuso horário válido.": "Select a valid time zone.",
  "Não foi possível localizar seu perfil.": "We couldn't find your profile.",
  "Seu perfil já está atualizado.": "Your profile is already up to date.",
  "Dados pessoais atualizados.": "Personal details updated.",
  "Não foi possível atualizar seus dados agora. Tente novamente.": "We couldn't update your details right now. Please try again.",
  "Informe um e-mail válido.": "Enter a valid email.",
  "O e-mail deve ter no máximo 254 caracteres.": "Email must be no more than 254 characters.",
  "Informe sua senha atual.": "Enter your current password.",
  "A senha atual é inválida.": "Your current password is invalid.",
  "Este já é o e-mail da sua conta.": "This is already your account email.",
  "Informe um e-mail diferente do atual.": "Enter an email different from your current one.",
  "Não foi possível confirmar sua identidade.": "We couldn't confirm your identity.",
  "A senha atual está incorreta.": "Your current password is incorrect.",
  "Por segurança, entre novamente antes de trocar seu e-mail.": "For security, sign in again before changing your email.",
  "Não foi possível enviar a confirmação agora. Tente novamente.": "We couldn't send the confirmation right now. Please try again.",
  "A nova senha deve ter pelo menos 8 caracteres.": "The new password must have at least 8 characters.",
  "A nova senha deve ter no máximo 128 caracteres.": "The new password must be no more than 128 characters.",
  "Confirme a nova senha.": "Confirm the new password.",
  "A confirmação da senha é inválida.": "The password confirmation is invalid.",
  "As novas senhas não coincidem.": "The new passwords do not match.",
  "A nova senha precisa ser diferente da senha atual.": "The new password must be different from your current password.",
  "Senha alterada; suas outras sessões foram encerradas.": "Password changed; your other sessions were signed out.",
  "Senha alterada com sucesso.": "Password changed successfully.",
  "Não foi possível alterar a senha.": "We couldn't change the password.",
  "Por segurança, entre novamente antes de alterar sua senha.": "For security, sign in again before changing your password.",
  "Não foi possível alterar sua senha agora. Tente novamente.": "We couldn't change your password right now. Please try again.",
  "Informe o nome da agência.": "Enter the agency name.",
  "O nome da agência deve ter no máximo 120 caracteres.": "Agency name must be no more than 120 characters.",
  "Nenhuma agência editável foi encontrada.": "No editable agency was found.",
  "Não foi possível localizar sua agência.": "We couldn't find your agency.",
  "O nome da agência já está atualizado.": "The agency name is already up to date.",
  "Nome da agência atualizado.": "Agency name updated.",
  "Não foi possível usar este nome de agência.": "This agency name can't be used.",
  "Escolha outro nome para a agência.": "Choose a different agency name.",
  "Somente o responsável por um plano Agência ativo pode alterar este nome.": "Only the owner of an active Agency plan can change this name.",
  "Não foi possível atualizar a agência agora. Tente novamente.": "We couldn't update the agency right now. Please try again.",
};

function settingsMessage(message: string | undefined, language: UserLanguage) {
  if (!message || language === "PT") return message;
  const localEmail = /^E-mail alterado para (.+) neste ambiente local\.$/.exec(message);
  if (localEmail) return `Email changed to ${localEmail[1]} in this local environment.`;
  const twoStepEmail = /^Enviamos uma autorização para (.+)\. Depois dela, confirmaremos (.+)\.$/.exec(message);
  if (twoStepEmail) return `We sent an authorization to ${twoStepEmail[1]}. After approval, we'll confirm ${twoStepEmail[2]}.`;
  const confirmationEmail = /^Enviamos a confirmação para (.+)\. Seu e-mail atual continua válido até a verificação\.$/.exec(message);
  if (confirmationEmail) return `We sent a confirmation to ${confirmationEmail[1]}. Your current email remains valid until verification.`;
  return SETTINGS_MESSAGE_EN[message] ?? message;
}

function fieldError(state: SettingsActionState, name: string, language: UserLanguage) {
  return settingsMessage(state.fieldErrors?.[name], language);
}

function ActionMessage({
  state,
  id,
}: {
  state: SettingsActionState;
  id: string;
}) {
  const { language } = useI18n();
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
      {settingsMessage(state.message, language)}
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

function SettingsOverview({
  personal,
  professional,
  security,
  agency,
  kbot,
}: SettingsFormsProps) {
  const { copy } = useI18n();
  const sections = [
    {
      href: "#perfil",
      index: "01",
      label: copy("Perfil", "Profile"),
      value: personal.name || copy("Seu perfil", "Your profile"),
      detail: professional.npn ? `NPN ${professional.npn}` : copy("Dados pessoais e profissionais", "Personal and professional details"),
    },
    {
      href: "#seguranca",
      index: "02",
      label: copy("Segurança", "Security"),
      value: security.email,
      detail: security.emailVerified ? copy("E-mail verificado", "Email verified") : copy("Verificação pendente", "Verification pending"),
    },
    {
      href: "#profissional",
      index: "03",
      label: copy("Dados profissionais", "Professional details"),
      value: professional.npn ? `NPN ${professional.npn}` : copy("Ainda não informado", "Not provided yet"),
      detail: humanizeStatus(professional.status, copy),
    },
    {
      href: "#kbot",
      index: "04",
      label: "K-Bot",
      value: kbot.enabled ? copy("Conectado ao ambiente", "Connected to the environment") : copy("Indisponível neste ambiente", "Unavailable in this environment"),
      detail: kbot.credentialBrokerEnabled && kbot.credentialSummary.configured
        ? copy("Credencial protegida", "Protected credential")
        : kbot.credentialBrokerEnabled
          ? copy("Pronto para configurar login automático", "Ready to configure automatic login")
          : copy("Login manual protegido", "Manual sign-in protected"),
    },
    {
      href: "#agencia",
      index: "05",
      label: copy("Agência", "Agency"),
      value: agency.name ?? copy("Operação individual", "Individual operation"),
      detail: agency.subscriptionStatus ? subscriptionLabel(agency.subscriptionStatus, copy) : copy("Sem vínculo de agência", "No agency relationship"),
    },
  ] as const;

  return (
    <div className="mt-6 overflow-hidden rounded-[28px] border border-border-steel bg-paper shadow-[0_22px_64px_-44px_rgba(15,29,19,0.5)]">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="p-5 sm:p-7">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-deep">
                {copy("Espaço da conta", "Account workspace")}
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-ink">
                {copy("Ajuste sua operação por área.", "Tune your operation by area.")}
              </h2>
            </div>
            <p className="text-xs text-ink-muted">
              {copy("5 áreas · alterações independentes", "5 areas · independent changes")}
            </p>
          </div>

          <nav
            aria-label={copy("Seções das configurações", "Settings sections")}
            className="mt-6 grid gap-2 sm:grid-cols-2 xl:grid-cols-5"
          >
            {sections.map((section) => (
              <a
                key={section.href}
                href={section.href}
                className="group min-w-0 rounded-2xl border border-border-steel bg-panel/45 p-3.5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-teal/35 hover:bg-teal-pale/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
              >
                <span className="flex items-center justify-between font-mono text-[10px] font-semibold tracking-[0.14em] text-teal-deep/75">
                  {section.index}
                  <span aria-hidden="true" className="text-ink-muted/50 transition-transform group-hover:translate-x-0.5">↗</span>
                </span>
                <span className="mt-4 block truncate text-xs font-semibold text-ink-muted">{section.label}</span>
                <strong className="mt-1 block truncate text-sm font-semibold text-ink">{section.value}</strong>
                <span className="mt-1 block truncate text-[11px] text-ink-muted">{section.detail}</span>
              </a>
            ))}
          </nav>
        </div>

        <aside className="relative overflow-hidden border-t border-border-steel bg-rail-strong p-5 text-paper sm:p-7 lg:border-l lg:border-t-0">
          <span aria-hidden="true" className="absolute -right-12 -top-14 size-36 rounded-full border border-mint/15" />
          <span aria-hidden="true" className="absolute -right-5 -top-7 size-24 rounded-full border border-mint/10" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <KBotAvatar
                state={kbot.credentialBrokerEnabled && !kbot.credentialSummary.configured ? "waiting" : "idle"}
                size="sm"
              />
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-pale/75">K-Bot</p>
                <p className="mt-1 text-sm font-semibold">{copy("Presença operacional", "Operational presence")}</p>
              </div>
            </div>
            <p className="mt-6 text-sm leading-6 text-paper/65">
              {copy("O bot trabalha em segundo plano e só pede sua atenção quando a National Life exigir MFA.", "The bot works in the background and only asks for your attention when National Life requires MFA.")}
            </p>
            <div className="mt-6 border-t border-paper/10 pt-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-paper/45">{copy("Acesso", "Access")}</p>
              <p className="mt-2 text-sm font-semibold text-paper">
                {kbot.credentialBrokerEnabled && kbot.credentialSummary.configured
                  ? copy("Credencial protegida", "Protected credential")
                  : kbot.credentialBrokerEnabled
                    ? copy("Pronto para configurar", "Ready to configure")
                    : copy("Login manual", "Manual sign-in")}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PersonalProfileForm({
  personal,
}: {
  personal: SettingsFormsProps["personal"];
}) {
  const { copy, language } = useI18n();
  const [state, action] = useActionState(
    updatePersonalProfileAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const nameError = fieldError(state, "name", language);
  const phoneError = fieldError(state, "phone", language);
  const timeZoneError = fieldError(state, "timeZone", language);
  const hasKnownTimeZone = TIME_ZONE_OPTIONS.some(
    ({ value }) => value === personal.timeZone,
  );

  return (
    <section id="perfil" aria-labelledby="settings-profile-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-profile-title"
        title={copy("Perfil", "Profile")}
        description={copy("Atualize como seu nome aparece na plataforma e os dados usados para contato e agenda.", "Update how your name appears on the platform and the details used for contact and scheduling.")}
      />

      <form action={action} className="mt-6 max-w-3xl" aria-describedby={state.message ? "settings-profile-message" : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label={copy("Nome completo", "Full name")}
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
            label={copy("Telefone (opcional)", "Phone (optional)")}
            htmlFor="settings-phone"
            hint={copy("Use um número em que sua operação possa falar com você.", "Use a number where your team can reach you.")}
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
            label={copy("Fuso horário", "Time zone")}
            htmlFor="settings-time-zone"
            hint={copy("Agenda e lembretes usam este horário.", "Calendar and reminders use this time zone.")}
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
                  {copy(option.pt, option.en)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
          <ActionMessage state={state} id="settings-profile-message" />
          <SubmitButton label={copy("Salvar perfil", "Save profile")} pendingLabel={copy("Salvando perfil…", "Saving profile…")} />
        </div>
      </form>
    </section>
  );
}

function humanizeRank(rank: string, copy: (pt: string, en: string) => string) {
  const labels: Record<string, string> = {
    AGENT: copy("Agente", "Agent"),
    AGENCY_OWNER: copy("Responsável pela agência", "Agency owner"),
  };
  return labels[rank] ?? rank.replaceAll("_", " ");
}

function humanizeStatus(status: string, copy: (pt: string, en: string) => string) {
  return status === "ACTIVE" ? copy("Conta ativa", "Active account") : status === "INACTIVE" ? copy("Conta inativa", "Inactive account") : status;
}

function ProfessionalProfile({
  professional,
}: {
  professional: SettingsFormsProps["professional"];
}) {
  const { copy } = useI18n();
  return (
    <section id="profissional" aria-labelledby="settings-professional-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-professional-title"
        title={copy("Dados profissionais", "Professional details")}
        description={copy("Estes dados identificam sua produção e são mantidos pela operação da Keepr One.", "These details identify your production and are maintained by Keepr One operations.")}
      />

      <dl className="mt-6 grid gap-x-6 sm:grid-cols-3">
        <div className="border-b border-border-steel py-4 sm:border-b-0">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">NPN</dt>
          <dd className="mt-2 font-mono text-sm font-semibold text-ink">{professional.npn || copy("Não informado", "Not provided")}</dd>
        </div>
        <div className="border-b border-border-steel py-4 sm:border-b-0">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy("Perfil profissional", "Professional profile")}</dt>
          <dd className="mt-2 text-sm font-semibold text-ink">{humanizeRank(professional.rank, copy)}</dd>
        </div>
        <div className="py-4">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy("Situação", "Status")}</dt>
          <dd className="mt-2 inline-flex rounded-full bg-success-pale px-2.5 py-1 text-xs font-semibold text-success">
            {humanizeStatus(professional.status, copy)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 max-w-2xl rounded-xl bg-panel px-4 py-3 text-xs leading-5 text-ink-muted">
        {copy("Para corrigir o NPN ou o perfil profissional, fale com o suporte Keepr One. Isso evita divergências com dados da National Life e importações da operação.", "To correct your NPN or professional profile, contact Keepr One support. This prevents discrepancies with National Life data and operational imports.")}
      </p>
    </section>
  );
}

function EmailChangeForm({
  security,
}: {
  security: SettingsFormsProps["security"];
}) {
  const { copy, language } = useI18n();
  const [state, action] = useActionState(
    requestEmailChangeAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const emailError = fieldError(state, "newEmail", language);
  const passwordError = fieldError(state, "currentPassword", language);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">{copy("E-mail de acesso", "Sign-in email")}</h3>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            {copy("Seu e-mail atual é", "Your current email is")} <strong className="font-semibold text-ink">{security.email}</strong>.
          </p>
        </div>
        <span
          className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${
            security.emailVerified
              ? "bg-success-pale text-success"
              : "bg-gold-pale text-gold-ink"
          }`}
        >
          {security.emailVerified ? copy("E-mail verificado", "Email verified") : copy("Verificação pendente", "Verification pending")}
        </span>
      </div>

      <form action={action} className="mt-5 max-w-3xl" aria-describedby={state.message ? "settings-email-message" : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={copy("Novo e-mail", "New email")}
            htmlFor="settings-new-email"
            hint={copy("O e-mail atual continua válido até a confirmação do novo endereço.", "Your current email remains valid until the new address is confirmed.")}
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
              placeholder={copy("novo@email.com", "new@email.com")}
              aria-invalid={Boolean(emailError)}
              aria-describedby={describedBy("settings-new-email", emailError, true)}
            />
          </Field>

          <Field
            label={copy("Senha atual para trocar o e-mail", "Current password to change email")}
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
                aria-label={showPassword ? copy("Ocultar senha da troca de e-mail", "Hide email-change password") : copy("Mostrar senha da troca de e-mail", "Show email-change password")}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 min-w-20 rounded-r-xl px-3 text-xs font-semibold text-ink-muted hover:text-ink"
              >
                {showPassword ? copy("Ocultar", "Hide") : copy("Mostrar", "Show")}
              </button>
            </div>
          </Field>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ActionMessage state={state} id="settings-email-message" />
          <SubmitButton label={copy("Alterar e-mail", "Change email")} pendingLabel={copy("Solicitando alteração…", "Requesting change…")} />
        </div>
      </form>
    </div>
  );
}

function PasswordChangeForm({ className = "mt-8 border-t border-border-steel pt-8" }: { className?: string }) {
  const { copy, language } = useI18n();
  const [state, action] = useActionState(
    changePasswordAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const [showPasswords, setShowPasswords] = useState(false);
  const currentPasswordError = fieldError(state, "currentPassword", language);
  const newPasswordError = fieldError(state, "newPassword", language);
  const confirmPasswordError = fieldError(state, "confirmPassword", language);

  return (
    <div className={className}>
      <h3 className="text-base font-semibold text-ink">{copy("Senha", "Password")}</h3>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">
        {copy("Confirme sua senha atual e crie uma nova com pelo menos 8 caracteres.", "Confirm your current password and create a new one with at least 8 characters.")}
      </p>

      <form action={action} className="mt-5 max-w-3xl" aria-describedby={state.message ? "settings-password-message" : undefined}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label={copy("Senha atual", "Current password")}
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
            label={copy("Nova senha", "New password")}
            htmlFor="settings-new-password"
            hint={copy("Use pelo menos 8 caracteres.", "Use at least 8 characters.")}
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
            label={copy("Confirme a nova senha", "Confirm new password")}
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
            {showPasswords ? copy("Ocultar senhas", "Hide passwords") : copy("Mostrar senhas", "Show passwords")}
          </button>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              name="revokeOtherSessions"
              value="true"
              defaultChecked
              className="h-4 w-4 accent-teal"
            />
            {copy("Encerrar minhas outras sessões", "Sign out my other sessions")}
          </label>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
          <ActionMessage state={state} id="settings-password-message" />
          <SubmitButton label={copy("Alterar senha", "Change password")} pendingLabel={copy("Alterando senha…", "Changing password…")} />
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
  const { copy } = useI18n();
  return (
    <section id="seguranca" aria-labelledby="settings-security-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-security-title"
        title={copy("Segurança", "Security")}
        description={copy("Mantenha seu acesso atualizado. Alterações de e-mail e senha sempre exigem sua senha atual.", "Keep your access up to date. Email and password changes always require your current password.")}
      />

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-border-steel bg-panel/35 p-5 sm:p-6">
          <EmailChangeForm security={security} />
        </div>
        <div className="rounded-2xl border border-border-steel bg-panel/35 p-5 sm:p-6">
          <PasswordChangeForm className="" />
        </div>
      </div>
    </section>
  );
}

function KBotSettings({
  kbot,
}: {
  kbot: SettingsFormsProps["kbot"];
}) {
  const { copy } = useI18n();
  return (
    <section id="kbot" aria-labelledby="settings-kbot-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-kbot-title"
        title={copy("K-Bot e National Life", "K-Bot and National Life")}
        description={copy(
          "Controle a conexão do K-Bot neste computador e revise como a autenticação da seguradora funciona.",
          "Control K-Bot's connection on this computer and review how carrier authentication works.",
        )}
      />
      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_230px] xl:items-start">
        <KBotCredentialSettings
          connectorEnabled={kbot.enabled}
          credentialBrokerEnabled={kbot.credentialBrokerEnabled}
          summary={kbot.credentialSummary}
        />
        <aside className="rounded-2xl border border-teal/20 bg-teal-pale/45 p-5">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-deep">
            {copy("Como funciona", "How it works")}
          </p>
          <ol className="mt-4 grid gap-4">
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-teal text-[10px] font-bold text-paper">01</span>
              <p className="text-xs leading-5 text-ink-muted">
                {copy("O K-Bot trabalha na aba em segundo plano.", "K-Bot works in the background tab.")}
              </p>
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-teal text-[10px] font-bold text-paper">02</span>
              <p className="text-xs leading-5 text-ink-muted">
                {copy("Se a sessão expirar, tenta o login protegido uma vez.", "If the session expires, it tries the protected login once.")}
              </p>
            </li>
            <li className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gold text-[10px] font-bold text-paper">03</span>
              <p className="text-xs leading-5 text-ink-muted">
                {copy("Somente MFA traz a National Life para sua atenção.", "Only MFA brings National Life to your attention.")}
              </p>
            </li>
          </ol>
        </aside>
      </div>
    </section>
  );
}

function subscriptionLabel(status: string | null, copy: (pt: string, en: string) => string) {
  const labels: Record<string, string> = {
    TRIALING: copy("Período de teste", "Trial period"),
    ACTIVE: copy("Assinatura ativa", "Active subscription"),
    PAST_DUE: copy("Pagamento pendente", "Payment pending"),
    CANCELED: copy("Assinatura cancelada", "Canceled subscription"),
    EXPIRED: copy("Assinatura expirada", "Expired subscription"),
  };
  return status ? labels[status] ?? status : copy("Sem assinatura ativa", "No active subscription");
}

function AgencySettings({
  agency,
}: {
  agency: SettingsFormsProps["agency"];
}) {
  const { copy, language } = useI18n();
  const [state, action] = useActionState(
    updateAgencyProfileAction,
    INITIAL_SETTINGS_ACTION_STATE,
  );
  const agencyNameError = fieldError(state, "agencyName", language);

  return (
    <section id="agencia" aria-labelledby="settings-agency-title" className={SECTION_CLASS}>
      <SectionHeading
        id="settings-agency-title"
        title={copy("Agência", "Agency")}
        description={
          agency.kind === "AGENCY_OWNER" && agency.canEditAgency
            ? copy("Edite a identificação da sua própria agência. Plano, vínculo e hierarquia permanecem protegidos.", "Edit your agency identity. Plan, relationship, and hierarchy remain protected.")
            : agency.kind === "AGENCY_OWNER"
              ? copy("Sua agência permanece vinculada à conta enquanto os controles de gestão estão temporariamente limitados.", "Your agency remains linked to the account while management controls are temporarily limited.")
              : copy("Consulte seu vínculo comercial e acesse os detalhes do plano.", "Review your commercial relationship and plan details.")
        }
      />

      {agency.kind === "AGENCY_OWNER" && agency.canEditAgency ? (
        <form action={action} className="mt-6 max-w-3xl" aria-describedby={state.message ? "settings-agency-message" : undefined}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
            <Field
              label={copy("Nome da agência", "Agency name")}
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
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy("Plano", "Plan")}</p>
              <p className="mt-2 text-sm font-semibold text-ink">{subscriptionLabel(agency.subscriptionStatus, copy)}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-border-steel pt-5 sm:flex-row sm:items-center sm:justify-between">
            <ActionMessage state={state} id="settings-agency-message" />
            <SubmitButton label={copy("Salvar agência", "Save agency")} pendingLabel={copy("Salvando agência…", "Saving agency…")} />
          </div>
        </form>
      ) : agency.kind === "AGENCY_OWNER" ? (
        <div className="mt-6 flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy("Agência vinculada", "Linked agency")}</p>
            <p className="mt-2 text-sm font-semibold text-ink">{agency.name ?? copy("Agência não identificada", "Unidentified agency")}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {copy("Regularize o Plano Agência para voltar a editar os dados e gerenciar a equipe.", "Bring the Agency plan up to date to edit details and manage the team again.")}
            </p>
          </div>
          <Link href="/agent/agency" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted">
            {copy("Regularizar plano", "Update plan")}
          </Link>
        </div>
      ) : agency.kind === "AGENCY_MEMBER" ? (
        <div className="mt-6 flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{copy("Agência vinculada", "Linked agency")}</p>
            <p className="mt-2 text-sm font-semibold text-ink">{agency.name ?? copy("Agência não identificada", "Unidentified agency")}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{copy("Seu vínculo é administrado pelo responsável da agência.", "Your relationship is managed by the agency owner.")}</p>
          </div>
          <Link href="/agent/agency" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted">
            {copy("Ver plano e vínculo", "View plan and relationship")}
          </Link>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-4 rounded-xl bg-panel px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">{copy("Operação individual", "Individual operation")}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{copy("Nenhuma agência está vinculada à sua conta.", "No agency is linked to your account.")}</p>
          </div>
          <Link href="/agent/agency" className="inline-flex min-h-11 items-center justify-center rounded-full border border-border-steel bg-paper px-4 text-sm font-semibold text-ink hover:border-ink-muted">
            {copy("Ver meu plano", "View my plan")}
          </Link>
        </div>
      )}
    </section>
  );
}

export function SettingsForms({
  personal,
  professional,
  security,
  agency,
  kbot,
}: SettingsFormsProps) {
  return (
    <>
      <SettingsOverview
        personal={personal}
        professional={professional}
        security={security}
        agency={agency}
        kbot={kbot}
      />

      <main className="mt-6 grid min-w-0 gap-4">
        <PersonalProfileForm personal={personal} />
        <ProfessionalProfile professional={professional} />
        <SecuritySettings security={security} />
        <KBotSettings kbot={kbot} />
        <AgencySettings agency={agency} />
      </main>
    </>
  );
}
