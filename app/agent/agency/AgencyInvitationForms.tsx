"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/Button";
import { Field, Input, Select } from "@/components/Field";
import {
  AGENCY_MONTHLY_PRICE_CENTS,
  formatPlanPrice,
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
  AGENCY_INVITATION_INITIAL_STAGES,
  AGENCY_RECRUITMENT_STAGE_LABEL,
  AGENCY_RECRUITMENT_STAGES,
  type AgencyInviteeTypeValue,
  type AgencyRecruitmentStageValue,
} from "./recruitment-ui";

const INVITED_AGENT_PRICE_LABEL = formatPlanPrice(
  INVITED_AGENT_MONTHLY_PRICE_CENTS,
);
const AGENCY_PRICE_LABEL = formatPlanPrice(AGENCY_MONTHLY_PRICE_CENTS);

function ActionMessage({ state }: { state: AgencyActionState }) {
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
      {state.message}
    </p>
  );
}

function InviteSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="primary" disabled={pending} className="w-full sm:w-auto">
      {pending ? "Enviando convite..." : "Enviar convite"}
    </Button>
  );
}

export function InvitationLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

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
        Link individual — exibido agora
      </p>
      <p className="mt-2 text-xs leading-5 text-ink-muted">
        Guarde ou envie este link. Por segurança, o token não fica armazenado em texto legível e não poderá ser recuperado depois.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={url}
          aria-label="Link individual do convite"
          onFocus={(event) => event.currentTarget.select()}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-border-steel bg-paper px-3 font-mono text-xs text-ink outline-none focus-visible:border-teal"
        />
        <Button type="button" variant="secondary" onClick={copyLink} className="shrink-0">
          {copied ? "Link copiado" : "Copiar link"}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-border-steel px-4 text-sm font-semibold text-ink transition-colors hover:bg-panel"
        >
          Abrir convite
        </a>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? "Link copiado para a área de transferência." : ""}
      </p>
    </div>
  );
}

export function AgencyInvitationForm({
  agencyName = "sua agência",
}: {
  agencyName?: string;
}) {
  const [state, action] = useActionState(
    createAgencyInvitationAction,
    INITIAL_AGENCY_ACTION_STATE,
  );
  const formHelpId = useId();
  const typeHelpId = useId();
  const [intendedType, setIntendedType] =
    useState<AgencyInviteeTypeValue>("AGENT");

  return (
    <form action={action} className="mt-6 grid gap-5 sm:grid-cols-2">
      <Field label="Nome da pessoa ou responsável (opcional)">
        <Input name="name" autoComplete="name" maxLength={120} placeholder="Ex: Maria Silva" />
      </Field>
      <Field label="E-mail" required>
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-describedby={formHelpId}
          placeholder="agente@exemplo.com"
        />
      </Field>

      <fieldset className="sm:col-span-2" aria-describedby={typeHelpId}>
        <legend className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Entrará como <span aria-hidden="true" className="text-danger">*</span>
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
                {AGENCY_INVITEE_TYPE_LABEL.AGENT}
              </strong>
              <span className="mt-1 block text-xs leading-5 text-ink-muted">
                Acesso individual por {INVITED_AGENT_PRICE_LABEL}/mês, vinculado diretamente a esta agência.
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
                {AGENCY_INVITEE_TYPE_LABEL.AGENCY}
              </strong>
              <span className="mt-1 block text-xs leading-5 text-ink-muted">
                Plano de {AGENCY_PRICE_LABEL}/mês para formar um novo ramo com sua própria equipe.
              </span>
            </span>
          </label>
        </div>
        <p id={typeHelpId} className="mt-2 text-xs leading-5 text-ink-muted">
          A escolha define o plano oferecido e como o novo vínculo aparecerá na estrutura da equipe.
        </p>
      </fieldset>

      <Field
        label="Etapa atual"
        htmlFor="agency-invitation-stage"
        required
        hint="A etapa é interna e não aparece para a pessoa convidada."
      >
        <Select
          id="agency-invitation-stage"
          name="recruitmentStage"
          defaultValue="PROSPECT"
          required
          aria-describedby="agency-invitation-stage-hint"
        >
          {AGENCY_INVITATION_INITIAL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {AGENCY_RECRUITMENT_STAGE_LABEL[stage]}
            </option>
          ))}
        </Select>
      </Field>

      <div className="rounded-xl border border-border-steel bg-panel/55 p-4" aria-live="polite">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Vínculo direto
        </p>
        <p className="mt-2 text-sm font-semibold text-ink">{agencyName}</p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {agencyName} → novo {intendedType === "AGENCY" ? "ramo de agência" : "agente"}
        </p>
      </div>

      <div className="flex flex-col gap-3 border-t border-border-steel pt-5 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
        <p id={formHelpId} className="max-w-xl text-xs leading-5 text-ink-muted">
          O convite vale por {INVITATION_VALIDITY_DAYS} dias e cria um vínculo direto com {agencyName}. A pessoa precisará entrar ou criar a conta usando exatamente este e-mail.
        </p>
        <InviteSubmitButton />
      </div>
      <div className="sm:col-span-2">
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

  return (
    <Button type="submit" variant="secondary" disabled={pending} className="shrink-0 px-3 text-xs">
      {pending ? "Salvando..." : "Salvar etapa"}
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
        Etapa de recrutamento de {inviteeLabel}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          key={currentStage}
          id={selectId}
          name="recruitmentStage"
          defaultValue={currentStage}
          aria-label={`Etapa de recrutamento de ${inviteeLabel}`}
          className="min-w-0 flex-1 py-2 text-xs"
        >
          {AGENCY_RECRUITMENT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {AGENCY_RECRUITMENT_STAGE_LABEL[stage]}
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

  return (
    <Button
      type="submit"
      variant="secondary"
      disabled={pending}
      aria-label={
        pending
          ? `Revogando convite de ${inviteeLabel}`
          : `Revogar convite de ${inviteeLabel}`
      }
      className="px-3 py-1.5 text-xs"
    >
      {pending ? "Revogando..." : "Revogar"}
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
  const [state, action] = useActionState(
    revokeAgencyInvitationAction,
    INITIAL_AGENCY_ACTION_STATE,
  );

  return (
    <form
      action={action}
      className="flex flex-col items-end gap-2"
      onSubmit={(event) => {
        if (!window.confirm(`Revogar o convite de ${inviteeLabel}?`)) {
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
