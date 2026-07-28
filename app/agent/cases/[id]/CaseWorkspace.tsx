"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { CrmNavigation } from "@/components/CrmNavigation";
import { CaseStagePill, PolicyStatusPill } from "@/components/StatusPill";
import { PageHeader } from "@/components/PageHeader";
import { ModuleSummary } from "@/components/ModuleSummary";
import { caseStageLabel, type CaseStage } from "@/lib/case-workflow";
import { computeNeedsAnalysis, type NeedsAnalysisInput } from "@/lib/needs-analysis";
import { formatMoney } from "@/lib/format";
import { transitionCase, updateRequirement, startApplication, saveNeedsAnalysis, addCaseNote, addFollowUp, completeFollowUp } from "./actions";

type Requirement = { id: string; title: string; status: string };
type Application = { id: string; status: string; requirements: Requirement[] };

type CaseData = {
  id: string;
  stage: CaseStage;
  status: string;
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
  nextStages: CaseStage[];
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
};

const PRODUCT_LABEL: Record<string, string> = { TERM: "Term", IUL: "IUL", UNDECIDED: "A definir" };
const OBJECTIVE_LABEL: Record<string, string> = {
  PROTECTION: "Proteção",
  ACCUMULATION: "Acumulação",
  RETIREMENT: "Aposentadoria",
  LEGACY: "Legado",
};
const REQ_LABEL: Record<string, string> = { OPEN: "Pendente", RECEIVED: "Recebido", WAIVED: "Dispensado" };

function activityTitle(type: string, title: string) {
  if (title === "Caso criado") return "Atendimento iniciado";
  if (title === "Needs analysis atualizada") return "Análise de necessidades atualizada";
  if (type === "STAGE_CHANGED") return title.replace("Etapa alterada", "Etapa atualizada");
  return title;
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
  return (
    <section className="module-main-surface">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Fluxo do atendimento</p>
      <h2 className="mt-2 text-xl font-medium tracking-[-0.035em] text-ink">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}

const NEEDS_FIELDS: { key: keyof NeedsAnalysisInput; label: string }[] = [
  { key: "annualIncome", label: "Renda anual ($)" },
  { key: "incomeYears", label: "Anos de reposição de renda" },
  { key: "mortgageBalance", label: "Saldo da hipoteca ($)" },
  { key: "otherDebts", label: "Outras dívidas ($)" },
  { key: "finalExpenses", label: "Despesas finais ($)" },
  { key: "children", label: "Filhos" },
  { key: "educationPerChild", label: "Educação por filho ($)" },
  { key: "existingCoverage", label: "Cobertura existente ($)" },
  { key: "liquidAssets", label: "Ativos líquidos ($)" },
];

const usd = formatMoney;
const TOBACCO_LABEL: Record<string, string> = { NON_TOBACCO: "Não fumante", TOBACCO: "Fumante" };

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
            <span className="text-xs text-ink-muted">{f.label}</span>
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
          Necessidade bruta {usd(preview.grossNeed)} − recursos {usd(preview.resources)}
        </div>
        <div className="text-lg font-semibold text-ink">
          Recomendado: {usd(preview.recommendedCoverage)}
        </div>
      </div>
      <Button variant="primary" disabled={pending || saving} onClick={save}>
        {saved ? "Recalcular e salvar" : "Salvar análise de necessidades"}
      </Button>
      {saved && (
        <p className="text-xs text-ink-muted">
          Última atualização: {new Date(saved.savedAt).toLocaleString("pt-BR")} · define a cobertura-alvo da oportunidade.
        </p>
      )}
    </div>
  );
}

