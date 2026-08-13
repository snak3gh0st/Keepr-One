export type PromotionMode = "individual" | "agency";

export type PromotionQualificationRoute = "personal" | "agency" | null;

export type PromotionAchievement = "qualified" | "inherited" | null;

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
  achievement: PromotionAchievement;
  progress: number;
  personalProgress: number;
  agencyProgress: number | null;
  agencyPersonalProgress: number | null;
  personalRemaining: number;
  agencyRemaining: number | null;
  agencyPersonalRemaining: number | null;
  qualificationRoute: PromotionQualificationRoute;
  qualifies: boolean;
};

export type PromotionJourney = {
  mode: PromotionMode;
  personalPc: number;
  agencyPc: number;
  currentRank: PromotionRank | null;
  nextRank: PromotionRank | null;
  currentIndex: number;
  qualificationRoute: PromotionQualificationRoute;
  finalReached: boolean;
  overallProgress: number;
  personalProgress: number;
  agencyProgress: number | null;
  agencyPersonalProgress: number | null;
  personalRemaining: number;
  agencyRemaining: number | null;
  agencyPersonalRemaining: number | null;
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

function getRankQualification(
  rank: PromotionRank,
  mode: PromotionMode,
  personalPc: number,
  agencyPc: number,
) {
  const personalProgress = ratio(personalPc, rank.personalTarget);
  const personalRemaining = Math.max(rank.personalTarget - personalPc, 0);
  const personalQualifies = personalPc >= rank.personalTarget;

  if (mode === "individual") {
    return {
      qualifies: personalQualifies,
      qualificationRoute: personalQualifies ? ("personal" as const) : null,
      progress: personalProgress,
      personalProgress,
      agencyProgress: null,
      agencyPersonalProgress: null,
      personalRemaining,
      agencyRemaining: null,
      agencyPersonalRemaining: null,
    };
  }

  const agencyProductionProgress = ratio(agencyPc, rank.agencyTarget);
  const agencyPersonalProgress = ratio(
    personalPc,
    rank.agencyPersonalMinimum,
  );
  const agencyProgress = Math.min(
    agencyProductionProgress,
    agencyPersonalProgress,
  );
  const agencyQualifies =
    agencyPc >= rank.agencyTarget &&
    personalPc >= rank.agencyPersonalMinimum;
  const qualificationRoute: PromotionQualificationRoute = personalQualifies
    ? "personal"
    : agencyQualifies
      ? "agency"
      : null;

  return {
    qualifies: personalQualifies || agencyQualifies,
    qualificationRoute,
    progress: Math.max(personalProgress, agencyProgress),
    personalProgress,
    agencyProgress,
    agencyPersonalProgress,
    personalRemaining,
    agencyRemaining: Math.max(rank.agencyTarget - agencyPc, 0),
    agencyPersonalRemaining: Math.max(
      rank.agencyPersonalMinimum - personalPc,
      0,
    ),
  };
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
  const rankQualifications = PROMOTION_RANKS.map((rank) =>
    getRankQualification(rank, mode, safePersonalPc, safeAgencyPc),
  );
  const qualifyingIndexes = rankQualifications.flatMap((qualification, index) =>
    qualification.qualifies ? [index] : [],
  );
  const currentIndex = qualifyingIndexes.at(-1) ?? -1;
  const nextIndex = currentIndex + 1;
  const finalReached = currentIndex === PROMOTION_RANKS.length - 1;
  const finalQualification = rankQualifications[rankQualifications.length - 1];
  const currentQualification =
    currentIndex >= 0 ? rankQualifications[currentIndex] : null;

  const stages = PROMOTION_RANKS.map((rank, index): PromotionStage => {
    const qualification = rankQualifications[index];
    const achieved = index <= currentIndex;

    return {
      ...rank,
      status:
        achieved
          ? "achieved"
          : index === nextIndex
            ? "current"
            : "locked",
      achievement: achieved
        ? qualification.qualifies
          ? "qualified"
          : "inherited"
        : null,
      ...qualification,
    };
  });

  return {
    mode,
    personalPc: safePersonalPc,
    agencyPc: safeAgencyPc,
    currentRank: currentIndex >= 0 ? PROMOTION_RANKS[currentIndex] : null,
    nextRank: finalReached ? null : PROMOTION_RANKS[nextIndex],
    currentIndex,
    qualificationRoute: currentQualification?.qualificationRoute ?? null,
    finalReached,
    overallProgress: finalQualification.progress,
    personalProgress: finalQualification.personalProgress,
    agencyProgress: finalQualification.agencyProgress,
    agencyPersonalProgress: finalQualification.agencyPersonalProgress,
    personalRemaining: finalQualification.personalRemaining,
    agencyRemaining: finalQualification.agencyRemaining,
    agencyPersonalRemaining: finalQualification.agencyPersonalRemaining,
    stages,
  };
}
