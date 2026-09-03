"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { Input } from "@/components/Field";
import { useI18n } from "@/components/i18n/LanguageProvider";
import {
  updateManagedUserProductAccessAction,
  type AdminUserActionState,
} from "../actions";

const INITIAL_STATE: AdminUserActionState = { status: "idle", message: "" };

type ModuleName =
  | "TODAY"
  | "CALENDAR"
  | "CRM"
  | "MESSAGES"
  | "POLICIES"
  | "ILLUSTRATIONS"
  | "COMMISSIONS"
  | "JOURNEY"
  | "AGENCY"
  | "TEAM"
  | "INTEGRATIONS";

const MODULES: Array<{
  value: ModuleName;
  label: [string, string];
  description: [string, string];
  agencyOnly?: boolean;
}> = [
  { value: "TODAY", label: ["Hoje", "Today"], description: ["Visão inicial da operação", "Operations overview"] },
  { value: "CALENDAR", label: ["Agenda", "Calendar"], description: ["Compromissos e link de agendamento", "Appointments and scheduling link"] },
  { value: "CRM", label: ["CRM", "CRM"], description: ["Oportunidades, clientes e atividades", "Opportunities, clients, and activities"] },
  { value: "MESSAGES", label: ["Mensagens", "Messages"], description: ["Canais e conversas", "Channels and conversations"] },
  { value: "POLICIES", label: ["Apólices", "Policies"], description: ["Carteira e documentos", "Book of business and documents"] },
  { value: "ILLUSTRATIONS", label: ["Ilustrações", "Illustrations"], description: ["Cotações e propostas", "Quotes and proposals"] },
  { value: "COMMISSIONS", label: ["Comissões", "Commissions"], description: ["Produção e pagamentos", "Production and payments"] },
  { value: "JOURNEY", label: ["Jornada", "Journey"], description: ["Progresso e promoções", "Progress and promotions"] },
  { value: "AGENCY", label: ["Agência", "Agency"], description: ["Convites e gestão direta", "Invites and direct management"], agencyOnly: true },
  { value: "TEAM", label: ["Equipe", "Team"], description: ["Estrutura e hierarquia", "Structure and hierarchy"], agencyOnly: true },
  { value: "INTEGRATIONS", label: ["Integrações", "Integrations"], description: ["Google Agenda e National Life", "Google Calendar and National Life"] },
];

function StatusBadge({ status }: { status: "ACTIVE" | "TRIAL" | "PAYMENT_REQUIRED" }) {
  const { copy } = useI18n();
  const label = status === "ACTIVE"
    ? copy("Acesso liberado", "Access granted")
    : status === "TRIAL"
      ? copy("Teste gratuito", "Free trial")
      : copy("Pagamento necessário", "Payment required");
  const style = status === "PAYMENT_REQUIRED"
    ? "bg-gold-pale text-gold-ink"
    : "bg-success-pale text-success";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{label}</span>;
}

