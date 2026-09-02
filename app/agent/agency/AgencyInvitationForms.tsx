"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import { useI18n } from "@/components/i18n/LanguageProvider";
import {
  AGENCY_INVITATION_DISCOUNT_CENTS,
  formatPlanPrice,
  INVITED_AGENCY_MONTHLY_PRICE_CENTS,
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
} from "@/lib/plans";
import {
  createAgencyInvitationAction,
  revokeAgencyInvitationAction,
  updateAgencyRecruitmentStageAction,
} from "./actions";
import {
  INITIAL_AGENCY_ACTION_STATE,
  INVITATION_VALIDITY_DAYS,
  type AgencyActionState,
} from "./plan";
import {
  AGENCY_INVITEE_TYPE_LABEL,
  AGENCY_INVITEE_TYPE_LABEL_EN,
  AGENCY_RECRUITMENT_STAGE_LABEL,
  AGENCY_RECRUITMENT_STAGE_LABEL_EN,
  AGENCY_RECRUITMENT_STAGES,
  type AgencyInviteeTypeValue,
  type AgencyRecruitmentStageValue,
} from "./recruitment-ui";

const AGENCY_ACTION_MESSAGE_EN: Record<string, string> = {
  "O nome deve ter no máximo 120 caracteres.": "The name must be no more than 120 characters.",
  "Informe um e-mail válido.": "Enter a valid email address.",
  "Escolha se o convite é para um agente ou uma agência.": "Choose whether the invitation is for an agent or an agency.",
  "Convite inválido.": "Invalid invitation.",
  "Escolha uma etapa de recrutamento válida.": "Choose a valid recruitment stage.",
  "Atualize a página e tente novamente.": "Refresh the page and try again.",
  "Uma assinatura ativa vinculada à agência é necessária para criar convites.": "An active subscription linked to the agency is required to create invitations.",
  "Uma assinatura ativa vinculada à agência é necessária para atualizar etapas.": "An active subscription linked to the agency is required to update stages.",
  "Uma assinatura ativa vinculada à agência é necessária para revogar convites.": "An active subscription linked to the agency is required to revoke invitations.",
  "Nenhuma agência ativa foi encontrada para esta conta.": "No active agency was found for this account.",
  "Revise os dados do convite.": "Review the invitation details.",
  "Você não pode enviar um convite para a própria conta.": "You cannot send an invitation to your own account.",
  "Este e-mail não está disponível para um novo convite.": "This email address is not available for a new invitation.",
  "Este vínculo precisa estar ativo e regular antes da conversão para Agência.": "This connection must be active and in good standing before it can be converted to an Agency.",
  "Este agente já faz parte da agência.": "This agent is already part of the agency.",
  "Esta pessoa já faz parte da sua estrutura.": "This person is already part of your organization.",
  "Não foi possível identificar o responsável pelo convite.": "We couldn't identify who is responsible for the invitation.",
  "Já existe um convite pendente para este e-mail.": "There is already a pending invitation for this email address.",
  "Não foi possível registrar o convite agora.": "We couldn't create the invitation right now.",
  "Convite criado e enviado por e-mail. O link individual também está disponível abaixo.": "Invitation created and sent by email. The individual link is also available below.",
  "Convite criado, mas o e-mail não foi entregue. Copie e envie o link individual abaixo.": "The invitation was created, but the email was not delivered. Copy and send the individual link below.",
  "Revise a etapa de recrutamento.": "Review the recruitment stage.",
  "Não foi possível identificar o responsável pela alteração.": "We couldn't identify who is responsible for this change.",
  "Não foi possível atualizar esta etapa. Atualize a página e tente novamente.": "We couldn't update this stage. Refresh the page and try again.",
  "Esta etapa foi alterada em outra sessão. Atualize a página e tente novamente.": "This stage was changed in another session. Refresh the page and try again.",
  "A etapa Ativo exige um convite aceito e um vínculo vigente.": "The Active stage requires an accepted invitation and a current connection.",
  "Etapa de recrutamento atualizada.": "Recruitment stage updated.",
  "A etapa de recrutamento já estava atualizada.": "The recruitment stage was already up to date.",
  "Não foi possível atualizar a etapa agora.": "We couldn't update the stage right now.",
  "Não foi possível identificar o responsável pela revogação.": "We couldn't identify who is responsible for revoking the invitation.",
  "O convite não está mais disponível para revogação.": "This invitation is no longer available to revoke.",
  "Convite revogado.": "Invitation revoked.",
  "Não foi possível revogar o convite agora.": "We couldn't revoke the invitation right now.",
};

