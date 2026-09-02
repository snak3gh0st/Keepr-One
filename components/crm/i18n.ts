import type { CrmStageView } from "@/lib/crm";

type Copy = (
  portuguese: string,
  english: string,
  values?: Record<string, string | number>,
) => string;

const DEFAULT_STAGE_COPY: Record<string, readonly [string, string]> = {
  NEW_LEAD: ["Novo Lead", "New Lead"],
  FOLLOW_UP: ["Follow-up", "Follow-up"],
  IN_CONTACT: ["Em Contato", "In Contact"],
  QUALIFIED: ["Qualificado", "Qualified"],
  FIRST_MEETING_SCHEDULED: ["Primeira Reunião Marcada", "First Meeting Scheduled"],
  RESCHEDULE_FIRST_MEETING: ["Reagendar Primeira Reunião", "Reschedule First Meeting"],
  CREATE_ILLUSTRATION: ["Fazer Ilustração", "Create Illustration"],
  ILLUSTRATION_SCHEDULED: ["Ilustração Agendada", "Illustration Scheduled"],
  RESCHEDULE_ILLUSTRATION: ["Reagendar Ilustração", "Reschedule Illustration"],
  CONTRACT_CLOSED: ["Contrato Fechado", "Contract Closed"],
  APPLICATION: ["Aplicação", "Application"],
  POLICY_ISSUED: ["Apólice Emitida", "Policy Issued"],
  ACTIVE_CLIENT: ["Cliente Ativo", "Active Client"],
  LOST: ["Perdido", "Lost"],
};

const STORED_STAGE_COPY = new Map(
  Object.values(DEFAULT_STAGE_COPY).map(([portuguese, english]) => [
    portuguese,
    [portuguese, english] as const,
  ]),
);

export function localizedCrmStageName(
  copy: Copy,
  stage: Pick<CrmStageView, "name" | "systemKey">,
) {
  if (!stage.systemKey) return stage.name;
  const labels = DEFAULT_STAGE_COPY[stage.systemKey];
  return labels ? copy(labels[0], labels[1]) : stage.name;
}

export function localizedCrmStage<T extends Pick<CrmStageView, "name" | "systemKey">>(
  copy: Copy,
  stage: T | null,
): T | null {
  return stage ? { ...stage, name: localizedCrmStageName(copy, stage) } : null;
}

/**
 * Older timeline rows only persisted the stage's display name, not its
 * systemKey. Translate exact Keepr One defaults while preserving every custom
 * stage name verbatim.
 */
export function localizedStoredCrmStageName(copy: Copy, name: string) {
  const value = STORED_STAGE_COPY.get(name.trim());
  return value ? copy(value[0], value[1]) : name;
}

export function localizedCrmTimelineTitle(copy: Copy, type: string, title: string) {
  if (type === "CRM_STAGE_CHANGED") {
    const patterns: Array<{
      expression: RegExp;
      portuguese: string;
      english: string;
    }> = [
      { expression: /^Lead movido para (.+)$/, portuguese: "Lead movido para {stage}", english: "Lead moved to {stage}" },
      { expression: /^Lead avançou para (.+)$/, portuguese: "Lead avançou para {stage}", english: "Lead advanced to {stage}" },
      { expression: /^Etapa alterada para (.+)$/, portuguese: "Etapa alterada para {stage}", english: "Stage changed to {stage}" },
    ];
    for (const pattern of patterns) {
      const match = pattern.expression.exec(title);
      if (match) {
        return copy(pattern.portuguese, pattern.english, {
          stage: localizedStoredCrmStageName(copy, match[1]),
        });
      }
    }
  }
  const canonical: Record<string, readonly [string, string]> = {
    FOLLOW_UP_SCHEDULED: ["Follow-up agendado", "Follow-up scheduled"],
    FOLLOW_UP_RESCHEDULED: ["Follow-up reagendado", "Follow-up rescheduled"],
    FOLLOW_UP_COMPLETED: ["Follow-up realizado", "Follow-up completed"],
    FOLLOW_UP_CANCELLED: ["Follow-up cancelado", "Follow-up canceled"],
  };
  const value = canonical[type];
  if (value && title === value[0]) return copy(value[0], value[1]);
  return title;
}

export function localizedCrmTimelineBody(copy: Copy, type: string, body: string | null) {
  if (!body) return body;
  if (type === "CRM_STAGE_CHANGED") {
    const movement = /^De (.+) para (.+?)( porque a etapa anterior foi removida| por avanço técnico)?\.$/.exec(body);
    if (movement) {
      const values = {
        from: localizedStoredCrmStageName(copy, movement[1]),
        to: localizedStoredCrmStageName(copy, movement[2]),
      };
      if (movement[3] === " porque a etapa anterior foi removida") {
        return copy(
          "De {from} para {to} porque a etapa anterior foi removida.",
          "From {from} to {to} because the previous stage was removed.",
          values,
        );
      }
      if (movement[3] === " por avanço técnico") {
        return copy(
          "De {from} para {to} por avanço técnico.",
          "From {from} to {to} due to workflow progress.",
          values,
        );
      }
      return copy("De {from} para {to}.", "From {from} to {to}.", values);
    }
    const defined = /^Etapa definida como (.+)\.$/.exec(body);
    if (defined) {
      return copy("Etapa definida como {stage}.", "Stage set to {stage}.", {
        stage: localizedStoredCrmStageName(copy, defined[1]),
      });
    }
  }
  if (type === "FOLLOW_UP_SCHEDULED") {
    const scheduled = /^(.*) para (\d{2})\/(\d{2})\/(\d{4}) às (\d{2}:\d{2})\.$/.exec(body);
    if (scheduled) {
      return copy(
        "{title} para {day}/{month}/{year} às {time}.",
        "{title} for {month}/{day}/{year} at {time}.",
        { title: scheduled[1], day: scheduled[2], month: scheduled[3], year: scheduled[4], time: scheduled[5] },
      );
    }
  }
  if (type === "FOLLOW_UP_RESCHEDULED") {
    const rescheduled = /^De (\d{2})\/(\d{2})\/(\d{4}) às (\d{2}:\d{2}) para (\d{2})\/(\d{2})\/(\d{4}) às (\d{2}:\d{2})\.$/.exec(body);
    if (rescheduled) {
      return copy(
        "De {fromDay}/{fromMonth}/{fromYear} às {fromTime} para {toDay}/{toMonth}/{toYear} às {toTime}.",
        "From {fromMonth}/{fromDay}/{fromYear} at {fromTime} to {toMonth}/{toDay}/{toYear} at {toTime}.",
        {
          fromDay: rescheduled[1], fromMonth: rescheduled[2], fromYear: rescheduled[3], fromTime: rescheduled[4],
          toDay: rescheduled[5], toMonth: rescheduled[6], toYear: rescheduled[7], toTime: rescheduled[8],
        },
      );
    }
  }
  return body;
}
