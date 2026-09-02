"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { CrmNavigation } from "@/components/CrmNavigation";
import { PolicyStatusPill } from "@/components/StatusPill";
import { PageHeader } from "@/components/PageHeader";
import { ModuleSummary } from "@/components/ModuleSummary";
import { computeNeedsAnalysis, type NeedsAnalysisInput } from "@/lib/needs-analysis";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { CrmStageView } from "@/lib/crm";
import { CrmStageSelect } from "@/components/crm/CrmStageSelect";
import { localizedCrmTimelineBody, localizedCrmTimelineTitle } from "@/components/crm/i18n";
import { FollowUpModal } from "@/components/crm/FollowUpModal";
import { FollowUpPanel } from "@/components/crm/FollowUpPanel";
import { CaseMeetingsSection, caseMeetingCopy } from "@/components/calendar/CaseMeetingsSection";
import type {
  CalendarConnectionView,
  CalendarEventInput,
  CalendarEventView,
  CalendarMutationResult,
  CalendarSourceView,
} from "@/components/calendar/types";
import {
  cancelCalendarEventAction,
  checkCalendarAvailabilityAction,
  createCalendarEventAction,
  retryCalendarEventSyncAction,
  updateCalendarEventAction,
} from "@/app/agent/calendar/actions";
import { moveCaseAndScheduleAction, moveCaseStageAction } from "../actions";
import {
  updateRequirement,
  saveNeedsAnalysis,
  addCaseNote,
  cancelCaseFollowUp,
  completeCaseFollowUp,
  rescheduleCaseFollowUp,
  scheduleCaseFollowUp,
} from "./actions";
import { ApplicationDossier } from "./ApplicationDossier";

const CalendarEventModal = dynamic(
  () =>
    import("@/components/calendar/CalendarEventModal").then(
      (module) => module.CalendarEventModal,
    ),
  { ssr: false },
);

type Requirement = { id: string; title: string; status: string };
type Application = {
  id: string;
  status: string;
  automationState: string;
  dossier: unknown;
  dossierHash: string | null;
  reviewedAt: string | null;
  externalId: string | null;
  carrierReceipt: unknown;
  documents: Array<{
    id: string;
    type: string;
    filename: string;
    reviewedAt: string | null;
  }>;
  requirements: Requirement[];
};

type CaseData = {
  id: string;
  crmStage: Pick<CrmStageView, "id" | "name" | "systemKey"> | null;
  crmStages: CrmStageView[];
  objective: string | null;
  productType: string | null;
  carrier: string | null;
  targetCoverage: string | null;
  monthlyBudget: string | null;
  needsAnalysis: {
    input: Record<string, number>;
    result: { grossNeed: number; resources: number; recommendedCoverage: number };
    savedAt: string;
  } | null;
  prospect: {
    name: string;
    email: string | null;
    phone: string | null;
    state: string | null;
    tobaccoStatus: string | null;
    dateOfBirth: string | null;
  };
  agentName: string;
  illustrations: { id: string; kind: string; productName: string | null; faceAmount: string | null; premium: string | null }[];
  applications: Application[];
  applicationAddon: {
    entitled: boolean;
    status: string | null;
    canAutomate: boolean;
  };
  policies: { id: string; policyNumber: string; carrier: string; product: string; status: string }[];
  timeline: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    createdAt: string;
    dueAt: string | null;
    doneAt: string | null;
  }[];
  followUps: {
    id: string;
    title: string;
    scheduledAt: string;
    status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
    completedAt: string | null;
    cancelledAt: string | null;
  }[];
  calendar: {
    canManage: boolean;
    connection: CalendarConnectionView;
    calendars: CalendarSourceView[];
    timeZone: string;
    events: CalendarEventView[];
  };
  now: string;
};

