import { describe, expect, it } from "vitest";
import {
  PROMOTION_RANKS,
  getPromotionIdentity,
  getPromotionJourney,
} from "./promotion-journey";

describe("getPromotionJourney", () => {
  it("preserves the promotion guide thresholds exactly", () => {
    expect(
      PROMOTION_RANKS.map(
        ({ title, personalTarget, agencyTarget, agencyPersonalMinimum }) => ({
          title,
          personalTarget,
          agencyTarget,
          agencyPersonalMinimum,
        }),
      ),
    ).toEqual([
      {
        title: "District Leader",
        personalTarget: 5_000,
        agencyTarget: 5_000,
        agencyPersonalMinimum: 2_500,
      },
      {
        title: "Division Leader",
        personalTarget: 20_000,
        agencyTarget: 20_000,
        agencyPersonalMinimum: 5_000,
      },
      {
        title: "Regional Leader",
        personalTarget: 40_000,
        agencyTarget: 40_000,
        agencyPersonalMinimum: 10_000,
      },
      {
        title: "Agency Vice President",
        personalTarget: 60_000,
        agencyTarget: 120_000,
        agencyPersonalMinimum: 30_000,
      },
      {
        title: "Regional Vice President",
        personalTarget: 84_000,
        agencyTarget: 240_000,
        agencyPersonalMinimum: 25_000,
      },
      {
        title: "National Vice President",
        personalTarget: 108_000,
        agencyTarget: 360_000,
        agencyPersonalMinimum: 20_000,
      },
      {
        title: "Senior Vice President",
        personalTarget: 132_000,
        agencyTarget: 480_000,
        agencyPersonalMinimum: 15_000,
      },
      {
        title: "Executive Vice President",
        personalTarget: 156_000,
        agencyTarget: 600_000,
        agencyPersonalMinimum: 10_000,
      },
    ]);
  });

  it("starts below District Leader with a proportional personal progress", () => {
    const journey = getPromotionJourney({
      personalPc: 2_500,
      agencyPc: 2_500,
      mode: "individual",
    });

    expect(journey.currentRank).toBeNull();
    expect(journey.nextRank?.title).toBe("District Leader");
    expect(journey.stages[0].status).toBe("current");
    expect(journey.stages[0].progress).toBe(0.5);
  });

  it("promotes an individual at the exact District Leader threshold", () => {
    const journey = getPromotionJourney({
      personalPc: 5_000,
      agencyPc: 5_000,
      mode: "individual",
    });

    expect(journey.currentRank?.title).toBe("District Leader");
    expect(journey.nextRank?.title).toBe("Division Leader");
    expect(journey.stages[0].status).toBe("achieved");
    expect(journey.stages[0].achievement).toBe("qualified");
    expect(journey.stages[1].status).toBe("current");
    expect(journey.stages[1].achievement).toBeNull();
  });

  it("requires agency PC and the personal minimum together", () => {
    const journey = getPromotionJourney({
      personalPc: 2_499,
      agencyPc: 5_000,
      mode: "agency",
    });

    expect(journey.currentRank).toBeNull();
    expect(journey.stages[0].progress).toBeCloseTo(2_499 / 2_500);
    expect(journey.stages[0].qualifies).toBe(false);
  });

  it("qualifies the agency at the exact combined threshold", () => {
    const journey = getPromotionJourney({
      personalPc: 2_500,
      agencyPc: 5_000,
      mode: "agency",
    });

    expect(journey.currentRank?.title).toBe("District Leader");
    expect(journey.stages[0].qualifies).toBe(true);
    expect(journey.stages[0].qualificationRoute).toBe("agency");
  });

  it("uses personal production as an alternative route in agency mode", () => {
    const journey = getPromotionJourney({
      personalPc: 60_000,
      agencyPc: 20_000,
      mode: "agency",
    });
    const blueStage = journey.stages[3];

    expect(journey.currentRank?.title).toBe("Agency Vice President");
    expect(journey.qualificationRoute).toBe("personal");
    expect(blueStage.qualifies).toBe(true);
    expect(blueStage.qualificationRoute).toBe("personal");
    expect(blueStage.personalProgress).toBe(1);
    expect(blueStage.agencyProgress).toBeCloseTo(20_000 / 120_000);
    expect(blueStage.progress).toBe(1);
    expect(blueStage.personalRemaining).toBe(0);
    expect(blueStage.agencyRemaining).toBe(100_000);
    expect(blueStage.agencyPersonalRemaining).toBe(0);
  });

  it("uses the agency route only when agency PC and its personal minimum are met", () => {
    const journey = getPromotionJourney({
      personalPc: 30_000,
      agencyPc: 120_000,
      mode: "agency",
    });
    const blueStage = journey.stages[3];

    expect(journey.currentRank?.title).toBe("Agency Vice President");
    expect(journey.qualificationRoute).toBe("agency");
    expect(blueStage.qualificationRoute).toBe("agency");
    expect(blueStage.personalProgress).toBe(0.5);
    expect(blueStage.agencyPersonalProgress).toBe(1);
    expect(blueStage.agencyProgress).toBe(1);
    expect(blueStage.progress).toBe(1);
    expect(blueStage.personalRemaining).toBe(30_000);
    expect(blueStage.agencyRemaining).toBe(0);
    expect(blueStage.agencyPersonalRemaining).toBe(0);
  });

  it("renders the Blue Jacket preview at its exact agency thresholds", () => {
    const journey = getPromotionJourney({
      personalPc: 60_000,
      agencyPc: 120_000,
      mode: "agency",
    });

    expect(journey.currentRank?.title).toBe("Agency Vice President");
    expect(journey.currentRank?.jacket).toBe("Blue Jacket");
    expect(journey.currentRank?.jacketTone).toBe("blue");
    expect(journey.nextRank?.title).toBe("Regional Vice President");
    expect(journey.stages[3].qualifies).toBe(true);
    expect(journey.stages[4].status).toBe("current");
  });

  it("uses each agency rank's own personal minimum instead of chaining them", () => {
    const journey = getPromotionJourney({
      personalPc: 25_000,
      agencyPc: 240_000,
      mode: "agency",
    });

    expect(journey.currentRank?.title).toBe("Regional Vice President");
    expect(journey.currentRank?.jacket).toBe("Red Jacket");
    expect(journey.stages[3].qualifies).toBe(false);
    expect(journey.stages[3].status).toBe("achieved");
    expect(journey.stages[3].achievement).toBe("inherited");
    expect(journey.stages[4].qualifies).toBe(true);
    expect(journey.stages[4].achievement).toBe("qualified");
  });

  it("reaches Black Jacket through individual production", () => {
    const journey = getPromotionJourney({
      personalPc: 156_000,
      agencyPc: 156_000,
      mode: "individual",
    });

    expect(journey.finalReached).toBe(true);
    expect(journey.currentRank?.jacket).toBe("Black Jacket");
    expect(journey.nextRank).toBeNull();
    expect(journey.overallProgress).toBe(1);
  });

  it("reaches Black Jacket through agency production and personal minimum", () => {
    const journey = getPromotionJourney({
      personalPc: 10_000,
      agencyPc: 600_000,
      mode: "agency",
    });

    expect(journey.finalReached).toBe(true);
    expect(journey.currentRank?.title).toBe("Executive Vice President");
    expect(journey.qualificationRoute).toBe("agency");
    expect(journey.overallProgress).toBe(1);
    expect(journey.personalProgress).toBeCloseTo(10_000 / 156_000);
    expect(journey.agencyProgress).toBe(1);
    expect(journey.agencyPersonalProgress).toBe(1);
  });

  it("keeps the Black Jacket progress limited by the personal minimum", () => {
    const journey = getPromotionJourney({
      personalPc: 5_000,
      agencyPc: 600_000,
      mode: "agency",
    });
    const blackStage = journey.stages.at(-1);

    expect(blackStage?.agencyPersonalProgress).toBe(0.5);
    expect(blackStage?.agencyProgress).toBe(0.5);
    expect(blackStage?.personalProgress).toBeCloseTo(5_000 / 156_000);
    expect(blackStage?.progress).toBe(0.5);
    expect(blackStage?.qualifies).toBe(false);
  });

  it("uses the strongest partial route for overall Black Jacket progress", () => {
    const personalRoute = getPromotionJourney({
      personalPc: 78_000,
      agencyPc: 60_000,
      mode: "agency",
    });
    const agencyRoute = getPromotionJourney({
      personalPc: 10_000,
      agencyPc: 300_000,
      mode: "agency",
    });

    expect(personalRoute.personalProgress).toBe(0.5);
    expect(personalRoute.agencyProgress).toBe(0.1);
    expect(personalRoute.overallProgress).toBe(0.5);

    expect(agencyRoute.personalProgress).toBeCloseTo(10_000 / 156_000);
    expect(agencyRoute.agencyProgress).toBe(0.5);
    expect(agencyRoute.overallProgress).toBe(0.5);
  });

  it("ignores agency production for an individual account", () => {
    const journey = getPromotionJourney({
      personalPc: 0,
      agencyPc: 600_000,
      mode: "individual",
    });

    expect(journey.currentRank).toBeNull();
    expect(journey.qualificationRoute).toBeNull();
    expect(journey.overallProgress).toBe(0);
    expect(journey.personalProgress).toBe(0);
    expect(journey.agencyProgress).toBeNull();
    expect(journey.agencyPersonalProgress).toBeNull();
    expect(journey.agencyRemaining).toBeNull();
    expect(journey.agencyPersonalRemaining).toBeNull();
  });

  it.each([
    [60_000, "blue", "Agency Vice President"],
    [84_000, "red", "Regional Vice President"],
    [108_000, "green", "National Vice President"],
    [132_000, "purple", "Senior Vice President"],
    [156_000, "black", "Executive Vice President"],
  ])(
    "maps %d personal PC to the %s jacket identity",
    (personalPc, jacketTone, title) => {
      const journey = getPromotionJourney({
        personalPc,
        agencyPc: personalPc,
        mode: "individual",
      });

      expect(journey.currentRank?.title).toBe(title);
      expect(journey.currentRank?.jacketTone).toBe(jacketTone);
      expect(getPromotionIdentity(journey)).toMatchObject({
        tone: jacketTone,
        rankTitle: title,
      });
    },
  );

  it.each([
    [5_000, "District Leader"],
    [20_000, "Division Leader"],
    [40_000, "Regional Leader"],
  ])(
    "keeps the standard shell identity at %d personal PC (%s)",
    (personalPc, title) => {
      const journey = getPromotionJourney({
        personalPc,
        agencyPc: personalPc,
        mode: "individual",
      });

      expect(getPromotionIdentity(journey)).toEqual({
        tone: "standard",
        rankTitle: title,
        jacket: null,
      });
    },
  );

  it("clamps chargeback-heavy and invalid totals to zero", () => {
    const journey = getPromotionJourney({
      personalPc: -400,
      agencyPc: Number.NaN,
      mode: "agency",
    });

    expect(journey.personalPc).toBe(0);
    expect(journey.agencyPc).toBe(0);
    expect(journey.overallProgress).toBe(0);
    expect(journey.stages[0].personalRemaining).toBe(5_000);
    expect(journey.stages[0].agencyRemaining).toBe(5_000);
    expect(journey.stages[0].agencyPersonalRemaining).toBe(2_500);
  });
});
