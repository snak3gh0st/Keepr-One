import type { UserLanguage } from "@/lib/i18n/config";

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

const statusTone: Record<string, Tone> = {
  INFORCE: "success",
  APPROVED: "success",
  PENDING: "warning",
  LAPSED: "danger",
  CANCELLED: "danger",
};

const labels: Record<UserLanguage, Record<string, string>> = {
  PT: {
    INFORCE: "Em vigor",
    APPROVED: "Aprovada",
    PENDING: "Pendente",
    LAPSED: "Lapsada",
    CANCELLED: "Cancelada",
  },
  EN: {
    INFORCE: "In force",
    APPROVED: "Approved",
    PENDING: "Pending",
    LAPSED: "Lapsed",
    CANCELLED: "Cancelled",
  },
};

export function LocalizedPolicyStatusPill({ status, language }: { status: string; language: UserLanguage }) {
  const tone = statusTone[status] ?? "neutral";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-semibold tracking-wide ${toneClasses[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotClasses[tone]}`} />
      {labels[language][status] ?? status}
    </span>
  );
}
