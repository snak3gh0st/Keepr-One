import { cache } from "react";
import { getAgentAccessForAgent } from "@/lib/agent-access";
import { decimalToNumber } from "@/lib/decimal";
import { prisma } from "@/lib/prisma";
import {
  isRecognizedPromotionCreditStatus,
  type PromotionCreditStatus,
} from "@/lib/promotion-credits";
import {
  getPromotionIdentity,
  getPromotionJourney,
  PROMOTION_RANKS,
  type PromotionIdentity,
  type PromotionMode,
} from "@/lib/promotion-journey";

export const PROMOTION_WINDOW_MONTHS = 12;

export type AgentPromotionSnapshot = {
  /** Carrier-confirmed personal PC inside the active rolling window. */
  personalPc: number;
  /** Confirmed personal + frozen team PC, with each event counted once. */
  agencyPc: number;
  estimatedPersonalPc: number;
  estimatedAgencyPc: number;
  pendingPersonalPc: number;
  pendingAgencyPc: number;
  confirmedCreditCount: number;
  estimatedCreditCount: number;
  pendingCreditCount: number;
  hasPromotionData: boolean;
  ledgerReady: boolean;
  canViewAgencyJourney: boolean;
  hasAgencyStructure: boolean;
  hasAgencyData: boolean;
  windowStart: string;
  windowEnd: string;
  lastCreditAt: string | null;
  mode: PromotionMode;
  /** Highest non-invalidated title ever earned; rolling PC may later decrease. */
  highestAchievement: {
    rankId: string;
    step: number;
    route: "PERSONAL" | "AGENCY";
    achievedAt: string;
    personalPc: number;
    agencyPc: number;
  } | null;
  /** Identity earned inside the current rolling window. */
  currentIdentity: PromotionIdentity;
  /** Durable identity used by the achievement bar across the agent workspace. */
  identity: PromotionIdentity;
  loadError: boolean;
};

export type PromotionAttributionRow = {
  kind: "PERSONAL" | "AGENCY";
  agentId: string;
  leaderAgentId: string | null;
  promotionCredit: {
    id: string;
    carrier?: string;
    policyNumber?: string | null;
    producerAgentId: string;
    creditedPc: { toString(): string } | number | string;
    status: PromotionCreditStatus;
    recognizedAt: Date;
    createdAt: Date;
  };
};

type PromotionBucket = "confirmed" | "estimated" | "pending";

export type PromotionCreditRollup = {
  personalPc: number;
  agencyPc: number;
  estimatedPersonalPc: number;
  estimatedAgencyPc: number;
  pendingPersonalPc: number;
  pendingAgencyPc: number;
  confirmedCreditCount: number;
  estimatedCreditCount: number;
  pendingCreditCount: number;
  hasPromotionData: boolean;
  lastCreditAt: Date | null;
};

type PromotionAccessContext = {
  mode: PromotionMode;
  canViewAgencyJourney: boolean;
  hasAgencyStructure: boolean;
  scopeAgentIds?: string[];
};

type PromotionAttributionPredicate =
  | { kind: "PERSONAL"; agentId: string }
  | {
      kind: "AGENCY";
      leaderAgentId: string;
      promotionCredit?: { producerAgentId: { in: string[] } };
    };

function prismaErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

/**
 * Compatibility for a local database that predates the entitlement column.
 * Hierarchy is never an authorization source outside development: production
 * schema drift must fail closed while still allowing copy to acknowledge that
 * a team exists.
 */
export function getLegacyPromotionAccessContext(
  hasAgencyStructure: boolean,
  environment: string | undefined,
): PromotionAccessContext {
  const canViewAgencyJourney =
    environment === "development" && hasAgencyStructure;
  return {
    mode: canViewAgencyJourney ? "agency" : "individual",
    canViewAgencyJourney,
    hasAgencyStructure,
  };
}

/**
 * The commercial subscription is the single authority for the agency Journey.
 * `promotionAccessScope` remains in the schema only for migration compatibility;
 * it must not outlive a downgraded or canceled agency plan as an access grant.
 */
async function getPromotionAccessContext(
  agentId: string,
): Promise<PromotionAccessContext> {
  const access = await getAgentAccessForAgent(agentId);
  const canViewAgencyJourney = access.canViewTeamData;

  return {
    mode: canViewAgencyJourney ? "agency" : "individual",
    canViewAgencyJourney,
    hasAgencyStructure: access.scopeAgentIds.some((id) => id !== agentId),
    scopeAgentIds: access.scopeAgentIds,
  };
}

