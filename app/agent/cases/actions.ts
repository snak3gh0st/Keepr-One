"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAgent } from "@/lib/agent-context";
import { getDownlineIds } from "@/lib/hierarchy";
import { prisma } from "@/lib/prisma";
import {
  CrmDomainError,
  archiveCrmStage,
  createCrmStage,
  moveCaseAndScheduleFollowUp,
  moveCaseToCrmStage,
  renameCrmStage,
  reorderCrmStages,
  parseCrmLocalDateTime,
} from "@/lib/crm";

export type CrmActionResult = { ok: true } | { ok: false; message: string };

async function actionContext() {
  const agent = await getCurrentAgent();
  const allAgents = await prisma.agent.findMany({
    select: { id: true, parentAgentId: true },
  });
  return {
    agent,
    scope: [agent.id, ...getDownlineIds(allAgents, agent.id)],
  };
}

function resultError(error: unknown): CrmActionResult {
  if (error instanceof CrmDomainError) return { ok: false, message: error.message };
  console.error("CRM action error", error);
  return { ok: false, message: "Não foi possível concluir a ação. Tente novamente." };
}

function parseWallClock(value: string) {
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("invalid");
    return parseCrmLocalDateTime(value);
  } catch {
    throw new CrmDomainError("VALIDATION_ERROR", "Data ou horário de follow-up inválido.");
  }
}

function refreshCases(caseId?: string) {
  revalidatePath("/agent/cases");
  revalidatePath("/agent");
  revalidatePath("/agent/activities");
  if (caseId) revalidatePath(`/agent/cases/${caseId}`);
}

export async function moveCaseStageAction(
  caseId: string,
  stageId: string,
): Promise<CrmActionResult> {
  try {
    const { agent, scope } = await actionContext();
    await moveCaseToCrmStage({
      caseId,
      crmStageId: stageId,
      actorUserId: agent.userId,
      scopeAgentIds: scope,
    });
    refreshCases(caseId);
    return { ok: true };
  } catch (error) {
    return resultError(error);
  }
}

export async function moveCaseAndScheduleAction(input: {
  caseId: string;
  stageId: string;
  title: string;
  scheduledAt: string;
}): Promise<CrmActionResult> {
  try {
    const { agent, scope } = await actionContext();
    await moveCaseAndScheduleFollowUp({
      caseId: input.caseId,
      crmStageId: input.stageId,
      actorUserId: agent.userId,
      scopeAgentIds: scope,
      title: input.title,
      scheduledAt: parseWallClock(input.scheduledAt),
    });
    refreshCases(input.caseId);
    return { ok: true };
  } catch (error) {
    return resultError(error);
  }
}

export async function createStageAction(input: {
  name: string;
  position: number;
}): Promise<CrmActionResult> {
  try {
    const { agent } = await actionContext();
    // UI positions are one-based; the domain persists zero-based positions.
    await createCrmStage({ agentId: agent.id, name: input.name, position: input.position - 1 });
    refreshCases();
    return { ok: true };
  } catch (error) {
    return resultError(error);
  }
}

export async function renameStageAction(input: {
  stageId: string;
  name: string;
}): Promise<CrmActionResult> {
  try {
    const { agent } = await actionContext();
    await renameCrmStage({ agentId: agent.id, ...input });
    refreshCases();
    return { ok: true };
  } catch (error) {
    return resultError(error);
  }
}

export async function reorderStagesAction(
  orderedStageIds: string[],
): Promise<CrmActionResult> {
  try {
    const { agent } = await actionContext();
    await reorderCrmStages({ agentId: agent.id, orderedStageIds });
    refreshCases();
    return { ok: true };
  } catch (error) {
    return resultError(error);
  }
}

export async function archiveStageAction(input: {
  stageId: string;
  transferToStageId?: string;
}): Promise<CrmActionResult> {
  try {
    const { agent } = await actionContext();
    await archiveCrmStage({ agentId: agent.id, ...input });
    refreshCases();
    return { ok: true };
  } catch (error) {
    return resultError(error);
  }
}
