export type PromotionMode = "individual" | "agency";

export type JacketTone = "blue" | "red" | "green" | "purple" | "black";

export type PromotionRank = {
  id: string;
  step: number;
  title: string;
  shortTitle: string;
  jacket: string | null;
  jacketTone: JacketTone | null;
  personalTarget: number;
  agencyTarget: number;
  agencyPersonalMinimum: number;
};

export const PROMOTION_RANKS: readonly PromotionRank[] = [
  {
    id: "district-leader",
    step: 3,
    title: "District Leader",
    shortTitle: "District",
    jacket: null,
    jacketTone: null,
    personalTarget: 5_000,
    agencyTarget: 5_000,
    agencyPersonalMinimum: 2_500,
  },
  {
    id: "division-leader",
    step: 4,
    title: "Division Leader",
    shortTitle: "Division",
    jacket: null,
    jacketTone: null,
    personalTarget: 20_000,
    agencyTarget: 20_000,
    agencyPersonalMinimum: 5_000,
  },
  {
    id: "regional-leader",
    step: 5,
    title: "Regional Leader",
    shortTitle: "Regional",
    jacket: null,
    jacketTone: null,
    personalTarget: 40_000,
    agencyTarget: 40_000,
    agencyPersonalMinimum: 10_000,
  },
  {
    id: "agency-vice-president",
    step: 6,
    title: "Agency Vice President",
    shortTitle: "Agency VP",
    jacket: "Blue Jacket",
    jacketTone: "blue",
    personalTarget: 60_000,
    agencyTarget: 120_000,
    agencyPersonalMinimum: 30_000,
  },
  {
    id: "regional-vice-president",
    step: 7,
    title: "Regional Vice President",
    shortTitle: "Regional VP",
    jacket: "Red Jacket",
    jacketTone: "red",
    personalTarget: 84_000,
    agencyTarget: 240_000,
    agencyPersonalMinimum: 25_000,
  },
  {
    id: "national-vice-president",
    step: 8,
    title: "National Vice President",
    shortTitle: "National VP",
    jacket: "Green Jacket",
    jacketTone: "green",
    personalTarget: 108_000,
    agencyTarget: 360_000,
    agencyPersonalMinimum: 20_000,
  },
  {
    id: "senior-vice-president",
    step: 9,
    title: "Senior Vice President",
    shortTitle: "Senior VP",
    jacket: "Purple Jacket",
    jacketTone: "purple",
    personalTarget: 132_000,
    agencyTarget: 480_000,
    agencyPersonalMinimum: 15_000,
  },
  {
    id: "executive-vice-president",
    step: 10,
    title: "Executive Vice President",
    shortTitle: "Executive VP",
    jacket: "Black Jacket",
    jacketTone: "black",
    personalTarget: 156_000,
    agencyTarget: 600_000,
    agencyPersonalMinimum: 10_000,
  },
] as const;

export type PromotionStage = PromotionRank & {
  status: "achieved" | "current" | "locked";
  progress: number;
  personalProgress: number;
  agencyProgress: number | null;
  personalRemaining: number;
  agencyRemaining: number | null;
  qualifies: boolean;
};

export type PromotionJourney = {
  mode: PromotionMode;
  personalPc: number;
  agencyPc: number;
  currentRank: PromotionRank | null;
  nextRank: PromotionRank | null;
  currentIndex: number;
  finalReached: boolean;
  overallProgress: number;
  stages: PromotionStage[];
};

export type PromotionIdentity = {
  tone: JacketTone | "standard";
  rankTitle: string | null;
  jacket: string | null;
};

export function getPromotionIdentity(
  journey: Pick<PromotionJourney, "currentRank">,
): PromotionIdentity {
  return {
    tone: journey.currentRank?.jacketTone ?? "standard",
    rankTitle: journey.currentRank?.title ?? null,
    jacket: journey.currentRank?.jacket ?? null,
  };
}

function safePc(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function ratio(value: number, target: number) {
  if (target <= 0) return 1;
  return Math.min(Math.max(value / target, 0), 1);
}

function qualifiesForRank(
  rank: PromotionRank,
  mode: PromotionMode,
  personalPc: number,
  agencyPc: number,
) {
  if (mode === "individual") return personalPc >= rank.personalTarget;
  return (
    agencyPc >= rank.agencyTarget &&
    personalPc >= rank.agencyPersonalMinimum
  );
}

export function getPromotionJourney({
  personalPc,
  agencyPc,
  mode,
}: {
  personalPc: number;
  agencyPc: number;
  mode: PromotionMode;
}): PromotionJourney {
  const safePersonalPc = safePc(personalPc);
  const safeAgencyPc = safePc(agencyPc);
  const qualifyingIndexes = PROMOTION_RANKS.flatMap((rank, index) =>
    qualifiesForRank(rank, mode, safePersonalPc, safeAgencyPc) ? [index] : [],
  );
  const currentIndex = qualifyingIndexes.at(-1) ?? -1;
  const nextIndex = currentIndex + 1;
  const finalReached = currentIndex === PROMOTION_RANKS.length - 1;
  const finalRank = PROMOTION_RANKS[PROMOTION_RANKS.length - 1];
  const overallProgress =
    mode === "individual"
      ? ratio(safePersonalPc, finalRank.personalTarget)
      : Math.min(
          ratio(safeAgencyPc, finalRank.agencyTarget),
          ratio(safePersonalPc, finalRank.agencyPersonalMinimum),
        );

  const stages = PROMOTION_RANKS.map((rank, index): PromotionStage => {
    const personalTarget =
      mode === "individual" ? rank.personalTarget : rank.agencyPersonalMinimum;
    const personalProgress = ratio(safePersonalPc, personalTarget);
    const agencyProgress =
      mode === "agency" ? ratio(safeAgencyPc, rank.agencyTarget) : null;
    const progress =
      mode === "agency"
        ? Math.min(personalProgress, agencyProgress ?? 0)
        : personalProgress;

    return {
      ...rank,
      status:
        index <= currentIndex
          ? "achieved"
          : index === nextIndex
            ? "current"
            : "locked",
      progress,
      personalProgress,
      agencyProgress,
      personalRemaining: Math.max(personalTarget - safePersonalPc, 0),
      agencyRemaining:
        mode === "agency"
          ? Math.max(rank.agencyTarget - safeAgencyPc, 0)
          : null,
      qualifies: qualifiesForRank(
        rank,
        mode,
        safePersonalPc,
        safeAgencyPc,
      ),
    };
  });

  return {
    mode,
    personalPc: safePersonalPc,
    agencyPc: safeAgencyPc,
    currentRank: currentIndex >= 0 ? PROMOTION_RANKS[currentIndex] : null,
    nextRank: finalReached ? null : PROMOTION_RANKS[nextIndex],
    currentIndex,
    finalReached,
    overallProgress,
    stages,
  };
}