/**
 * Subtracts calendar months without allowing end-of-month overflow. For
 * example, Aug 31 minus 12 months remains Aug 31, while Feb 29 safely lands on
 * Feb 28 in a non-leap year.
 */
export function subtractUtcMonths(value: Date, months: number) {
  const result = new Date(value);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return result;
}

export function getPromotionWindow(asOf = new Date()) {
  const windowDay = new Date(
    Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth(),
      asOf.getUTCDate(),
    ),
  );
  const windowStart = subtractUtcMonths(windowDay, PROMOTION_WINDOW_MONTHS);
  const windowEnd = new Date(windowDay);
  windowEnd.setUTCHours(23, 59, 59, 999);

  return {
    // Both boundary dates are complete UTC production days. Using `gte` below
    // makes the date range shown in the UI match the records actually counted.
    windowStart,
    windowEnd,
  };
}

function bucketFor(status: PromotionCreditStatus): PromotionBucket {
  if (status === "ESTIMATED") return "estimated";
  if (status === "PENDING_CARRIER") return "pending";
  return "confirmed";
}

function sumUniqueCredits(credits: Map<string, number>) {
  return Math.max(
    0,
    [...credits.values()].reduce((total, value) => total + value, 0),
  );
}

export function getDurablePromotionIdentity(
  currentIdentity: PromotionIdentity,
  highestRankId: string | null | undefined,
) {
  if (!highestRankId) return currentIdentity;
  const achievedRank = PROMOTION_RANKS.find((rank) => rank.id === highestRankId);
  if (!achievedRank) return currentIdentity;

  const currentRank = PROMOTION_RANKS.find(
    (rank) =>
      rank.title === currentIdentity.rankTitle ||
      (currentIdentity.jacket !== null && rank.jacket === currentIdentity.jacket),
  );

  return currentRank && currentRank.step > achievedRank.step
    ? currentIdentity
    : getPromotionIdentity({ currentRank: achievedRank });
}

/**
 * Agency production is an entitlement boundary, not only a presentation
 * choice. PERSONAL accounts therefore never place an agency predicate in the
 * Prisma query that feeds their snapshot.
 */
export function getPromotionAttributionPredicates(
  agentId: string,
  canViewAgencyJourney: boolean,
  agencyProducerAgentIds?: readonly string[],
): PromotionAttributionPredicate[] {
  const predicates: PromotionAttributionPredicate[] = [
    { kind: "PERSONAL", agentId },
  ];
  if (canViewAgencyJourney) {
    predicates.push({
      kind: "AGENCY",
      leaderAgentId: agentId,
      ...(agencyProducerAgentIds
        ? {
            promotionCredit: {
              producerAgentId: { in: [...agencyProducerAgentIds] },
            },
          }
        : {}),
    });
  }
  return predicates;
}

/**
 * Aggregates an already window-filtered ledger. Personal production and team
 * production are kept separate first, then merged by carrier event id for the
 * agency view. This prevents a producer's own event from being counted twice.
 */