export function CaseWorkspace({ caseData: c }: { caseData: CaseData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const forward = c.nextStages.filter((s) => s !== "WITHDRAWN");
  const primary = forward[0] ?? null;
  const age = ageFrom(c.prospect.dateOfBirth);

  function move(stage: CaseStage) {
    if (stage === "WITHDRAWN" && !window.confirm("Encerrar esta oportunidade? Esta ação é definitiva e não pode ser desfeita.")) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await transitionCase(c.id, stage);
      if (result.ok) router.refresh();
      else setMessage(result.message);
    });
  }

  function setRequirement(id: string, status: "RECEIVED" | "WAIVED" | "OPEN") {
    startTransition(async () => {
      const result = await updateRequirement(id, status);
      if (result.ok) router.refresh();
      else setMessage(result.message);
    });
  }

  function beginApplication() {
    setMessage(null);
    startTransition(async () => {
      const result = await startApplication(c.id);
      if (result.ok) router.refresh();
      else setMessage(result.message);
    });
  }

  const hasApplication = c.applications.length > 0;
  const requirements = c.applications.flatMap((application) => application.requirements);
  const openRequirements = requirements.filter((requirement) => requirement.status === "OPEN").length;

  const [note, setNote] = useState("");
  const [fuTitle, setFuTitle] = useState("");
  const [fuDue, setFuDue] = useState("");

  function submitNote() {
    if (!note.trim()) return;
    setMessage(null);
    startTransition(async () => {
      const result = await addCaseNote(c.id, note);
      if (result.ok) { setNote(""); router.refresh(); } else setMessage(result.message);
    });
  }

  function submitFollowUp() {
    if (!fuTitle.trim() || !fuDue) return;
    setMessage(null);
    startTransition(async () => {
      const result = await addFollowUp(c.id, fuTitle, fuDue);
      if (result.ok) { setFuTitle(""); setFuDue(""); router.refresh(); } else setMessage(result.message);
    });
  }

  function markFollowUpDone(id: string) {
    startTransition(async () => {
      const result = await completeFollowUp(id);
      if (result.ok) router.refresh(); else setMessage(result.message);
    });
  }

  const todayISO = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <CrmNavigation active="opportunities" />
      <PageHeader
        title={c.prospect.name}
        eyebrow="CRM · Oportunidade em andamento"
        description={
          <div className="space-y-3">
            <CaseStagePill stage={c.stage} />
            <p>
              {OBJECTIVE_LABEL[c.objective ?? ""] ?? "—"} · {PRODUCT_LABEL[c.productType ?? ""] ?? c.productType ?? "—"} · {c.carrier ?? "—"}
            </p>
          </div>
        }
      >
        <Link href="/agent/cases" className="inline-flex items-center border border-white/15 px-4 py-2.5 text-sm font-semibold text-paper hover:bg-white/[0.06]">
          ← Voltar às oportunidades
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {primary && (
            <Button
              variant="primary"
              className="!bg-paper !text-ink hover:!bg-panel"
              disabled={pending}
              onClick={() => move(primary)}
            >
              Avançar para {caseStageLabel[primary]}
            </Button>
          )}
          {c.nextStages
            .filter((s) => s !== primary)
            .map((s) => (
              <Button
                key={s}
                variant={s === "WITHDRAWN" ? "danger" : "secondary"}
                className={s === "WITHDRAWN" ? "" : "!border-white/15 !bg-white/[0.06] !text-paper hover:!bg-white/[0.12]"}
                disabled={pending}
                onClick={() => move(s)}
              >
                {caseStageLabel[s]}
              </Button>
            ))}
          {c.nextStages.length === 0 && <span className="text-sm text-ink-muted">Oportunidade encerrada.</span>}
        </div>
      </PageHeader>

      <ModuleSummary
        label={`Resumo da oportunidade de ${c.prospect.name}`}
        items={[
          { label: "Agente responsável", value: c.agentName, detail: "Responsável atual pelo atendimento", compact: true },
          { label: "Cobertura alvo", value: c.targetCoverage ?? "—", detail: "Proteção estimada para esta oportunidade", tone: "green" },
          { label: "Orçamento mensal", value: c.monthlyBudget ? `${c.monthlyBudget}/m` : "—", detail: "Faixa mensal informada pelo cliente" },
          { label: "Pendências", value: openRequirements, detail: `${requirements.length} pendências no total`, tone: openRequirements > 0 ? "gold" : "neutral" },
        ]}
      />
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}

      <Section title="Resumo">
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div><dt className="text-xs text-ink-muted">Agente</dt><dd className="text-sm text-ink">{c.agentName}</dd></div>
          <div><dt className="text-xs text-ink-muted">Estado</dt><dd className="text-sm text-ink">{c.prospect.state ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">Idade</dt><dd className="text-sm text-ink">{age ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">Tabaco</dt><dd className="text-sm text-ink">{c.prospect.tobaccoStatus ? (TOBACCO_LABEL[c.prospect.tobaccoStatus] ?? c.prospect.tobaccoStatus) : "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">E-mail</dt><dd className="text-sm text-ink">{c.prospect.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">Telefone</dt><dd className="text-sm text-ink">{c.prospect.phone ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">Cobertura alvo</dt><dd className="text-sm text-ink">{c.targetCoverage ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-muted">Orçamento mensal</dt><dd className="text-sm text-ink">{c.monthlyBudget ? `${c.monthlyBudget}/m` : "—"}</dd></div>
        </dl>
      </Section>

      <Section title="Análise de necessidades">
        <NeedsAnalysisForm
          caseId={c.id}
          saved={c.needsAnalysis}
          pending={pending}
          onSaved={() => router.refresh()}
          onError={(m) => setMessage(m || null)}
        />
      </Section>

      <Section title="Ilustrações">
        {c.illustrations.length === 0 ? (
          <Empty>Nenhuma ilustração ainda. Ilustrações formais chegam da seguradora ou por importação — nenhum valor é inventado aqui.</Empty>
        ) : (
          <ul className="divide-y divide-border-steel">
            {c.illustrations.map((il) => (
              <li key={il.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-ink">{il.productName ?? "Ilustração"} · {il.kind === "PRELIMINARY" ? "Estimativa" : "Oficial"}</span>
                <span className="font-mono text-ink-muted">{il.faceAmount ?? "—"} · {il.premium ? `${il.premium}/m` : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Aplicação">
        {!hasApplication ? (
          <div className="space-y-3">
            <Empty>Nenhuma aplicação iniciada. Ao iniciar, uma lista padrão de pendências é criada para acompanhamento.</Empty>
            <Button variant="primary" disabled={pending} onClick={beginApplication}>
              Iniciar aplicação
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {c.applications.map((app) => (
              <li key={app.id} className="text-sm text-ink">Aplicação · {app.status}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pendências">
        {requirements.length === 0 ? (
          <Empty>Nenhuma pendência. Elas aparecem quando a seguradora solicita documentos durante a análise.</Empty>
        ) : (
          <ul className="divide-y divide-border-steel">
            {requirements.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-ink">{r.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted">{REQ_LABEL[r.status] ?? r.status}</span>
                    {r.status === "OPEN" && (
                      <>
                        <Button variant="secondary" disabled={pending} onClick={() => setRequirement(r.id, "RECEIVED")}>Recebido</Button>
                        <Button variant="secondary" disabled={pending} onClick={() => setRequirement(r.id, "WAIVED")}>Dispensar</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section title="Apólices">
        {c.policies.length === 0 ? (
          <Empty>Nenhuma apólice vinculada. A apólice surge quando a oportunidade chega à emissão ou por importação autorizada de histórico.</Empty>
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

      <Section title="Histórico do atendimento">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
              placeholder="Registrar nota (ligação, e-mail, decisão)…"
              className="min-h-11 flex-1 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-teal focus:ring-[3px] focus:ring-teal-pale"
            />
            <Button variant="secondary" disabled={pending || !note.trim()} onClick={submitNote}>Anotar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              value={fuTitle}
              onChange={(e) => setFuTitle(e.target.value)}
              placeholder="Agendar retorno…"
              className="min-h-11 min-w-[12rem] flex-1 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-teal focus:ring-[3px] focus:ring-teal-pale"
            />
            <input
              type="date"
              min={todayISO}
              value={fuDue}
              onChange={(e) => setFuDue(e.target.value)}
              className="min-h-11 rounded-xl border border-border-steel bg-paper px-3.5 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] focus:border-teal focus:ring-[3px] focus:ring-teal-pale"
            />
            <Button variant="secondary" disabled={pending || !fuTitle.trim() || !fuDue} onClick={submitFollowUp}>Agendar</Button>
          </div>
        </div>

        {c.timeline.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">Sem eventos ainda.</p>
        ) : (
          <ol className="mt-4 space-y-3">
            {c.timeline.map((t) => {
              const isFollowUp = t.type === "FOLLOW_UP";
              const open = isFollowUp && !t.doneAt;
              const overdue = open && t.dueAt != null && new Date(t.dueAt) < new Date();
              return (
                <li key={t.id} className={`border-l-2 pl-3 ${overdue ? "border-danger" : open ? "border-gold" : "border-border-steel"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {isFollowUp && (
                          <span aria-hidden className="mr-2 inline-flex rounded-full bg-teal-pale px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-teal">
                            retorno
                          </span>
                        )}
                        {activityTitle(t.type, t.title)}
                        {t.doneAt && <span className="ml-2 text-xs font-normal text-success">✓ concluído</span>}
                        {overdue && <span className="ml-2 text-xs font-normal text-danger">atrasado</span>}
                      </p>
                      {t.body && <p className="text-xs text-ink-muted">{t.body}</p>}
                      <p className="text-xs text-ink-muted">
                        {t.dueAt ? `Vence ${new Date(t.dueAt).toLocaleDateString("pt-BR")}` : new Date(t.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    {open && (
                      <Button variant="secondary" disabled={pending} onClick={() => markFollowUpDone(t.id)}>Concluir</Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}
