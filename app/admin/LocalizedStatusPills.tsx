"use client";

import { useI18n } from "@/components/i18n/LanguageProvider";

type Tone = "success" | "warning" | "danger" | "neutral";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-pale text-success",
  warning: "bg-gold-pale text-gold-ink",
  danger: "bg-danger-pale text-danger",
  neutral: "bg-panel text-ink-muted",
};

const dotClasses: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-gold-ink",
  danger: "bg-danger",
  neutral: "bg-ink-muted",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold tracking-wide ${toneClasses[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />
      {children}
    </span>
  );
}

export function LocalizedRolePill({ role }: { role: string }) {
  const { copy } = useI18n();
  const label = role === "ADMIN"
    ? "Admin"
    : role === "AGENT"
      ? copy("Agente", "Agent")
      : copy("Cliente", "Client");
  return <Pill tone="neutral">{label}</Pill>;
}

export function LocalizedImportStatusPill({ status }: { status: string }) {
  const { copy } = useI18n();
  const statuses: Record<string, { tone: Tone; label: string }> = {
    COMPLETED: { tone: "success", label: copy("Concluído", "Completed") },
    COMPLETED_WITH_ERRORS: { tone: "warning", label: copy("Concluído com erros", "Completed with errors") },
    FAILED: { tone: "danger", label: copy("Falhou", "Failed") },
    PROCESSING: { tone: "neutral", label: copy("Processando", "Processing") },
  };
  const localized = statuses[status] ?? { tone: "neutral" as const, label: status };
  return <Pill tone={localized.tone}>{localized.label}</Pill>;
}
