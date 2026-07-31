import { cache } from "react";
import { decimalToNumber } from "@/lib/decimal";
import {
  getNationalLifeEnv,
  isNationalLifeConfigured,
} from "@/lib/national-life/env";
import { toCarrierCommissionRecords } from "@/lib/national-life/commission-records";
import { prisma } from "@/lib/prisma";
import {
  getPromotionIdentity,
  getPromotionJourney,
  type PromotionIdentity,
  type PromotionMode,
} from "@/lib/promotion-journey";

export type AgentPromotionSnapshot = {
  personalPc: number;
  agencyPc: number;
  hasAgencyStructure: boolean;
  mode: PromotionMode;
  identity: PromotionIdentity;
  loadError: boolean;
};

function emptySnapshot(loadError: boolean): AgentPromotionSnapshot {
  const mode: PromotionMode = "individual";

  return {
    personalPc: 0,
    agencyPc: 0,
    hasAgencyStructure: false,
    mode,
    identity: getPromotionIdentity(
      getPromotionJourney({ personalPc: 0, agencyPc: 0, mode }),
    ),
    loadError,
  };
}

/**
 * Canonical promotion totals for the signed-in agent portal.
 *
 * React's request cache keeps the shared /agent layout and the Journey page
 * from independently loading the same commission data during one render.
 */
export const getAgentPromotionSnapshot = cache(
  async function getAgentPromotionSnapshot(
    agentId: string,
  ): Promise<AgentPromotionSnapshot> {
    try {
      const [childAgent, storedRecords, carrierRows] = await Promise.all([
        prisma.agent.findFirst({
          where: { parentAgentId: agentId },
          select: { id: true },
        }),
        prisma.commissionRecord.findMany({
          where: { agentId },
          select: { amount: true, type: true },
        }),
        isNationalLifeConfigured()
          ? prisma.nationalLifeReportRow.findMany({
              where: {
                agentId,
                deploymentScope: getNationalLifeEnv().sessionScopeId,
                gridKey: "COMMISSION_DETAIL_NLD_COMMISSION_EARNING",
              },
              select: { id: true, raw: true, amounts: true },
            })
          : Promise.resolve([]),
      ]);

      const records = [
        ...storedRecords.map((record) => ({
          amount: decimalToNumber(record.amount),
          type: record.type,
        })),
        ...toCarrierCommissionRecords(carrierRows).map((record) => ({
          amount: record.amount,
          type: record.type,
        })),
      ];

      let personalPc = 0;
      let overridePc = 0;
      let overrideCount = 0;

      for (const record of records) {
        if (record.type === "DIRECT") {
          personalPc += record.amount;
        } else {
          overridePc += record.amount;
          overrideCount += 1;
        }
      }

      const safePersonalPc = Math.max(0, personalPc);
      const safeAgencyPc = Math.max(0, personalPc + overridePc);
      const hasAgencyStructure = Boolean(childAgent) || overrideCount > 0;
      const mode: PromotionMode = hasAgencyStructure ? "agency" : "individual";
      const identity = getPromotionIdentity(
        getPromotionJourney({
          personalPc: safePersonalPc,
          agencyPc: safeAgencyPc,
          mode,
        }),
      );

      return {
        personalPc: safePersonalPc,
        agencyPc: safeAgencyPc,
        hasAgencyStructure,
        mode,
        identity,
        loadError: false,
      };
    } catch (error) {
      console.error("Agent promotion query error", error);
      return emptySnapshot(true);
    }
  },
);
