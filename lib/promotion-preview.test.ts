import { describe, expect, it } from "vitest";
import { getLocalPromotionPreview } from "./promotion-preview";

describe("getLocalPromotionPreview", () => {
  it("simulates a completed Black Jacket journey only in development", () => {
    expect(getLocalPromotionPreview("black-jacket", "development")).toEqual({
      personalPc: 156_000,
      agencyPc: 600_000,
      mode: "agency",
      canViewAgencyJourney: true,
      hasAgencyStructure: true,
    });
  });

  it("never enables local previews in production", () => {
    expect(getLocalPromotionPreview("black-jacket", "production")).toBeNull();
  });
});