function localizedActionMessage(message: string, language: "PT" | "EN") {
  return language === "EN" ? AGENCY_ACTION_MESSAGE_EN[message] ?? message : message;
}

function ActionMessage({ state }: { state: AgencyActionState }) {
  const { language } = useI18n();
  if (!state.message) return null;
  const deliveryWarning = state.status === "success"
    && /não (?:foi )?(?:enviado|entregue)|falha.+e-mail/i.test(state.message);

  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`text-sm leading-6 ${
        state.status === "error"
          ? "text-danger"
          : deliveryWarning
            ? "text-gold-ink"
            : "text-success"
      }`}
    >
      {localizedActionMessage(state.message, language)}
    </p>
  );
}

function InviteSubmitButton() {
  const { pending } = useFormStatus();
  const { copy } = useI18n();

  return (
    <Button type="submit" variant="primary" disabled={pending} className="w-full sm:w-auto">
      {pending
        ? copy("Enviando convite...", "Sending invitation...")
        : copy("Enviar convite por e-mail", "Send invitation by email")}
    </Button>
  );
}

export function InvitationLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const { copy } = useI18n();

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-xl border border-teal/25 bg-teal-pale/45 p-4 sm:col-span-2">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal-deep">
        {copy("Link individual do convite", "Individual invitation link")}
      </p>
      <p className="mt-2 text-xs leading-5 text-ink-muted">
        {copy(
          "Este é o mesmo acesso enviado por e-mail. Copie o link caso precise reenviá-lo manualmente; por segurança, ele não poderá ser recuperado depois.",
          "This is the same link sent by email. Copy it if you need to resend it manually; for security, it cannot be retrieved later.",
        )}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={url}
          aria-label={copy("Link individual do convite", "Individual invitation link")}
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-border-steel bg-paper px-3 font-mono text-xs text-ink outline-none focus-visible:border-teal"
        />
        <Button type="button" variant="secondary" onClick={copyLink} className="shrink-0">
          {copied ? copy("Link copiado", "Link copied") : copy("Copiar link", "Copy link")}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border-steel px-4 text-sm font-semibold text-ink transition-colors hover:bg-panel"
        >
          {copy("Abrir convite", "Open invitation")}
        </a>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? copy("Link copiado para a área de transferência.", "Link copied to the clipboard.") : ""}
      </p>
    </div>
  );
}

