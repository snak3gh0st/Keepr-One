import { describe, expect, it } from "vitest";
import {
  getDurablePromotionIdentity,
  getLegacyPromotionAccessContext,
  getPromotionAttributionPredicates,
  getPromotionWindow,
  rollupPromotionCredits,
  subtractUtcMonths,
  type PromotionAttributionRow,
} from "./agent-promotion";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function row(
  input: Partial<PromotionAttributionRow> & {
    id: string;
    status: PromotionAttributionRow["promotionCredit"]["status"];
    creditedPc: number;
    carrier?: string;
    policyNumber?: string | null;
    createdAt?: Date;
  },
): PromotionAttributionRow {
  return {
    kind: input.kind ?? "PERSONAL",
    agentId: input.agentId ?? "agent-1",
    leaderAgentId: input.leaderAgentId ?? null,
    promotionCredit: {
      id: input.id,
      carrier: input.carrier ?? input.promotionCredit?.carrier,
      policyNumber: input.policyNumber ?? input.promotionCredit?.policyNumber,
      producerAgentId:
        input.promotionCredit?.producerAgentId ?? input.agentId ?? "agent-1",
      creditedPc: input.creditedPc,
      status: input.status,
      recognizedAt: input.promotionCredit?.recognizedAt ?? NOW,
      createdAt: input.createdAt ?? input.promotionCredit?.createdAt ?? NOW,
    },
  };
}

describe("promotion rolling window", () => {
  it("uses a rolling twelve-calendar-month window", () => {
    const { windowStart, windowEnd } = getPromotionWindow(NOW);

    expect(windowStart.toISOString()).toBe("2025-08-10T00:00:00.000Z");
    expect(windowEnd.toISOString()).toBe("2026-08-10T23:59:59.999Z");
  });

  it("includes the complete UTC dates shown at both window boundaries", () => {
    const { windowStart, windowEnd } = getPromotionWindow(NOW);

    expect(new Date("2025-08-10T00:00:00.000Z").getTime()).toBeGreaterThanOrEqual(
      windowStart.getTime(),
    );
    expect(new Date("2026-08-10T23:59:59.999Z").getTime()).toBeLessThanOrEqual(
      windowEnd.getTime(),
    );
    expect(new Date("2025-08-09T23:59:59.999Z").getTime()).toBeLessThan(
      windowStart.getTime(),
    );
    expect(new Date("2026-08-11T00:00:00.000Z").getTime()).toBeGreaterThan(
      windowEnd.getTime(),
    );
  });

  it("clamps leap-day subtraction instead of overflowing the month", () => {
    expect(
      subtractUtcMonths(new Date("2024-02-29T08:30:00.000Z"), 12).toISOString(),
    ).toBe("2023-02-28T08:30:00.000Z");
  });
});

describe("durable promotion identity", () => {
  it("keeps the highest earned jacket when rolling production later decreases", () => {
    expect(
      getDurablePromotionIdentity(
        { tone: "standard", rankTitle: null, jacket: null },
        "agency-vice-president",
      ),
    ).toEqual({
      tone: "blue",
      rankTitle: "Agency Vice President",
      jacket: "Blue Jacket",
    });
  });

  it("falls back to the current identity when no valid achievement exists", () => {
    const current = {
      tone: "green" as const,
      rankTitle: "National Vice President",
      jacket: "Green Jacket",
    };

    expect(getDurablePromotionIdentity(current, "unknown-rank")).toBe(current);
  });

  it("never lets a lower historical achievement downgrade the current rank", () => {
    const current = {
      tone: "green" as const,
      rankTitle: "National Vice President",
      jacket: "Green Jacket",
    };

    expect(
      getDurablePromotionIdentity(current, "agency-vice-president"),
    ).toBe(current);
  });
});

describe("promotion entitlement boundary", () => {
  it("uses hierarchy as a compatibility fallback only in development", () => {
    expect(getLegacyPromotionAccessContext(true, "development")).toEqual({
      mode: "agency",
      canViewAgencyJourney: true,
      hasAgencyStructure: true,
    });
  });

  it.each(["production", "test", undefined])(
    "fails closed when the entitlement field is absent in %s",
    (environment) => {
      expect(getLegacyPromotionAccessContext(true, environment)).toEqual({
        mode: "individual",
        canViewAgencyJourney: false,
        hasAgencyStructure: true,
      });
    },
  );

  it("keeps an agent without structure individual in every environment", () => {
    expect(getLegacyPromotionAccessContext(false, "development")).toEqual({
      mode: "individual",
      canViewAgencyJourney: false,
      hasAgencyStructure: false,
    });
  });

  it("does not include an agency predicate for a PERSONAL account", () => {
    expect(getPromotionAttributionPredicates("agent-1", false)).toEqual([
      { kind: "PERSONAL", agentId: "agent-1" },
    ]);
  });

  it("adds the leader predicate only for an AGENCY-entitled account", () => {
    expect(getPromotionAttributionPredicates("agent-1", true)).toEqual([
      { kind: "PERSONAL", agentId: "agent-1" },
      { kind: "AGENCY", leaderAgentId: "agent-1" },
    ]);
  });

  it("limits agency attribution queries to current subscribed members", () => {
    expect(
      getPromotionAttributionPredicates("agent-1", true, [
        "agent-1",
        "member-1",
      ]),
    ).toEqual([
      { kind: "PERSONAL", agentId: "agent-1" },
      {
        kind: "AGENCY",
        leaderAgentId: "agent-1",
        promotionCredit: {
          producerAgentId: { in: ["agent-1", "member-1"] },
        },
      },
    ]);
  });
});

