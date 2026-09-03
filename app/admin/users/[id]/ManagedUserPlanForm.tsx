"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Input } from "@/components/Field";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { formatPlatformPlanPrice } from "@/lib/plans";
import {
  updateManagedUserPlanAction,
  type ManagedUserPlanActionState,
} from "../plan-actions";

const INITIAL_STATE: ManagedUserPlanActionState = { status: "idle", message: "" };

type EditablePlan = "AGENT_INDIVIDUAL" | "AGENCY";
type CurrentPlan = EditablePlan | "AGENT_AGENCY_MEMBER";

export type ManagedUserPlanBlockers = {
  activeMemberCount: number;
  childAgencyCount: number;
  pendingInvitationCount: number;
  hasParentAgency: boolean;
  subAgentCount: number;
  hasParentAgent: boolean;
};

type PlanDraft = {
  version: string;
  selectedPlan: EditablePlan;
  agencyName: string;
  confirmDowngrade: boolean;
};

function publicPlan(plan: CurrentPlan): EditablePlan {
  return plan === "AGENCY" ? "AGENCY" : "AGENT_INDIVIDUAL";
}

function initialDraft(version: string, plan: CurrentPlan): PlanDraft {
  return {
    version,
    selectedPlan: publicPlan(plan),
    agencyName: "",
    confirmDowngrade: false,
  };
}