function activityTitle(type: string, title: string, copy: (pt: string, en: string, values?: Record<string, string | number>) => string) {
  if (title === "Caso criado") return copy("Atendimento iniciado", "Case started");
  if (title === "Needs analysis atualizada") return copy("Análise de necessidades atualizada", "Needs analysis updated");
  if (title === "Aplicação iniciada") return copy("Aplicação iniciada", "Application started");
  if (type === "NOTE" && title === "Nota") return copy("Nota", "Note");
  const calendarTitles: Record<string, readonly [string, string]> = {
    CALENDAR_EVENT_CREATED: ["Compromisso criado", "Event created"],
    CALENDAR_EVENT_UPDATED: ["Compromisso atualizado", "Event updated"],
    CALENDAR_EVENT_CANCELLED: ["Compromisso cancelado", "Event canceled"],
    CALENDAR_EVENT_ASSOCIATED: ["Compromisso associado ao lead", "Event linked to lead"],
    MEETING_CANCELLED_FROM_GOOGLE: ["Reunião cancelada pelo Google Calendar", "Meeting canceled in Google Calendar"],
    MEETING_UPDATED_FROM_GOOGLE: ["Reunião atualizada pelo Google Calendar", "Meeting updated in Google Calendar"],
    MEETING_ATTENDEE_RESPONSE: ["Participante respondeu ao convite", "Guest responded to the invitation"],
  };
  const calendarTitle = calendarTitles[type];
  if (calendarTitle) return copy(calendarTitle[0], calendarTitle[1]);
  return localizedCrmTimelineTitle(copy, type, title);
}

function activityBody(type: string, body: string | null, locale: string, copy: (pt: string, en: string, values?: Record<string, string | number>) => string) {
  if (!body) return null;
  if (type === "CRM_STAGE_CHANGED" || type.startsWith("FOLLOW_UP")) {
    return localizedCrmTimelineBody(copy, type, body);
  }
  if (type === "CASE_CREATED") {
    const registered = body.match(/^Prospect (.+) registrado\.$/);
    if (registered) return copy("Prospect {name} registrado.", "Prospect {name} registered.", { name: registered[1] });
  }
  if (type === "APPLICATION_STARTED") {
    const count = body.match(/\d+/)?.[0] ?? "5";
    return copy("Checklist padrão criado com {count} pendências.", "Standard checklist created with {count} pending items.", { count });
  }
  if (type === "NEEDS_ANALYSIS") {
    const coverage = body.match(/\$[\d,.]+/)?.[0];
    const amount = coverage ? Number(coverage.replace(/[$,]/g, "")) : Number.NaN;
    if (Number.isFinite(amount)) {
      const formatted = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount);
      return copy("Cobertura recomendada: {coverage}.", "Recommended coverage: {coverage}.", { coverage: formatted });
    }
  }
  if (type.startsWith("CALENDAR_") || type.startsWith("MEETING_")) {
    let translated = body
      .replace(" · De ", ` · ${copy("De ", "From ")}`)
      .replace(" para ", copy(" para ", " to "))
      .replaceAll(" · dia inteiro", ` · ${copy("dia inteiro", "all day")}`)
      .replace("data a definir", copy("data a definir", "date TBD"))
      .replace("horário a definir", copy("horário a definir", "time TBD"))
      .replace(" confirmou presença.", copy(" confirmou presença.", " accepted."))
      .replace(" recusou o convite.", copy(" recusou o convite.", " declined."))
      .replace(" respondeu talvez.", copy(" respondeu talvez.", " responded maybe."))
      .replace(" voltou a aguardar resposta.", copy(" voltou a aguardar resposta.", " is awaiting a response again."));
    if (copy("PT", "EN") === "EN") {
      translated = translated.replace(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g, "$2/$1/$3");
    }
    return translated;
  }
  return body;
}

