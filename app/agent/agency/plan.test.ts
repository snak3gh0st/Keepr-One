import { describe, expect, it } from "vitest";
import {
  currentOrLatestAgencyPlanSubscription,
  getActiveDirectInvitedSubagencySubscription,
  isCurrentAgencyPlanSubscription,
  type AgencyPlanSubscription,
  type DirectInvitedSubagencyCandidate,
} from "./plan";

const now = new Date("2026-08-27T18:00:00.000Z");

function subscription(
  overrides: Partial<AgencyPlanSubscription> = {},
): AgencyPlanSubscription {
  return {
    status: "ACTIVE",
    unitAmountCents: 8_990,
    currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
    currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function childAgency(
  overrides: Partial<DirectInvitedSubagencyCandidate> = {},
): DirectInvitedSubagencyCandidate {
  return {
    owner: {
      invitation: {
        agencyId: "parent-agency",
        status: "ACCEPTED",
        acceptedPlan: "AGENCY",
      },
    },
    subscriptions: [subscription()],
    ...overrides,
  };
}

describe("agency subscription summary", () => {
  it("recognizes only an entitling subscription inside its billing window", () => {
    expect(isCurrentAgencyPlanSubscription(subscription(), now)).toBe(true);
    expect(isCurrentAgencyPlanSubscription(subscription({ status: "PAST_DUE" }), now)).toBe(false);
    expect(isCurrentAgencyPlanSubscription(subscription({ currentPeriodEnd: now }), now)).toBe(false);
    expect(isCurrentAgencyPlanSubscription(subscription({
      currentPeriodStart: new Date("2026-08-28T00:00:00.000Z"),
    }), now)).toBe(false);
  });

  it("prefers a current row over newer non-entitling billing history", () => {
    const current = subscription();
    expect(currentOrLatestAgencyPlanSubscription([
      subscription({ status: "CANCELED", unitAmountCents: 9_990 }),
      current,
    ], now)).toBe(current);
  });

  it("counts only active direct subagencies proven by an accepted Agency invitation", () => {
    expect(getActiveDirectInvitedSubagencySubscription(
      childAgency(),
      "parent-agency",
      now,
    )).toMatchObject({ status: "ACTIVE", unitAmountCents: 8_990 });

    expect(getActiveDirectInvitedSubagencySubscription(
      childAgency({
        owner: {
          invitation: {
            agencyId: "another-agency",
            status: "ACCEPTED",
            acceptedPlan: "AGENCY",
          },
        },
      }),
      "parent-agency",
      now,
    )).toBeNull();

    expect(getActiveDirectInvitedSubagencySubscription(
      childAgency({ subscriptions: [subscription({ status: "PAST_DUE" })] }),
      "parent-agency",
      now,
    )).toBeNull();
  });

  it("keeps an active historical price visible without classifying it as the new discount", () => {
    expect(getActiveDirectInvitedSubagencySubscription(
      childAgency({ subscriptions: [subscription({ unitAmountCents: 9_990 })] }),
      "parent-agency",
      now,
    )).toMatchObject({ status: "ACTIVE", unitAmountCents: 9_990 });
  });
});