export function rollupPromotionCredits(
  rows: readonly PromotionAttributionRow[],
  agentId: string,
  includeAgency = true,
  agencyProducerAgentIds?: readonly string[],
): PromotionCreditRollup {
  const personal: Record<PromotionBucket, Map<string, number>> = {
    confirmed: new Map(),
    estimated: new Map(),
    pending: new Map(),
  };
  const team: Record<PromotionBucket, Map<string, number>> = {
    confirmed: new Map(),
    estimated: new Map(),
    pending: new Map(),
  };
  const allCredits = new Map<string, PromotionAttributionRow["promotionCredit"]>();
  const agencyProducerScope = agencyProducerAgentIds
    ? new Set(agencyProducerAgentIds)
    : null;
  const eligibleRows: Array<{
    row: PromotionAttributionRow;
    isPersonal: boolean;
    isTeam: boolean;
  }> = [];

  for (const row of rows) {
    const credit = row.promotionCredit;
    const isPersonal = row.kind === "PERSONAL" && row.agentId === agentId;
    const isTeam =
      includeAgency &&
      row.kind === "AGENCY" &&
      row.leaderAgentId === agentId &&
      (agencyProducerScope === null || agencyProducerScope.has(credit.producerAgentId)) &&
      credit.producerAgentId !== agentId;
    if (!isPersonal && !isTeam) continue;

    eligibleRows.push({ row, isPersonal, isTeam });
  }

  function policyKey(
    credit: PromotionAttributionRow["promotionCredit"],
  ): string | null {
    const carrier = credit.carrier?.trim();
    const policyNumber = credit.policyNumber?.trim();
    if (!carrier || !policyNumber) return null;
    return `${carrier.toUpperCase()}\u001f${policyNumber.toUpperCase().replace(/\s+/g, "")}`;
  }

  const recognizedPolicyKeys = new Set(
    eligibleRows.flatMap(({ row }) => {
      const credit = row.promotionCredit;
      const key = policyKey(credit);
      return key && isRecognizedPromotionCreditStatus(credit.status)
        ? [key]
        : [];
    }),
  );
  const latestLowerQualityCredit = new Map<
    string,
    PromotionAttributionRow["promotionCredit"]
  >();

  for (const { row } of eligibleRows) {
    const credit = row.promotionCredit;
    if (credit.status !== "ESTIMATED" && credit.status !== "PENDING_CARRIER") {
      continue;
    }

    const key = policyKey(credit);
    if (!key || recognizedPolicyKeys.has(key)) continue;

    const observationKey = `${key}\u001f${bucketFor(credit.status)}`;
    const latest = latestLowerQualityCredit.get(observationKey);
    if (
      !latest ||
      credit.createdAt > latest.createdAt ||
      (credit.createdAt.getTime() === latest.createdAt.getTime() &&
        credit.id.localeCompare(latest.id) > 0)
    ) {
      latestLowerQualityCredit.set(observationKey, credit);
    }
  }

  for (const { row, isPersonal, isTeam } of eligibleRows) {
    const credit = row.promotionCredit;
    if (credit.status === "ESTIMATED" || credit.status === "PENDING_CARRIER") {
      const key = policyKey(credit);
      if (key) {
        if (recognizedPolicyKeys.has(key)) continue;
        const observationKey = `${key}\u001f${bucketFor(credit.status)}`;
        if (latestLowerQualityCredit.get(observationKey)?.id !== credit.id) {
          continue;
        }
      }
    }

    const bucket = bucketFor(credit.status);
    const value = decimalToNumber(credit.creditedPc);
    allCredits.set(credit.id, credit);

    if (isPersonal) {
      personal[bucket].set(credit.id, value);
      continue;
    }

    if (isTeam) {
      team[bucket].set(credit.id, value);
    }
  }

  function agencyMap(bucket: PromotionBucket) {
    if (!includeAgency) return new Map<string, number>();
    return new Map([...personal[bucket], ...team[bucket]]);
  }

  const recognizedIds = new Set(
    [...allCredits.values()]
      .filter((credit) => isRecognizedPromotionCreditStatus(credit.status))
      .map((credit) => credit.id),
  );
  const estimatedIds = new Set(
    [...allCredits.values()]
      .filter((credit) => credit.status === "ESTIMATED")
      .map((credit) => credit.id),
  );
  const pendingIds = new Set(
    [...allCredits.values()]
      .filter((credit) => credit.status === "PENDING_CARRIER")
      .map((credit) => credit.id),
  );
  const lastCreditAt = [...allCredits.values()].reduce<Date | null>(
    (latest, credit) =>
      !latest || credit.createdAt > latest ? credit.createdAt : latest,
    null,
  );

  return {
    personalPc: sumUniqueCredits(personal.confirmed),
    agencyPc: sumUniqueCredits(agencyMap("confirmed")),
    estimatedPersonalPc: sumUniqueCredits(personal.estimated),
    estimatedAgencyPc: sumUniqueCredits(agencyMap("estimated")),
    pendingPersonalPc: sumUniqueCredits(personal.pending),
    pendingAgencyPc: sumUniqueCredits(agencyMap("pending")),
    confirmedCreditCount: recognizedIds.size,
    estimatedCreditCount: estimatedIds.size,
    pendingCreditCount: pendingIds.size,
    hasPromotionData: allCredits.size > 0,
    lastCreditAt,
  };
}

function emptySnapshot({
  loadError,
  ledgerReady = true,
  access = {
    mode: "individual",
    canViewAgencyJourney: false,
    hasAgencyStructure: false,
    scopeAgentIds: [],
  },
  asOf = new Date(),
}: {
  loadError: boolean;
  ledgerReady?: boolean;
  access?: PromotionAccessContext;
  asOf?: Date;
}): AgentPromotionSnapshot {
  const { mode } = access;
  const { windowStart, windowEnd } = getPromotionWindow(asOf);
  const currentIdentity = getPromotionIdentity(
    getPromotionJourney({ personalPc: 0, agencyPc: 0, mode }),
  );

  return {
    personalPc: 0,
    agencyPc: 0,
    estimatedPersonalPc: 0,
    estimatedAgencyPc: 0,
    pendingPersonalPc: 0,
    pendingAgencyPc: 0,
    confirmedCreditCount: 0,
    estimatedCreditCount: 0,
    pendingCreditCount: 0,
    hasPromotionData: false,
    ledgerReady,
    canViewAgencyJourney: access.canViewAgencyJourney,
    hasAgencyStructure: access.hasAgencyStructure,
    hasAgencyData: false,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    lastCreditAt: null,
    mode,
    highestAchievement: null,
    currentIdentity,
    identity: currentIdentity,
    loadError,
  };
}

