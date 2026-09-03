"use client";

import { caseStageLabel } from "@/lib/case-workflow";
import type { CrmStageView } from "@/lib/crm";
import { useI18n } from "@/components/i18n/LanguageProvider";

type Tone = "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-pale text-success",
  warning: "bg-gold-pale text-gold-ink",
  danger: "bg-danger-pale text-danger",
  neutral: "bg-panel text-ink-muted",
};

const policyStatusTone: Record<string, Tone> = {
  INFORCE: "success",
  PENDING_LAPSE: "warning",
  APPROVED: "success",
  PENDING: "warning",
  LAPSED: "danger",
  CANCELLED: "danger",
};

export const policyStatusLabel: Record<string, string> = {
  INFORCE: "Em vigor",
  PENDING_LAPSE: "Pending Lapse",
  APPROVED: "Aprovada",
  PENDING: "Pendente",
  LAPSED: "Lapsada",
  CANCELLED: "Cancelada",
};

const policyStatusLabelEn: Record<string, string> = {
  INFORCE: "In force",
  PENDING_LAPSE: "Pending Lapse",
  APPROVED: "Approved",
  PENDING: "Pending",
  LAPSED: "Lapsed",
  CANCELLED: "Canceled",
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

const importStatusLabelEn: Record<string, string> = {
  COMPLETED: "Completed",
  COMPLETED_WITH_ERRORS: "Completed with errors",
  FAILED: "Failed",
  PROCESSING: "Processing",
};

const caseStageLabelEn: Record<string, string> = {
  LEAD: "Lead",
  DISCOVERY: "Discovery",
  DESIGN: "Design",
  ILLUSTRATION_READY: "Illustration ready",
  APPLICATION_STARTED: "Application started",
  SUBMITTED: "Submitted",
  UNDERWRITING: "Underwriting",
  APPROVED: "Approved",
  ISSUED: "Issued",
  PLACED: "In force",
  DECLINED: "Declined",
  WITHDRAWN: "Withdrawn",
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
  const { language } = useI18n();
  return (
    <Pill tone={policyStatusTone[status] ?? "neutral"}>
      {(language === "EN" ? policyStatusLabelEn[status] : policyStatusLabel[status]) ?? status}
    </Pill>
  );
}

export function ImportStatusPill({ status }: { status: string }) {
  const { language } = useI18n();
  return (
    <Pill tone={importStatusTone[status] ?? "neutral"}>
      {(language === "EN" ? importStatusLabelEn[status] : importStatusLabel[status]) ?? status}
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
  const { language } = useI18n();
  return (
    <Pill tone={caseStageTone[stage] ?? "warning"}>
      {(language === "EN"
        ? caseStageLabelEn[stage]
        : caseStageLabel[stage as keyof typeof caseStageLabel]) ?? stage}
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
  const { copy } = useI18n();
  if (!stage) return <Pill tone="neutral">{copy("Sem etapa", "No stage")}</Pill>;
  return <Pill tone={crmStageTone[stage.systemKey ?? ""] ?? "neutral"}>{stage.name}</Pill>;
}

export function RolePill({ role }: { role: string }) {
  const { copy } = useI18n();
  const label =
    role === "ADMIN"
      ? copy("Admin", "Admin")
      : role === "AGENT"
        ? copy("Agente", "Agent")
        : copy("Cliente", "Client");
  return <Pill tone="neutral">{label}</Pill>;
}