export function ManagedUserPlanForm({
  userId,
  expectedUpdatedAt,
  currentPlan,
  currentAgencyName,
  stripeCustomerLinked,
  stripeSubscriptionLinked,
  blockers,
}: {
  userId: string;
  expectedUpdatedAt: string;
  currentPlan: CurrentPlan;
  currentAgencyName?: string | null;
  stripeCustomerLinked: boolean;
  stripeSubscriptionLinked: boolean;
  blockers: ManagedUserPlanBlockers;
}) {
  const { copy, locale } = useI18n();
  const router = useRouter();
  const [state, action, pending] = useActionState(
    updateManagedUserPlanAction,
    INITIAL_STATE,
  );
  const version = `${expectedUpdatedAt}:${currentPlan}`;
  const [storedDraft, setStoredDraft] = useState<PlanDraft>(() =>
    initialDraft(version, currentPlan),
  );
  const draft = storedDraft.version === version
    ? storedDraft
    : initialDraft(version, currentPlan);

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  const supportedPlan = currentPlan === "AGENT_INDIVIDUAL" || currentPlan === "AGENCY";
  const isNoOp = draft.selectedPlan === publicPlan(currentPlan);
  const isUpgrade = currentPlan === "AGENT_INDIVIDUAL" && draft.selectedPlan === "AGENCY";
  const isDowngrade = currentPlan === "AGENCY" && draft.selectedPlan === "AGENT_INDIVIDUAL";
  const blockerItems: string[] = [];

  if (blockers.activeMemberCount > 0) {
    blockerItems.push(copy(
      `${blockers.activeMemberCount} ${blockers.activeMemberCount === 1 ? "integrante ativo" : "integrantes ativos"} na equipe`,
      `${blockers.activeMemberCount} active team ${blockers.activeMemberCount === 1 ? "member" : "members"}`,
    ));
  }
  if (blockers.childAgencyCount > 0) {
    blockerItems.push(copy(
      `${blockers.childAgencyCount} ${blockers.childAgencyCount === 1 ? "subagência vinculada" : "subagências vinculadas"}`,
      `${blockers.childAgencyCount} linked child ${blockers.childAgencyCount === 1 ? "agency" : "agencies"}`,
    ));
  }
  if (blockers.pendingInvitationCount > 0) {
    blockerItems.push(copy(
      `${blockers.pendingInvitationCount} ${blockers.pendingInvitationCount === 1 ? "convite pendente" : "convites pendentes"}`,
      `${blockers.pendingInvitationCount} pending ${blockers.pendingInvitationCount === 1 ? "invitation" : "invitations"}`,
    ));
  }
  if (blockers.hasParentAgency) {
    blockerItems.push(copy("Vínculo com uma agência base", "Link to a parent agency"));
  }
  if (blockers.subAgentCount > 0) {
    blockerItems.push(copy(
      `${blockers.subAgentCount} ${blockers.subAgentCount === 1 ? "agente vinculado" : "agentes vinculados"} abaixo do responsável`,
      `${blockers.subAgentCount} linked downstream ${blockers.subAgentCount === 1 ? "agent" : "agents"}`,
    ));
  }
  if (blockers.hasParentAgent) {
    blockerItems.push(copy("Vínculo do responsável com outro agente", "Owner link to another agent"));
  }

  const hasBlockers = blockerItems.length > 0;
  const agencyNameMissing = isUpgrade && draft.agencyName.trim().length < 2;
  const confirmationMissing = isDowngrade && !draft.confirmDowngrade;
  const incompleteStripeLink = stripeCustomerLinked && !stripeSubscriptionLinked;
  const formDisabled = incompleteStripeLink || !supportedPlan;
  const submitDisabled = pending
    || formDisabled
    || isNoOp
    || agencyNameMissing
    || (isDowngrade && hasBlockers)
    || confirmationMissing;

  function choosePlan(selectedPlan: EditablePlan) {
    setStoredDraft({
      ...draft,
      version,
      selectedPlan,
      confirmDowngrade: false,
    });
  }

  return (
    <form action={action} className="rounded-xl border border-border-steel bg-paper p-4 sm:p-5" aria-busy={pending}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />

      <div className="border-b border-border-steel pb-4">
        <h3 className="text-sm font-semibold text-ink">
          {copy("Plano da assinatura", "Subscription plan")}
        </h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-muted">
          {copy(
            "Altere entre o acesso individual do agente e a estrutura completa de agência.",
            "Switch between individual agent access and the full agency structure.",
          )}
        </p>
      </div>

      <fieldset className="mt-5" disabled={formDisabled || pending}>
        <legend className="text-xs font-semibold uppercase tracking-[0.03em] text-ink-muted">
          {copy("Novo plano", "New plan")}
        </legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(["AGENT_INDIVIDUAL", "AGENCY"] as const).map((plan) => {
            const checked = draft.selectedPlan === plan;
            const agency = plan === "AGENCY";
            return (
              <label
                key={plan}
                className={`rounded-xl border p-4 transition-[border-color,background-color] ${
                  formDisabled || pending
                    ? "cursor-not-allowed bg-panel/65 opacity-70"
                    : "cursor-pointer"
                } ${
                  checked
                    ? "border-teal bg-teal-pale/40"
                    : "border-border-steel bg-paper hover:border-ink-muted"
                }`}
              >
                <span className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="targetPlan"
                    value={plan}
                    checked={checked}
                    onChange={() => choosePlan(plan)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">
                      {agency ? copy("Plano Agência", "Agency plan") : copy("Plano Agente", "Agent plan")}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-ink-muted">
                      {agency
                        ? copy("Equipe, convites e gestão da estrutura.", "Team, invitations, and structure management.")
                        : copy("Acesso individual, sem gestão de agência.", "Individual access without agency management.")}
                    </span>
                    <span className="mt-2 block font-mono text-xs font-semibold tabular-nums text-ink">
                      {formatPlatformPlanPrice(plan, locale)} {copy("/mês", "/month")}
                    </span>
                    {publicPlan(currentPlan) === plan ? (
                      <span className="mt-2 inline-flex rounded-full bg-panel px-2 py-1 text-xs font-semibold text-ink-muted">
                        {copy("Plano atual", "Current plan")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {state.fieldErrors?.targetPlan ? (
        <p role="alert" className="mt-2 text-xs text-danger">{state.fieldErrors.targetPlan}</p>
      ) : null}

      {isUpgrade ? (
        <label className="mt-5 flex max-w-md flex-col gap-2" htmlFor="managed-user-agency-name">
          <span className="text-xs font-semibold text-ink-muted">
            {copy("Nome da agência", "Agency name")} <span aria-hidden className="text-danger">*</span>
          </span>
          <Input
            id="managed-user-agency-name"
            name="agencyName"
            value={draft.agencyName}
            onChange={(event) => setStoredDraft({ ...draft, version, agencyName: event.target.value })}
            minLength={2}
            maxLength={120}
            required
            autoComplete="organization"
            disabled={formDisabled || pending}
            aria-invalid={Boolean(state.fieldErrors?.agencyName)}
            aria-describedby={state.fieldErrors?.agencyName ? "managed-user-agency-name-error" : undefined}
          />
          <span className="text-xs leading-5 text-ink-muted">
            {copy(
              "A nova agência será criada com este usuário como responsável.",
              "The new agency will be created with this user as its owner.",
            )}
          </span>
          {state.fieldErrors?.agencyName ? (
            <span id="managed-user-agency-name-error" role="alert" className="text-xs text-danger">
              {state.fieldErrors.agencyName}
            </span>
          ) : null}
        </label>
      ) : null}

      {isDowngrade ? (
        <div className={`mt-5 rounded-xl border p-4 ${hasBlockers ? "border-danger/25 bg-danger-pale/30" : "border-gold/30 bg-gold-pale/35"}`}>
          <p className="text-sm font-semibold text-ink">
            {hasBlockers
              ? copy("Resolva os vínculos antes de alterar", "Resolve links before changing plans")
              : copy("Confirme a mudança para Plano Agente", "Confirm the change to Agent plan")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            {copy(
              `O usuário perderá os módulos Agência e Equipe${currentAgencyName ? ` da ${currentAgencyName}` : ""}. O histórico será preservado.`,
              `The user will lose Agency and Team modules${currentAgencyName ? ` for ${currentAgencyName}` : ""}. History will be preserved.`,
            )}
          </p>

          {hasBlockers ? (
            <ul className="mt-3 space-y-1.5 text-xs text-danger" aria-label={copy("Bloqueios da alteração", "Plan change blockers")}>
              {blockerItems.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          ) : null}

          <label className={`mt-3 flex items-start gap-2.5 text-xs leading-5 text-ink ${hasBlockers ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              name="confirmDowngrade"
              value="yes"
              checked={draft.confirmDowngrade}
              onChange={(event) => setStoredDraft({ ...draft, version, confirmDowngrade: event.target.checked })}
              disabled={formDisabled || pending || hasBlockers}
              className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
            />
            <span>
              {copy(
                "Confirmo a remoção da estrutura de agência deste usuário.",
                "I confirm the removal of this user's agency structure.",
              )}
            </span>
          </label>

          {state.fieldErrors?.confirmDowngrade ? (
            <p role="alert" className="mt-2 text-xs text-danger">{state.fieldErrors.confirmDowngrade}</p>
          ) : null}
        </div>
      ) : null}

      {!supportedPlan ? (
        <p className="mt-4 rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
          {copy(
            "Este agente faz parte de uma agência por convite. Remova o vínculo da equipe antes de atribuir outro plano.",
            "This agent belongs to an agency by invitation. Remove the team link before assigning another plan.",
          )}
        </p>
      ) : incompleteStripeLink ? (
        <p className="mt-4 rounded-lg border border-gold/30 bg-gold-pale/35 px-3.5 py-3 text-xs leading-5 text-gold-ink">
          {copy(
            "Esta conta possui um cliente no Stripe, mas não tem uma assinatura vinculada. Regularize a cobrança antes de alterar o plano.",
            "This account has a Stripe customer but no linked subscription. Resolve its billing setup before changing the plan.",
          )}
        </p>
      ) : stripeSubscriptionLinked ? (
        <p className="mt-4 rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
          {copy(
            "A assinatura está sincronizada com o Stripe. O novo preço passa a valer na próxima renovação, sem cobrança ou prorrata imediata.",
            "The subscription is synchronized with Stripe. The new price takes effect at the next renewal, with no immediate charge or proration.",
          )}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col-reverse gap-3 border-t border-border-steel pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-ink-muted">
          {isNoOp
            ? copy("Selecione um plano diferente para continuar.", "Select a different plan to continue.")
            : stripeSubscriptionLinked
              ? copy(
                  "O acesso muda ao confirmar; o novo valor será aplicado somente na renovação.",
                  "Access changes on confirmation; the new price is applied only at renewal.",
                )
              : copy("A alteração entra em vigor assim que for confirmada.", "The change takes effect as soon as it is confirmed.")}
        </p>
        <Button type="submit" variant="secondary" disabled={submitDisabled} aria-disabled={submitDisabled}>
          {pending
            ? copy("Alterando…", "Changing…")
            : draft.selectedPlan === "AGENCY"
              ? copy("Alterar para Plano Agência", "Change to Agency plan")
              : copy("Alterar para Plano Agente", "Change to Agent plan")}
        </Button>
      </div>

      {state.message && (state.status === "error" || isNoOp) ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mt-4 rounded-lg px-3.5 py-3 text-sm ${
            state.status === "error"
              ? "bg-danger-pale text-danger"
              : "bg-success-pale text-success"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
