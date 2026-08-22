import type { PromotionMode } from "@/lib/promotion-journey";

export type LocalPromotionPreview = {
  personalPc: number;
  agencyPc: number;
  mode: PromotionMode;
  canViewAgencyJourney: boolean;
  hasAgencyStructure: boolean;
};

/**
 * Local-only promotion scenarios for visual review. These values never write
 * to the promotion ledger and are ignored outside development.
 */
export function getLocalPromotionPreview(
  preview?: string,
  environment = process.env.NODE_ENV,
): LocalPromotionPreview | null {
  if (environment !== "development") return null;

  if (preview === "blue-jacket") {
    return {
      personalPc: 60_000,
      agencyPc: 120_000,
      mode: "agency",
      canViewAgencyJourney: true,
      hasAgencyStructure: true,
    };
  }

  if (preview === "black-jacket") {
    return {
      personalPc: 156_000,
      agencyPc: 600_000,
      mode: "agency",
      canViewAgencyJourney: true,
      hasAgencyStructure: true,
    };
  }

  if (preview === "target-premium-21780") {
    return {
      personalPc: 21_780,
      agencyPc: 21_780,
      mode: "individual",
      canViewAgencyJourney: false,
      hasAgencyStructure: false,
    };
  }

  return null;
}