/**
 * Canonical promotion totals for the signed-in agent portal.
 *
 * PC comes exclusively from the Target Premium ledger. Commission records are
 * intentionally not queried here. React's request cache deduplicates this read
 * between the shared /agent layout and the Journey page.
 */
export const getAgentPromotionSnapshot = cache(
  async function getAgentPromotionSnapshot(
    agentId: string,
  ): Promise<AgentPromotionSnapshot> {
    const asOf = new Date();
    const { windowStart, windowEnd } = getPromotionWindow(asOf);
    let access: PromotionAccessContext;

    try {
      access = await getPromotionAccessContext(agentId);
    } catch (error) {
      console.error("Agent promotion access query error", error);
      return emptySnapshot({ loadError: true, asOf });
    }

    try {
      const [rows, highestAchievement] = await Promise.all([
        prisma.promotionCreditAttribution.findMany({
          where: {
            OR: getPromotionAttributionPredicates(
              agentId,
              access.canViewAgencyJourney,
              access.scopeAgentIds ?? [agentId],
            ),
            promotionCredit: {
              recognizedAt: { gte: windowStart, lte: windowEnd },
            },
          },
          select: {
            kind: true,
            agentId: true,
            leaderAgentId: true,
            promotionCredit: {
              select: {
                id: true,
                carrier: true,
                policyNumber: true,
                producerAgentId: true,
                creditedPc: true,
                status: true,
                recognizedAt: true,
                createdAt: true,
              },
            },
          },
        }),
        prisma.promotionAchievement.findFirst({
          where: {
            agentId,
            invalidatedAt: null,
            // Historical AGENCY achievements were written from the legacy
            // hierarchy and cannot be proven to belong to the current agency
            // membership. Keep the durable badge personal until achievements
            // carry an agency subject of their own.
            route: "PERSONAL" as const,
          },
          orderBy: [{ step: "desc" }, { achievedAt: "asc" }],
          select: {
            rankId: true,
            step: true,
            route: true,
            achievedAt: true,
            personalPc: true,
            agencyPc: true,
          },
        }),
      ]);

      const totals = rollupPromotionCredits(
        rows,
        agentId,
        access.canViewAgencyJourney,
        access.scopeAgentIds ?? [agentId],
      );
      const hasAgencyStructure =
        access.hasAgencyStructure ||
        rows.some(
          (row) =>
            row.kind === "AGENCY" && row.leaderAgentId === agentId,
        );
      const hasAgencyData =
        access.canViewAgencyJourney &&
        rows.some(
          (row) => row.kind === "AGENCY" && row.leaderAgentId === agentId,
        );
      const currentIdentity = getPromotionIdentity(
        getPromotionJourney({
          personalPc: totals.personalPc,
          agencyPc: totals.agencyPc,
          mode: access.mode,
        }),
      );
      const identity = getDurablePromotionIdentity(
        currentIdentity,
        highestAchievement?.rankId,
      );

      return {
        ...totals,
        ledgerReady: true,
        canViewAgencyJourney: access.canViewAgencyJourney,
        hasAgencyStructure,
        hasAgencyData,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        lastCreditAt: totals.lastCreditAt?.toISOString() ?? null,
        mode: access.mode,
        highestAchievement: highestAchievement
          ? {
              rankId: highestAchievement.rankId,
              step: highestAchievement.step,
              route: highestAchievement.route,
              achievedAt: highestAchievement.achievedAt.toISOString(),
              personalPc: decimalToNumber(highestAchievement.personalPc),
              agencyPc: decimalToNumber(highestAchievement.agencyPc),
            }
          : null,
        currentIdentity,
        identity,
        loadError: false,
      };
    } catch (error) {
      const prismaCode = prismaErrorCode(error);
      const message = error instanceof Error ? error.message : String(error);
      if (
        prismaCode === "P2021" &&
        /Promotion(?:Credit(?:Attribution)?|Achievement)/i.test(message)
      ) {
        console.warn(
          "Promotion credit ledger is not migrated yet; rendering an empty journey.",
        );
        return emptySnapshot({
          loadError: false,
          ledgerReady: false,
          access,
          asOf,
        });
      }
      console.error("Agent promotion query error", error);
      return emptySnapshot({ loadError: true, access, asOf });
    }
  },
);
