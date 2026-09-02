"use server";

import { revalidatePath } from "next/cache";
import { getCurrentAgent } from "@/lib/agent-context";
import { getAgentScopeIds } from "@/lib/agent-access";
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
import { getServerI18n } from "@/lib/i18n/server";

export type CrmActionResult = { ok: true } | { ok: false; message: string };

async function actionContext() {
  const agent = await getCurrentAgent();
  return {
    agent,
    scope: await getAgentScopeIds(agent.id),
  };
}

async function resultError(error: unknown): Promise<CrmActionResult> {
  const { copy, language } = await getServerI18n();
  if (error instanceof CrmDomainError) {
    if (language === "PT") return { ok: false, message: error.message };
    const englishByCode: Record<CrmDomainError["code"], string> = {
      CASE_NOT_FOUND: "Case not found or outside your book.",
      STAGE_NOT_FOUND: "Pipeline stage not found.",
      STAGE_HAS_CASES: "Move the leads in this stage before removing it.",
      INVALID_STAGE_ORDER: "The stage order is invalid. Refresh and try again.",
      FOLLOW_UP_NOT_FOUND: "Follow-up not found or outside your book.",
      FOLLOW_UP_NOT_SCHEDULED: "Only pending follow-ups can be changed.",
      FOLLOW_UP_ALREADY_SCHEDULED: "This lead already has a scheduled follow-up. Reschedule the current one.",
      ACCESS_DENIED: "You do not have access to this case.",
      VALIDATION_ERROR: "Review the information and try again.",
    };
    return { ok: false, message: englishByCode[error.code] };
  }
  console.error("CRM action error", error);
  return { ok: false, message: copy("Não foi possível concluir a ação. Tente novamente.", "The action could not be completed. Try again.") };
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
