import { describe, expect, it } from "vitest";
import {
  getPromotionIdentity,
  getPromotionJourney,
} from "./promotion-journey";

describe("getPromotionJourney", () => {
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
    expect(journey.stages[1].status).toBe("current");
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
    expect(journey.stages[4].qualifies).toBe(true);
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
    expect(journey.overallProgress).toBe(1);
  });

  it("keeps the Black Jacket progress limited by the personal minimum", () => {
    const journey = getPromotionJourney({
      personalPc: 5_000,
      agencyPc: 600_000,
      mode: "agency",
    });
    const blackStage = journey.stages.at(-1);

    expect(blackStage?.agencyProgress).toBe(1);
    expect(blackStage?.personalProgress).toBe(0.5);
    expect(blackStage?.progress).toBe(0.5);
    expect(blackStage?.qualifies).toBe(false);
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
    expect(journey.stages[0].personalRemaining).toBe(2_500);
    expect(journey.stages[0].agencyRemaining).toBe(5_000);
  });
});