export function AgencyInvitationForm({
  agencyName = "sua agência",
}: {
  agencyName?: string;
}) {
  const { copy, locale, language } = useI18n();
  const [state, action] = useActionState(
    createAgencyInvitationAction,
    INITIAL_AGENCY_ACTION_STATE,
  );
  const formHelpId = useId();
  const typeHelpId = useId();
  const [intendedType, setIntendedType] =
    useState<AgencyInviteeTypeValue>("AGENT");
  const invitedAgentPriceLabel = formatPlanPrice(INVITED_AGENT_MONTHLY_PRICE_CENTS, locale);
  const invitedAgencyPriceLabel = formatPlanPrice(INVITED_AGENCY_MONTHLY_PRICE_CENTS, locale);
  const invitationDiscountLabel = formatPlanPrice(AGENCY_INVITATION_DISCOUNT_CENTS, locale);

  return (
    <form action={action} className="agency-invite-form mt-6">
      <div className="agency-invite-name">
        <Field label={copy("Nome da pessoa ou responsável (opcional)", "Person or contact name (optional)")}>
          <Input name="name" autoComplete="name" maxLength={120} placeholder={copy("Ex: Maria Silva", "E.g. Maria Silva")} />
        </Field>
      </div>
      <div className="agency-invite-email">
        <Field label={copy("E-mail", "Email")} required>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-describedby={formHelpId}
            placeholder={copy("agente@exemplo.com", "agent@example.com")}
          />
        </Field>
      </div>

      <fieldset className="agency-invite-types" aria-describedby={typeHelpId}>
        <legend className="font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {copy("Entrará como", "Will join as")} <span aria-hidden="true" className="text-danger">*</span>
        </legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label
            className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-[3px] focus-within:ring-teal-pale ${
              intendedType === "AGENT"
                ? "border-teal bg-teal-pale/55"
                : "border-border-steel bg-paper hover:border-ink-muted"
            }`}
          >
            <input
              type="radio"
              name="intendedType"
              value="AGENT"
              required
              checked={intendedType === "AGENT"}
              onChange={() => setIntendedType("AGENT")}
              className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
            />
            <span>
              <strong className="block text-sm font-semibold text-ink">
                {language === "EN" ? AGENCY_INVITEE_TYPE_LABEL_EN.AGENT : AGENCY_INVITEE_TYPE_LABEL.AGENT}
              </strong>
              <span className="mt-1 block text-xs leading-5 text-ink-muted">
                {copy(
                  `Acesso individual por ${invitedAgentPriceLabel}/mês, com ${invitationDiscountLabel} de desconto e vínculo direto com esta agência.`,
                  `Individual access for ${invitedAgentPriceLabel}/month, with a ${invitationDiscountLabel} discount and a direct connection to this agency.`,
                )}
              </span>
            </span>
          </label>

          <label
            className={`flex min-h-20 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-[3px] focus-within:ring-teal-pale ${
              intendedType === "AGENCY"
                ? "border-teal bg-teal-pale/55"
                : "border-border-steel bg-paper hover:border-ink-muted"
            }`}
          >
            <input
              type="radio"
              name="intendedType"
              value="AGENCY"
              required
              checked={intendedType === "AGENCY"}
              onChange={() => setIntendedType("AGENCY")}
              className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
            />
            <span>
              <strong className="block text-sm font-semibold text-ink">
                {language === "EN" ? AGENCY_INVITEE_TYPE_LABEL_EN.AGENCY : AGENCY_INVITEE_TYPE_LABEL.AGENCY}
              </strong>
              <span className="mt-1 block text-xs leading-5 text-ink-muted">
                {copy(
                  `Plano de ${invitedAgencyPriceLabel}/mês, com ${invitationDiscountLabel} de desconto, para formar um novo ramo com sua própria equipe.`,
                  `A ${invitedAgencyPriceLabel}/month plan with a ${invitationDiscountLabel} discount, to create a new branch with its own team.`,
                )}
              </span>
            </span>
          </label>
        </div>
        <p id={typeHelpId} className="mt-2 text-xs leading-5 text-ink-muted">
          {copy(
            "A escolha define o plano oferecido e como o novo vínculo aparecerá na estrutura da equipe.",
            "Your choice determines the plan offered and how the new connection appears in the team structure.",
          )}
        </p>
      </fieldset>

      <div className="agency-invite-footer">
        <p id={formHelpId} className="max-w-xl text-xs leading-5 text-ink-muted">
          {copy(
            `O convite será enviado para este e-mail e vale por ${INVITATION_VALIDITY_DAYS} dias. A pessoa usa o link para criar ou acessar a conta e ativar o próprio plano; quando ele estiver ativo, o vínculo é registrado na equipe da ${agencyName}.`,
            `The invitation will be sent to this email address and is valid for ${INVITATION_VALIDITY_DAYS} days. The person uses the link to create or access their account and activate their own plan; once active, the connection is added to the ${agencyName} team.`,
          )}
        </p>
        <InviteSubmitButton />
      </div>
      <div className="agency-invite-message">
        <ActionMessage state={state} />
      </div>
      {state.status === "success" && state.invitationUrl ? (
        <InvitationLink url={state.invitationUrl} />
      ) : null}
    </form>
  );
}

function StageSubmitButton() {
  const { pending } = useFormStatus();
  const { copy } = useI18n();

  return (
    <Button type="submit" variant="secondary" disabled={pending} className="shrink-0 px-3 text-xs">
      {pending ? copy("Salvando...", "Saving...") : copy("Salvar etapa", "Save stage")}
    </Button>
  );
}

export function RecruitmentStageForm({
  invitationId,
  inviteeLabel,
  currentStage,
  expectedStageUpdatedAt,
}: {
  invitationId: string;
  inviteeLabel: string;
  currentStage: AgencyRecruitmentStageValue;
  expectedStageUpdatedAt: string;
}) {
  const { copy, language } = useI18n();
  const [state, action] = useActionState(
    updateAgencyRecruitmentStageAction,
    INITIAL_AGENCY_ACTION_STATE,
  );
  const selectId = useId();

  return (
    <form action={action} className="flex min-w-[220px] flex-col gap-2">
      <input type="hidden" name="invitationId" value={invitationId} />
      <input
        type="hidden"
        name="expectedStageUpdatedAt"
        value={expectedStageUpdatedAt}
      />
      <label htmlFor={selectId} className="sr-only">
        {copy(`Etapa de recrutamento de ${inviteeLabel}`, `Recruitment stage for ${inviteeLabel}`)}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          key={currentStage}
          id={selectId}
          name="recruitmentStage"
          defaultValue={currentStage}
          aria-label={copy(`Etapa de recrutamento de ${inviteeLabel}`, `Recruitment stage for ${inviteeLabel}`)}
          className="min-w-0 flex-1 py-2 text-xs"
        >
          {AGENCY_RECRUITMENT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {language === "EN"
                ? AGENCY_RECRUITMENT_STAGE_LABEL_EN[stage]
                : AGENCY_RECRUITMENT_STAGE_LABEL[stage]}
            </option>
          ))}
        </Select>
        <StageSubmitButton />
      </div>
      <ActionMessage state={state} />
    </form>
  );
}

function RevokeSubmitButton({ inviteeLabel }: { inviteeLabel: string }) {
  const { pending } = useFormStatus();
  const { copy } = useI18n();

  return (
    <Button
      type="submit"
      variant="secondary"
      disabled={pending}
      aria-label={
        pending
          ? copy(`Revogando convite de ${inviteeLabel}`, `Revoking invitation for ${inviteeLabel}`)
          : copy(`Revogar convite de ${inviteeLabel}`, `Revoke invitation for ${inviteeLabel}`)
      }
      className="px-3 py-1.5 text-xs"
    >
      {pending ? copy("Revogando...", "Revoking...") : copy("Revogar", "Revoke")}
    </Button>
  );
}

export function RevokeInvitationForm({
  invitationId,
  inviteeLabel,
}: {
  invitationId: string;
  inviteeLabel: string;
}) {
  const { copy } = useI18n();
  const [state, action] = useActionState(
    revokeAgencyInvitationAction,
    INITIAL_AGENCY_ACTION_STATE,
  );

  return (
    <form
      action={action}
      className="flex flex-col items-end gap-2"
      onSubmit={(event) => {
        if (!window.confirm(copy(
          `Revogar o convite de ${inviteeLabel}?`,
          `Revoke the invitation for ${inviteeLabel}?`,
        ))) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invitationId" value={invitationId} />
      <RevokeSubmitButton inviteeLabel={inviteeLabel} />
      <ActionMessage state={state} />
    </form>
  );
}
