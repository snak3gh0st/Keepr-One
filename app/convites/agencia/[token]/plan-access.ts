export type AgencyInvitationAcceptedPlan = "AGENT_AGENCY_MEMBER" | "AGENCY";
export type AgencyInvitationIntendedType = "AGENT" | "AGENCY";
export type AgencyInvitationPlanRestriction =
  | "OWNED_AGENCY"
  | "FOUNDER"
  | "ACTIVE_MEMBER"
  | "PROMOTE_DIRECT_MEMBER"
  | null;

type ActiveAgencyMembership = {
  role: "OWNER" | "MEMBER";
  agencyId: string;
};

export function resolveAgencyInvitationPlanAccess({
  activeMemberships,
  intendedType,
  inviterAgencyId,
  isFounder,
}: {
  activeMemberships: readonly ActiveAgencyMembership[];
  intendedType: AgencyInvitationIntendedType | null;
  inviterAgencyId: string;
  isFounder: boolean;
}): {
  allowedPlans: AgencyInvitationAcceptedPlan[];
  planRestriction: AgencyInvitationPlanRestriction;
} {
  let allowedPlans: AgencyInvitationAcceptedPlan[] = [
    "AGENT_AGENCY_MEMBER",
    "AGENCY",
  ];
  let planRestriction: AgencyInvitationPlanRestriction = null;

  if (activeMemberships.length > 1) {
    allowedPlans = [];
    planRestriction = "ACTIVE_MEMBER";
  } else {
    const activeMembership = activeMemberships[0];

    if (activeMembership?.role === "MEMBER") {
      const canPromoteDirectMember =
        intendedType === "AGENCY"
        && activeMembership.agencyId === inviterAgencyId;

      allowedPlans = canPromoteDirectMember ? ["AGENCY"] : [];
      planRestriction = canPromoteDirectMember
        ? "PROMOTE_DIRECT_MEMBER"
        : "ACTIVE_MEMBER";
    } else if (activeMembership?.role === "OWNER") {
      allowedPlans = ["AGENCY"];
      planRestriction = "OWNED_AGENCY";
    } else if (isFounder) {
      allowedPlans = ["AGENCY"];
      planRestriction = "FOUNDER";
    }
  }

  if (intendedType) {
    const requiredPlan: AgencyInvitationAcceptedPlan = intendedType === "AGENT"
      ? "AGENT_AGENCY_MEMBER"
      : "AGENCY";
    allowedPlans = allowedPlans.filter((plan) => plan === requiredPlan);
  }

  return { allowedPlans, planRestriction };
}
