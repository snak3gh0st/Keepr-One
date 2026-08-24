import { caseStageLabel } from "@/lib/case-workflow";
import type { CrmStageView } from "@/lib/crm";

type Tone = "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-pale text-success",
  warning: "bg-gold-pale text-gold-ink",
  danger: "bg-danger-pale text-danger",
  neutral: "bg-panel text-ink-muted",
};

const policyStatusTone: Record<string, Tone> = {
  INFORCE: "success",
  APPROVED: "success",
  PENDING: "warning",
  LAPSED: "danger",
  CANCELLED: "danger",
};

export const policyStatusLabel: Record<string, string> = {
  INFORCE: "Em vigor",
  APPROVED: "Aprovada",
  PENDING: "Pendente",
  LAPSED: "Lapsada",
  CANCELLED: "Cancelada",
};

const importStatusTone: Record<string, Tone> = {
  COMPLETED: "success",
  COMPLETED_WITH_ERRORS: "warning",
  FAILED: "danger",
  PROCESSING: "neutral",
};

const importStatusLabel: Record<string, string> = {
  COMPLETED: "Concluído",
  COMPLETED_WITH_ERRORS: "Concluído com erros",
  FAILED: "Falhou",
  PROCESSING: "Processando",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const dotClasses: Record<Tone, string> = {
    success: "bg-success",
    warning: "bg-gold-ink",
    danger: "bg-danger",
    neutral: "bg-ink-muted",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold tracking-wide ${toneClasses[tone]}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />
      {children}
    </span>
  );
}

export function PolicyStatusPill({ status }: { status: string }) {
  return (
    <Pill tone={policyStatusTone[status] ?? "neutral"}>
      {policyStatusLabel[status] ?? status}
    </Pill>
  );
}

export function ImportStatusPill({ status }: { status: string }) {
  return (
    <Pill tone={importStatusTone[status] ?? "neutral"}>
      {importStatusLabel[status] ?? status}
    </Pill>
  );
}

const caseStageTone: Record<string, Tone> = {
  APPROVED: "success",
  ISSUED: "success",
  PLACED: "success",
  DECLINED: "danger",
  WITHDRAWN: "neutral",
};

export function CaseStagePill({ stage }: { stage: string }) {
  return (
    <Pill tone={caseStageTone[stage] ?? "warning"}>
      {caseStageLabel[stage as keyof typeof caseStageLabel] ?? stage}
    </Pill>
  );
}

const crmStageTone: Record<string, Tone> = {
  NEW_LEAD: "neutral",
  FOLLOW_UP: "warning",
  IN_CONTACT: "warning",
  QUALIFIED: "success",
  FIRST_MEETING_SCHEDULED: "success",
  ILLUSTRATION_SCHEDULED: "success",
  CONTRACT_CLOSED: "success",
  POLICY_ISSUED: "success",
  ACTIVE_CLIENT: "success",
  LOST: "danger",
};

export function CrmStagePill({
  stage,
}: {
  stage: Pick<CrmStageView, "name" | "systemKey"> | null;
}) {
  if (!stage) return <Pill tone="neutral">Sem etapa</Pill>;
  return <Pill tone={crmStageTone[stage.systemKey ?? ""] ?? "neutral"}>{stage.name}</Pill>;
}

export function RolePill({ role }: { role: string }) {
  const label =
    role === "ADMIN" ? "Admin" : role === "AGENT" ? "Agente" : "Cliente";
  return <Pill tone="neutral">{label}</Pill>;
}
