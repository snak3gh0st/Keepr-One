import { describe, expect, it } from "vitest";
import { resolveAgencyInvitationPlanAccess } from "./plan-access";

describe("resolveAgencyInvitationPlanAccess", () => {
  it("allows an agency invite to promote a member linked directly to the inviter", () => {
    expect(resolveAgencyInvitationPlanAccess({
      activeMemberships: [{ role: "MEMBER", agencyId: "agency-inviter" }],
      intendedType: "AGENCY",
      inviterAgencyId: "agency-inviter",
      isFounder: false,
    })).toEqual({
      allowedPlans: ["AGENCY"],
      planRestriction: "PROMOTE_DIRECT_MEMBER",
    });
  });

  it("does not let a member of another agency move through this promotion path", () => {
    expect(resolveAgencyInvitationPlanAccess({
      activeMemberships: [{ role: "MEMBER", agencyId: "agency-other" }],
      intendedType: "AGENCY",
      inviterAgencyId: "agency-inviter",
      isFounder: false,
    })).toEqual({
      allowedPlans: [],
      planRestriction: "ACTIVE_MEMBER",
    });
  });

  it("keeps legacy invitations blocked for an already linked member", () => {
    expect(resolveAgencyInvitationPlanAccess({
      activeMemberships: [{ role: "MEMBER", agencyId: "agency-inviter" }],
      intendedType: null,
      inviterAgencyId: "agency-inviter",
      isFounder: false,
    })).toEqual({
      allowedPlans: [],
      planRestriction: "ACTIVE_MEMBER",
    });
  });
});