export function ManagedUserProductAccessForm({
  userId,
  expectedUpdatedAt,
  plan,
  status,
  modules,
  paymentReason,
  currentPeriodEnd,
  providerManaged,
}: {
  userId: string;
  expectedUpdatedAt: string;
  plan: "AGENT_INDIVIDUAL" | "AGENCY" | "AGENT_AGENCY_MEMBER";
  status: "ACTIVE" | "TRIAL" | "PAYMENT_REQUIRED";
  modules: ModuleName[];
  paymentReason: string | null;
  currentPeriodEnd: string | null;
  providerManaged: boolean;
}) {
  const { copy, language } = useI18n();
  const router = useRouter();
  const [state, action, pending] = useActionState(
    updateManagedUserProductAccessAction,
    INITIAL_STATE,
  );
  const moduleVersion = `${expectedUpdatedAt}:${modules.join("|")}`;
  const [moduleDraft, setModuleDraft] = useState<{ version: string; values: ModuleName[] }>(() => ({
    version: moduleVersion,
    values: modules,
  }));
  const selectedModules = moduleDraft.version === moduleVersion ? moduleDraft.values : modules;

  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  const visibleModules = MODULES.filter((module) => plan === "AGENCY" || !module.agencyOnly);
  const periodLabel = currentPeriodEnd
    ? new Intl.DateTimeFormat(language === "PT" ? "pt-BR" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(currentPeriodEnd))
    : null;

  const commonHidden = (
    <>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
    </>
  );

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-3 rounded-xl border border-border-steel bg-panel/65 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            {providerManaged ? (
              <span className="text-xs font-semibold text-ink-muted">
                {copy("Gerenciado pelo Stripe", "Managed by Stripe")}
              </span>
            ) : (
              <span className="text-xs font-semibold text-ink-muted">
                {copy("Acesso administrativo", "Administrative access")}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {status === "TRIAL" && periodLabel
              ? copy(`Teste até ${periodLabel}.`, `Trial until ${periodLabel}.`)
              : status === "PAYMENT_REQUIRED"
                ? paymentReason ?? copy("O usuário precisa ativar a assinatura para continuar.", "The user must activate the subscription to continue.")
                : copy("A assinatura está ativa.", "The subscription is active.")}
          </p>
        </div>
        <span className="text-xs font-semibold text-ink-muted">
          {plan === "AGENCY" ? copy("Plano Agência", "Agency plan") : copy("Plano Agente", "Agent plan")}
        </span>
      </div>

      <form action={action} className="space-y-4">
        {commonHidden}
        <input type="hidden" name="intent" value="SAVE_MODULES" />
        <div>
          <h3 className="text-sm font-semibold text-ink">{copy("Módulos liberados", "Enabled modules")}</h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            {copy(
              "O usuário verá apenas estas áreas. Hoje e Configurações permanecem disponíveis para a conta funcionar.",
              "The user will only see these areas. Today and Settings remain available so the account can function.",
            )}
          </p>
        </div>
        <input type="hidden" name="modules" value="TODAY" />
        <div className="divide-y divide-border-steel rounded-xl border border-border-steel">
          {visibleModules.map((module) => {
            const isToday = module.value === "TODAY";
            const enabled = isToday || selectedModules.includes(module.value);
            return (
              <label key={module.value} className="flex min-h-14 cursor-pointer items-center gap-3 px-3.5 py-2.5 first:rounded-t-xl last:rounded-b-xl hover:bg-panel/60">
                <input
                  type="checkbox"
                  name={isToday ? undefined : "modules"}
                  value={module.value}
                  checked={enabled}
                  onChange={(event) => {
                    setModuleDraft({
                      version: moduleVersion,
                      values: event.target.checked
                        ? [...selectedModules, module.value]
                        : selectedModules.filter((value) => value !== module.value),
                    });
                  }}
                  disabled={isToday || pending}
                  className="h-4 w-4 accent-[var(--color-teal)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{copy(...module.label)}</span>
                  <span className="block text-xs text-ink-muted">{copy(...module.description)}</span>
                </span>
                <span className="text-xs font-semibold text-ink-muted">
                  {enabled ? copy("Liberado", "Enabled") : copy("Bloqueado", "Blocked")}
                </span>
              </label>
            );
          })}
        </div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? copy("Salvando…", "Saving…") : copy("Salvar módulos", "Save modules")}
        </Button>
      </form>

      <div className="grid gap-5 border-t border-border-steel pt-6 lg:grid-cols-2">
        <form action={action} className="rounded-xl border border-border-steel p-4">
          {commonHidden}
          <input type="hidden" name="intent" value="START_TRIAL" />
          <h3 className="text-sm font-semibold text-ink">
            {status === "TRIAL" ? copy("Estender teste", "Extend trial") : copy("Liberar teste", "Enable trial")}
          </h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            {copy("O novo período começa agora e libera os módulos selecionados.", "The new period starts now and enables the selected modules.")}
          </p>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold text-ink-muted">{copy("Dias a partir de hoje", "Days from today")}</span>
            <Input name="trialDays" type="number" min={1} max={365} defaultValue={30} disabled={pending || providerManaged} className="w-full" />
          </label>
          {state.fieldErrors?.trialDays ? <p role="alert" className="mt-2 text-xs text-danger">{state.fieldErrors.trialDays}</p> : null}
          <Button type="submit" className="mt-4 w-full" disabled={pending || providerManaged}>
            {copy("Aplicar período de teste", "Apply trial period")}
          </Button>
        </form>

        <form action={action} className="rounded-xl border border-danger/20 bg-danger-pale/35 p-4">
          {commonHidden}
          <input type="hidden" name="intent" value="REQUIRE_PAYMENT" />
          <h3 className="text-sm font-semibold text-ink">{copy("Exigir pagamento agora", "Require payment now")}</h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            {copy(
              "O usuário continuará podendo entrar, mas verá a cobrança antes de qualquer módulo.",
              "The user can still sign in, but will see billing before any module.",
            )}
          </p>
          <label className="mt-4 block">
            <span className="mb-2 block text-xs font-semibold text-ink-muted">{copy("Motivo", "Reason")}</span>
            <Input
              name="reason"
              type="text"
              minLength={5}
              maxLength={240}
              placeholder={copy("Ex.: período de teste encerrado", "Example: trial period ended")}
              disabled={pending || providerManaged}
              className="w-full"
            />
          </label>
          {state.fieldErrors?.reason ? <p role="alert" className="mt-2 text-xs text-danger">{state.fieldErrors.reason}</p> : null}
          <Button type="submit" variant="danger" className="mt-4 w-full" disabled={pending || providerManaged}>
            {copy("Bloquear até o pagamento", "Block until payment")}
          </Button>
        </form>
      </div>

      {providerManaged ? (
        <p className="rounded-lg bg-panel px-3.5 py-3 text-xs leading-5 text-ink-muted">
          {copy(
            "Alterações de cobrança desta assinatura devem permanecer sincronizadas com o Stripe. Os módulos continuam editáveis aqui.",
            "Billing changes for this subscription must remain synchronized with Stripe. Modules remain editable here.",
          )}
        </p>
      ) : null}

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`rounded-lg px-3.5 py-3 text-sm ${state.status === "error" ? "bg-danger-pale text-danger" : "bg-success-pale text-success"}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
