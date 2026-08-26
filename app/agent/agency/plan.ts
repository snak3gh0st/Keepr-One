export const INVITATION_VALIDITY_DAYS = 14;

export type AgencyActionState = {
  status: "idle" | "success" | "error";
  message: string;
  invitationUrl?: string;
};

export const INITIAL_AGENCY_ACTION_STATE: AgencyActionState = {
  status: "idle",
  message: "",
};