describe("rollupPromotionCredits", () => {
  it("sums signed recognized deltas and keeps personal/team routes separate", () => {
    const result = rollupPromotionCredits(
      [
        row({ id: "personal", status: "CONFIRMED", creditedPc: 1_000 }),
        row({
          id: "personal-adjustment",
          status: "ADJUSTED",
          creditedPc: -100,
        }),
        row({
          id: "team",
          status: "CONFIRMED",
          creditedPc: 400,
          kind: "AGENCY",
          agentId: "agent-2",
          leaderAgentId: "agent-1",
          promotionCredit: {
            id: "team",
            producerAgentId: "agent-2",
            creditedPc: 400,
            status: "CONFIRMED",
            recognizedAt: NOW,
            createdAt: NOW,
          },
        }),
      ],
      "agent-1",
    );

    expect(result.personalPc).toBe(900);
    expect(result.agencyPc).toBe(1_300);
    expect(result.confirmedCreditCount).toBe(3);
  });

  it("does not double count a producer's own event in the agency view", () => {
    const personal = row({
      id: "same-event",
      status: "CONFIRMED",
      creditedPc: 750,
    });
    const accidentalSelfAgency: PromotionAttributionRow = {
      ...personal,
      kind: "AGENCY",
      leaderAgentId: "agent-1",
    };

    const result = rollupPromotionCredits(
      [personal, accidentalSelfAgency],
      "agent-1",
    );

    expect(result.personalPc).toBe(750);
    expect(result.agencyPc).toBe(750);
    expect(result.confirmedCreditCount).toBe(1);
  });

  it("credits the same production once to every frozen upline", () => {
    const agencyCredit = row({
      id: "multi-level-team-credit",
      status: "CONFIRMED",
      creditedPc: 750,
      kind: "AGENCY",
      agentId: "producer",
      leaderAgentId: "direct-leader",
      promotionCredit: {
        id: "multi-level-team-credit",
        producerAgentId: "producer",
        creditedPc: 750,
        status: "CONFIRMED",
        recognizedAt: NOW,
        createdAt: NOW,
      },
    });
    const seniorUpline: PromotionAttributionRow = {
      ...agencyCredit,
      leaderAgentId: "senior-upline",
    };

    expect(
      rollupPromotionCredits(
        [agencyCredit, seniorUpline],
        "direct-leader",
      ).agencyPc,
    ).toBe(750);
    expect(
      rollupPromotionCredits(
        [agencyCredit, seniorUpline],
        "senior-upline",
      ).agencyPc,
    ).toBe(750);
  });

  it("drops every agency value when the caller lacks agency entitlement", () => {
    const result = rollupPromotionCredits(
      [
        row({ id: "personal", status: "CONFIRMED", creditedPc: 500 }),
        row({
          id: "team-confirmed",
          status: "CONFIRMED",
          creditedPc: 2_000,
          kind: "AGENCY",
          agentId: "agent-2",
          leaderAgentId: "agent-1",
          promotionCredit: {
            id: "team-confirmed",
            producerAgentId: "agent-2",
            creditedPc: 2_000,
            status: "CONFIRMED",
            recognizedAt: NOW,
            createdAt: NOW,
          },
        }),
        row({
          id: "team-pending",
          status: "PENDING_CARRIER",
          creditedPc: 900,
          kind: "AGENCY",
          agentId: "agent-2",
          leaderAgentId: "agent-1",
          promotionCredit: {
            id: "team-pending",
            producerAgentId: "agent-2",
            creditedPc: 900,
            status: "PENDING_CARRIER",
            recognizedAt: NOW,
            createdAt: NOW,
          },
        }),
      ],
      "agent-1",
      false,
    );

    expect(result.personalPc).toBe(500);
    expect(result.agencyPc).toBe(0);
    expect(result.estimatedAgencyPc).toBe(0);
    expect(result.pendingAgencyPc).toBe(0);
    expect(result.confirmedCreditCount).toBe(1);
    expect(result.pendingCreditCount).toBe(0);
  });

  it("drops legacy hierarchy credits from producers outside the agency membership", () => {
    const result = rollupPromotionCredits(
      [
        row({ id: "personal", status: "CONFIRMED", creditedPc: 500 }),
        row({
          id: "linked-member",
          status: "CONFIRMED",
          creditedPc: 700,
          kind: "AGENCY",
          agentId: "member-1",
          leaderAgentId: "agent-1",
          promotionCredit: {
            id: "linked-member",
            producerAgentId: "member-1",
            creditedPc: 700,
            status: "CONFIRMED",
            recognizedAt: NOW,
            createdAt: NOW,
          },
        }),
        row({
          id: "legacy-downline",
          status: "CONFIRMED",
          creditedPc: 9_000,
          kind: "AGENCY",
          agentId: "individual-downline",
          leaderAgentId: "agent-1",
          promotionCredit: {
            id: "legacy-downline",
            producerAgentId: "individual-downline",
            creditedPc: 9_000,
            status: "CONFIRMED",
            recognizedAt: NOW,
            createdAt: NOW,
          },
        }),
      ],
      "agent-1",
      true,
      ["agent-1", "member-1"],
    );

    expect(result.personalPc).toBe(500);
    expect(result.agencyPc).toBe(1_200);
  });

  it("keeps estimates and carrier-pending PC out of confirmed promotion totals", () => {
    const result = rollupPromotionCredits(
      [
        row({ id: "estimate", status: "ESTIMATED", creditedPc: 2_000 }),
        row({ id: "pending", status: "PENDING_CARRIER", creditedPc: 1_500 }),
      ],
      "agent-1",
    );

    expect(result.personalPc).toBe(0);
    expect(result.agencyPc).toBe(0);
    expect(result.estimatedPersonalPc).toBe(2_000);
    expect(result.pendingPersonalPc).toBe(1_500);
    expect(result.estimatedCreditCount).toBe(1);
    expect(result.pendingCreditCount).toBe(1);
    expect(result.hasPromotionData).toBe(true);
  });

  it("suppresses provisional PC once the same carrier policy has a recognized event", () => {
    const result = rollupPromotionCredits(
      [
        row({
          id: "confirmed",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-100",
          status: "CONFIRMED",
          creditedPc: 1_200,
        }),
        row({
          id: "estimate",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-100",
          status: "ESTIMATED",
          creditedPc: 900,
        }),
        row({
          id: "pending",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-100",
          status: "PENDING_CARRIER",
          creditedPc: 1_100,
        }),
      ],
      "agent-1",
    );

    expect(result.personalPc).toBe(1_200);
    expect(result.estimatedPersonalPc).toBe(0);
    expect(result.pendingPersonalPc).toBe(0);
    expect(result.confirmedCreditCount).toBe(1);
    expect(result.estimatedCreditCount).toBe(0);
    expect(result.pendingCreditCount).toBe(0);
  });

  it("keeps only the latest provisional observation per carrier policy and bucket", () => {
    const result = rollupPromotionCredits(
      [
        row({
          id: "estimate-new",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-200",
          status: "ESTIMATED",
          creditedPc: 1_400,
          createdAt: new Date("2026-08-10T11:00:00.000Z"),
        }),
        row({
          id: "estimate-old",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-200",
          status: "ESTIMATED",
          creditedPc: 1_000,
          createdAt: new Date("2026-08-10T09:00:00.000Z"),
        }),
        row({
          id: "pending-old",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-200",
          status: "PENDING_CARRIER",
          creditedPc: 1_500,
          createdAt: new Date("2026-08-10T08:00:00.000Z"),
        }),
        row({
          id: "pending-new",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-200",
          status: "PENDING_CARRIER",
          creditedPc: 1_700,
          createdAt: new Date("2026-08-10T10:00:00.000Z"),
        }),
      ],
      "agent-1",
    );

    expect(result.estimatedPersonalPc).toBe(1_400);
    expect(result.pendingPersonalPc).toBe(1_700);
    expect(result.estimatedCreditCount).toBe(1);
    expect(result.pendingCreditCount).toBe(1);
  });

  it("does not correlate credits without a policy number or from another carrier", () => {
    const result = rollupPromotionCredits(
      [
        row({
          id: "recognized-without-policy",
          carrier: "NATIONAL_LIFE",
          status: "CONFIRMED",
          creditedPc: 100,
        }),
        row({
          id: "estimate-without-policy-1",
          carrier: "NATIONAL_LIFE",
          status: "ESTIMATED",
          creditedPc: 200,
        }),
        row({
          id: "estimate-without-policy-2",
          carrier: "NATIONAL_LIFE",
          status: "ESTIMATED",
          creditedPc: 300,
        }),
        row({
          id: "recognized-other-carrier",
          carrier: "OTHER_CARRIER",
          policyNumber: "NL-300",
          status: "CONFIRMED",
          creditedPc: 400,
        }),
        row({
          id: "pending-national-life",
          carrier: "NATIONAL_LIFE",
          policyNumber: "NL-300",
          status: "PENDING_CARRIER",
          creditedPc: 500,
        }),
      ],
      "agent-1",
    );

    expect(result.personalPc).toBe(500);
    expect(result.estimatedPersonalPc).toBe(500);
    expect(result.pendingPersonalPc).toBe(500);
    expect(result.confirmedCreditCount).toBe(2);
    expect(result.estimatedCreditCount).toBe(2);
    expect(result.pendingCreditCount).toBe(1);
  });
});