function requirementTitle(title: string, copy: (pt: string, en: string) => string) {
  const standard: Record<string, string> = {
    "Formulário de aplicação assinado": copy("Formulário de aplicação assinado", "Signed application form"),
    "Documento de identidade": copy("Documento de identidade", "Identity document"),
    "Exame médico / paramédico": copy("Exame médico / paramédico", "Medical / paramedical exam"),
    "Autorização HIPAA": copy("Autorização HIPAA", "HIPAA authorization"),
    "Comprovante de pagamento inicial": copy("Comprovante de pagamento inicial", "Initial payment receipt"),
  };
  return standard[title] ?? title;
}

function ageFrom(iso: string | null): number | null {
  if (!iso) return null;
  const dob = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { copy } = useI18n();
  return (
    <section className="module-main-surface">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{copy("Fluxo do atendimento", "Case workflow")}</p>
      <h2 className="mt-2 text-xl font-medium tracking-[-0.035em] text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}

const NEEDS_FIELDS: { key: keyof NeedsAnalysisInput; pt: string; en: string }[] = [
  { key: "annualIncome", pt: "Renda anual ($)", en: "Annual income ($)" },
  { key: "incomeYears", pt: "Anos de reposição de renda", en: "Years of income replacement" },
  { key: "mortgageBalance", pt: "Saldo da hipoteca ($)", en: "Mortgage balance ($)" },
  { key: "otherDebts", pt: "Outras dívidas ($)", en: "Other debts ($)" },
  { key: "finalExpenses", pt: "Despesas finais ($)", en: "Final expenses ($)" },
  { key: "children", pt: "Filhos", en: "Children" },
  { key: "educationPerChild", pt: "Educação por filho ($)", en: "Education per child ($)" },
  { key: "existingCoverage", pt: "Cobertura existente ($)", en: "Existing coverage ($)" },
  { key: "liquidAssets", pt: "Ativos líquidos ($)", en: "Liquid assets ($)" },
];

function NeedsAnalysisForm({
  caseId,
  saved,
  pending,
  onSaved,
  onError,
}: {
  caseId: string;
  saved: CaseData["needsAnalysis"];
  pending: boolean;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const { copy, locale } = useI18n();
  const usd = (value: number) => new Intl.NumberFormat(locale, {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(value);
  const dateTime = new Intl.DateTimeFormat(locale, {
    timeZone: "America/New_York", dateStyle: "short", timeStyle: "short",
  });
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      NEEDS_FIELDS.map((f) => [
        f.key,
        String(saved?.input?.[f.key] ?? (f.key === "incomeYears" ? 10 : 0)),
      ]),
    ),
  );
  const [saving, startSave] = useTransition();

  const input = Object.fromEntries(
    NEEDS_FIELDS.map((f) => [f.key, Number(values[f.key]) || 0]),
  ) as unknown as NeedsAnalysisInput;
  const preview = computeNeedsAnalysis(input);

  function save() {
    onError("");
    startSave(async () => {
      const result = await saveNeedsAnalysis(caseId, input as unknown as Record<string, number>);
      if (result.ok) onSaved();
      else onError(result.message);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {NEEDS_FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="text-xs text-ink-muted">{copy(f.pt, f.en)}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="mt-1 min-h-11 w-full rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-teal focus:ring-[3px] focus:ring-teal-pale"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-teal-pale px-4 py-3">
        <div className="text-sm text-ink-muted">
          {copy("Necessidade bruta", "Gross need")} {usd(preview.grossNeed)} − {copy("recursos", "resources")} {usd(preview.resources)}
        </div>
        <div className="text-lg font-semibold text-ink">
          {copy("Recomendado:", "Recommended:")} {usd(preview.recommendedCoverage)}
        </div>
      </div>
      <Button variant="primary" disabled={pending || saving} onClick={save}>
        {saved ? copy("Recalcular e salvar", "Recalculate and save") : copy("Salvar análise de necessidades", "Save needs analysis")}
      </Button>
      {saved && (
        <p className="text-xs text-ink-muted">
          {copy("Última atualização: {date} · define a cobertura-alvo da oportunidade.", "Last updated: {date} · defines the opportunity's target coverage.", { date: dateTime.format(new Date(saved.savedAt)) })}
        </p>
      )}
    </div>
  );
}

export function CaseWorkspace({ caseData: c }: { caseData: CaseData }) {
  const { copy, language, locale } = useI18n();
  const productLabel: Record<string, string> = { TERM: "Term", IUL: "IUL", UNDECIDED: copy("A definir", "Undecided") };
  const objectiveLabel: Record<string, string> = {
    PROTECTION: copy("Proteção", "Protection"), ACCUMULATION: copy("Acumulação", "Accumulation"),
    RETIREMENT: copy("Aposentadoria", "Retirement"), LEGACY: copy("Legado", "Legacy"),
  };
  const requirementLabel: Record<string, string> = {
    OPEN: copy("Pendente", "Pending"), RECEIVED: copy("Recebido", "Received"), WAIVED: copy("Dispensado", "Waived"),
  };
  const tobaccoLabel: Record<string, string> = {
    NO: copy("Nunca fumou", "Never smoked"), FORMER: copy("Ex-fumante", "Former smoker"),
    YES: copy("Fumante", "Smoker"), NON_TOBACCO: copy("Não fumante", "Non-smoker"),
    TOBACCO: copy("Fumante", "Smoker"),
  };
  const crmDate = new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", dateStyle: "short" });
  const crmDateTime = new Intl.DateTimeFormat(locale, { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" });
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [stageFollowUpId, setStageFollowUpId] = useState<string | null>(null);
  const [calendarModal, setCalendarModal] = useState<
    | { mode: "create" }
    | { mode: "details" | "edit"; event: CalendarEventView }
    | null
  >(null);

  const age = ageFrom(c.prospect.dateOfBirth);

  function setRequirement(id: string, status: "RECEIVED" | "WAIVED" | "OPEN") {
    startTransition(async () => {
      const result = await updateRequirement(id, status);
      if (result.ok) router.refresh();
      else setMessage(result.message);
    });
  }

  const hasApplication = c.applications.length > 0;
  const requirements = c.applications.flatMap((application) => application.requirements);
  const openRequirements = requirements.filter((requirement) => requirement.status === "OPEN").length;
  const meetingCopy = caseMeetingCopy(c.crmStage?.systemKey ?? null, c.prospect.name, language);

  async function mutateCalendar(
    action: (input: CalendarEventInput) => Promise<CalendarMutationResult>,
    input: CalendarEventInput,
  ) {
    const result = await action(input);
    if (result.ok) router.refresh();
    return result;
  }

  async function cancelCalendar(event: CalendarEventView) {
    const result = await cancelCalendarEventAction({
      id: event.id,
      baseRevision: event.localRevision,
      sendInvites: true,
    });
    if (result.ok) router.refresh();
    return result;
  }

  const [note, setNote] = useState("");

  function submitNote() {
    if (!note.trim()) return;
    setMessage(null);
    startTransition(async () => {
      const result = await addCaseNote(c.id, note);
      if (result.ok) { setNote(""); router.refresh(); } else setMessage(result.message);
    });
  }
  return (
    <div className="space-y-4">
      <CrmNavigation active="opportunities" />
      <PageHeader
        title={c.prospect.name}
        eyebrow={copy("CRM · Oportunidade em andamento", "CRM · Opportunity in progress")}
        description={
          <div className="space-y-3">
            <CrmStageSelect
              caseId={c.id}
              stage={c.crmStage}
              stages={c.crmStages}
              onChange={async (caseId, stageId) => {
                const result = await moveCaseStageAction(caseId, stageId);
                if (result.ok) router.refresh();
                return result;
              }}
              onFollowUpRequired={setStageFollowUpId}
            />
            <p>
              {objectiveLabel[c.objective ?? ""] ?? "—"} · {productLabel[c.productType ?? ""] ?? c.productType ?? "—"} · {c.carrier ?? "—"}
            </p>
          </div>
        }
      >
        <Link
          href="/agent/cases"
          className="module-detail-back"
          aria-label={copy("Voltar para o CRM", "Back to CRM")}
        >
          <span className="module-detail-back-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="m11.75 5.25-4.5 4.75 4.5 4.75M7.5 10h7.25" />
            </svg>
          </span>
          <span>{copy("Voltar para o CRM", "Back to CRM")}</span>
        </Link>
        <Link
          href="/agent/activities"
          className="inline-flex min-h-11 items-center rounded-full border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-paper transition-colors hover:bg-white/[0.12]"
        >
          {copy("Ver atividades", "View activities")} <span aria-hidden className="ml-2">↗</span>
        </Link>
        {c.calendar.canManage && c.calendar.connection.status === "CONNECTED" ? (
          <button
            type="button"
            onClick={() => setCalendarModal({ mode: "create" })}
            className="inline-flex min-h-11 items-center rounded-full bg-paper px-4 text-sm font-semibold text-rail-strong transition-transform duration-300 hover:-translate-y-0.5"
          >
            {copy("Agendar reunião", "Schedule meeting")} <span aria-hidden className="ml-2">＋</span>
          </button>
        ) : null}
      </PageHeader>

      <ModuleSummary
        label={copy("Resumo da oportunidade de {name}", "Opportunity summary for {name}", { name: c.prospect.name })}
        items={[
          { label: copy("Agente responsável", "Assigned agent"), value: c.agentName, detail: copy("Responsável atual pelo atendimento", "Current owner of the case"), compact: true },
          { label: copy("Cobertura alvo", "Target coverage"), value: c.targetCoverage ?? "—", detail: copy("Proteção estimada para esta oportunidade", "Estimated protection for this opportunity"), tone: "green" },
          { label: copy("Orçamento mensal", "Monthly budget"), value: c.monthlyBudget ? `${c.monthlyBudget}${copy("/mês", "/mo")}` : "—", detail: copy("Faixa mensal informada pelo cliente", "Monthly range provided by the client") },
          { label: copy("Pendências", "Pending items"), value: openRequirements, detail: copy("{count} pendências no total", "{count} pending items total", { count: requirements.length }), tone: openRequirements > 0 ? "gold" : "neutral" },
        ]}
      />
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}

      <Section title={copy("Resumo", "Summary")}>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div><dt className="text-xs text-ink-muted">{copy("Agente", "Agent")}</dt><dd className="text-sm text-ink">{c.agentName}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("Estado", "State")}</dt><dd className="text-sm text-ink">{c.prospect.state ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("Idade", "Age")}</dt><dd className="text-sm text-ink">{age ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("Tabaco", "Tobacco")}</dt><dd className="text-sm text-ink">{c.prospect.tobaccoStatus ? (tobaccoLabel[c.prospect.tobaccoStatus] ?? c.prospect.tobaccoStatus) : "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("E-mail", "Email")}</dt><dd className="text-sm text-ink">{c.prospect.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("Telefone", "Phone")}</dt><dd className="text-sm text-ink">{c.prospect.phone ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("Cobertura alvo", "Target coverage")}</dt><dd className="text-sm text-ink">{c.targetCoverage ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">{copy("Orçamento mensal", "Monthly budget")}</dt><dd className="text-sm text-ink">{c.monthlyBudget ? `${c.monthlyBudget}${copy("/mês", "/mo")}` : "—"}</dd></div>
        </dl>
      </Section>

      <Section title={copy("Análise de necessidades", "Needs analysis")}>
        <NeedsAnalysisForm
          caseId={c.id}
          saved={c.needsAnalysis}
          pending={pending}
          onSaved={() => router.refresh()}
          onError={(m) => setMessage(m || null)}
        />
      </Section>

      <Section title={copy("Ilustrações", "Illustrations")}>
        {c.illustrations.length === 0 ? (
          <Empty>{copy("Nenhuma ilustração ainda. Ilustrações formais chegam da seguradora ou por importação — nenhum valor é inventado aqui.", "No illustrations yet. Formal illustrations arrive from the carrier or through import—no values are invented here.")}</Empty>
        ) : (
          <ul className="divide-y divide-border-steel">
            {c.illustrations.map((il) => (
              <li key={il.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">{il.productName ?? copy("Ilustração", "Illustration")} · {il.kind === "PRELIMINARY" ? copy("Estimativa", "Estimate") : copy("Oficial", "Official")}</span>
                <span className="font-mono text-ink-muted">{il.faceAmount ?? "—"} · {il.premium ? `${il.premium}${copy("/mês", "/mo")}` : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div id="application" className="scroll-mt-24">
        <Section title={copy("Aplicação", "Application")}>
          {!hasApplication ? (
            <div className="space-y-3">
              <Empty>
                {copy(
                  "Nenhuma Application iniciada. A Application deve nascer de uma Illustration com PDF oficial e valores confirmados pela National Life.",
                  "No Application has been started. The Application must originate from an Illustration with an official PDF and values confirmed by National Life.",
                )}
              </Empty>
              <Link
                href="/agent/illustrations?intent=application"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-teal-deep px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-teal"
              >
                {copy("Escolher Illustration oficial", "Choose official Illustration")}
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {c.applications.map((app) => (
                <ApplicationDossier
                  key={app.id}
                  application={app}
                  addon={c.applicationAddon}
                  prospect={c.prospect}
                  illustrations={c.illustrations}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title={copy("Pendências", "Pending items")}>
        {requirements.length === 0 ? (
          <Empty>{copy("Nenhuma pendência. Elas aparecem quando a seguradora solicita documentos durante a análise.", "No pending items. They appear when the carrier requests documents during underwriting.")}</Empty>
        ) : (
          <ul className="divide-y divide-border-steel">
            {requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-ink">{requirementTitle(r.title, copy)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted">{requirementLabel[r.status] ?? r.status}</span>
                    {r.status === "OPEN" && (
                      <>
                        <Button variant="secondary" disabled={pending} onClick={() => setRequirement(r.id, "RECEIVED")}>{copy("Recebido", "Received")}</Button>
                        <Button variant="secondary" disabled={pending} onClick={() => setRequirement(r.id, "WAIVED")}>{copy("Dispensar", "Waive")}</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title={copy("Apólices", "Policies")}>
        {c.policies.length === 0 ? (
          <Empty>{copy("Nenhuma apólice vinculada. A apólice surge quando a oportunidade chega à emissão ou por importação autorizada de histórico.", "No linked policy. A policy appears when the opportunity reaches issuance or through an authorized historical import.")}</Empty>
        ) : (
          <ul className="divide-y divide-border-steel">
            {c.policies.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <Link href={`/agent/policies/${p.id}`} className="text-sm font-medium text-teal hover:text-teal-deep">
                  <span className="font-mono">{p.policyNumber}</span> · {p.carrier} · {p.product}
                </Link>
                <PolicyStatusPill status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <FollowUpPanel
        now={c.now}
        prospectName={c.prospect.name}
        followUps={c.followUps}
        onSchedule={(input) => scheduleCaseFollowUp({ caseId: c.id, ...input })}
        onReschedule={(followUpId, input) =>
          rescheduleCaseFollowUp({ caseId: c.id, followUpId, ...input })
        }
        onComplete={(followUpId) => completeCaseFollowUp({ caseId: c.id, followUpId })}
        onCancel={(followUpId) => cancelCaseFollowUp({ caseId: c.id, followUpId })}
        onRefresh={() => router.refresh()}
      />

      <CaseMeetingsSection
        canManage={c.calendar.canManage}
        connection={c.calendar.connection}
        events={c.calendar.events}
        now={c.now}
        systemKey={c.crmStage?.systemKey ?? null}
        prospectName={c.prospect.name}
        onSchedule={() => setCalendarModal({ mode: "create" })}
        onOpen={(event) => setCalendarModal({ mode: "details", event })}
      />

      <Section title={copy("Histórico do atendimento", "Case history")}>
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
              placeholder={copy("Registrar nota (ligação, e-mail, decisão)…", "Record a note (call, email, decision)…")}
              className="min-h-11 flex-1 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-teal focus:ring-[3px] focus:ring-teal-pale"
            />
            <Button variant="secondary" disabled={pending || !note.trim()} onClick={submitNote}>{copy("Anotar", "Add note")}</Button>
          </div>
        </div>

        {c.timeline.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">{copy("Sem eventos ainda.", "No events yet.")}</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {c.timeline.map((t) => {
              const isFollowUp = t.type.startsWith("FOLLOW_UP");
              const overdue = t.dueAt != null && !t.doneAt && new Date(t.dueAt) < new Date(c.now);
              return (
                <li key={t.id} className={`border-l-2 pl-3 ${overdue ? "border-danger" : isFollowUp ? "border-gold" : "border-border-steel"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {isFollowUp && (
                          <span aria-hidden className="mr-2 inline-flex rounded-full bg-teal-pale px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-teal">
                            {copy("retorno", "follow-up")}
                          </span>
                        )}
                        {activityTitle(t.type, t.title, copy)}
                        {t.doneAt && <span className="ml-2 text-xs font-normal text-success">✓ {copy("concluído", "completed")}</span>}
                        {overdue && <span className="ml-2 text-xs font-normal text-danger">{copy("atrasado", "overdue")}</span>}
                      </p>
                      {activityBody(t.type, t.body, locale, copy) ? <p className="text-xs text-ink-muted">{activityBody(t.type, t.body, locale, copy)}</p> : null}
                      <p className="text-xs text-ink-muted">
                        {t.dueAt ? copy("Vence {date}", "Due {date}", { date: crmDate.format(new Date(t.dueAt)) }) : crmDateTime.format(new Date(t.createdAt))}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      <FollowUpModal
        key={stageFollowUpId ?? "closed"}
        open={Boolean(stageFollowUpId)}
        onClose={() => setStageFollowUpId(null)}
        prospectName={c.prospect.name}
        onSubmit={async ({ title, scheduledAt }) => {
          if (!stageFollowUpId) return { ok: false, message: copy("Etapa não encontrada.", "Stage not found.") };
          const result = await moveCaseAndScheduleAction({
            caseId: c.id,
            stageId: stageFollowUpId,
            title,
            scheduledAt,
          });
          if (result.ok) router.refresh();
          return result;
        }}
      />

      {calendarModal ? (
        <CalendarEventModal
          key={
            calendarModal.mode === "create"
              ? "create"
              : `${calendarModal.mode}:${calendarModal.event.id}`
          }
          open
          mode={calendarModal.mode}
          event={"event" in calendarModal ? calendarModal.event : null}
          initialCase={{ id: c.id, name: c.prospect.name, email: c.prospect.email, stage: c.crmStage?.name ?? null, stageSystemKey: c.crmStage?.systemKey ?? null }}
          initialTitle={meetingCopy.defaultTitle}
          timeZone={c.calendar.timeZone}
          calendars={c.calendar.calendars}
          cases={[{ id: c.id, name: c.prospect.name, email: c.prospect.email, stage: c.crmStage?.name ?? null, stageSystemKey: c.crmStage?.systemKey ?? null }]}
          onClose={() => setCalendarModal(null)}
          onSubmit={(input) => mutateCalendar(
            calendarModal.mode === "edit" ? updateCalendarEventAction : createCalendarEventAction,
            input,
          )}
          onRequestEdit={(event) => setCalendarModal({ mode: "edit", event })}
          onCancelEvent={cancelCalendar}
          onRetrySync={async (event) => {
            const result = await retryCalendarEventSyncAction({ id: event.id });
            if (result.ok) router.refresh();
            return result;
          }}
          onCheckAvailability={checkCalendarAvailabilityAction}
        />
      ) : null}
    </div>
  );
}
