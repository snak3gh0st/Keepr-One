export const AGENCY_INVITEE_TYPES = ["AGENT", "AGENCY"] as const;

export type AgencyInviteeTypeValue = (typeof AGENCY_INVITEE_TYPES)[number];

export const AGENCY_RECRUITMENT_STAGES = [
  "PROSPECT",
  "CONTACTED",
  "MEETING_SCHEDULED",
  "QUALIFIED",
  "INVITED",
  "ONBOARDING",
  "ACTIVE",
  "PAUSED",
  "DECLINED",
] as const;

export type AgencyRecruitmentStageValue =
  (typeof AGENCY_RECRUITMENT_STAGES)[number];

export const AGENCY_INVITEE_TYPE_LABEL: Record<AgencyInviteeTypeValue, string> = {
  AGENT: "Agente",
  AGENCY: "Agência",
};

export const AGENCY_RECRUITMENT_STAGE_LABEL: Record<
  AgencyRecruitmentStageValue,
  string
> = {
  PROSPECT: "Prospecto",
  CONTACTED: "Contato realizado",
  MEETING_SCHEDULED: "Reunião marcada",
  QUALIFIED: "Qualificado",
  INVITED: "Convite enviado",
  ONBOARDING: "Onboarding",
  ACTIVE: "Ativo",
  PAUSED: "Pausado",
  DECLINED: "Não seguirá",
};

const RECRUITMENT_STAGE_SET = new Set<string>(AGENCY_RECRUITMENT_STAGES);

export function sanitizeAgencyRecruitmentStage(
  value: string | null | undefined,
): AgencyRecruitmentStageValue | null {
  return value && RECRUITMENT_STAGE_SET.has(value)
    ? (value as AgencyRecruitmentStageValue)
    : null;
}

export function agencyRecruitmentStageLabel(
  value: string | null | undefined,
): string {
  const sanitized = sanitizeAgencyRecruitmentStage(value);
  return sanitized
    ? AGENCY_RECRUITMENT_STAGE_LABEL[sanitized]
    : "Etapa não informada";
}

export function agencyInviteeTypeLabel(
  value: string | null | undefined,
): string {
  return value === "AGENT" || value === "AGENCY"
    ? AGENCY_INVITEE_TYPE_LABEL[value]
    : "Definido no aceite";
}
