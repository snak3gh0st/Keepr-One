"use client";

import { CrmStageSelect } from "@/components/crm/CrmStageSelect";
import type { CrmStageView } from "@/lib/crm";

type StageChangeResult = { ok: true } | { ok: false; message: string };

export function CasePipelineStageControl({
  pipelineAvailable,
  readOnly,
  caseId,
  stage,
  stages,
  onChange,
  onFollowUpRequired,
}: {
  pipelineAvailable: boolean;
  readOnly: boolean;
  caseId: string;
  stage: Pick<CrmStageView, "id" | "name" | "systemKey"> | null;
  stages: CrmStageView[];
  onChange: (caseId: string, stageId: string) => Promise<StageChangeResult>;
  onFollowUpRequired?: (stageId: string) => void;
}) {
  if (!pipelineAvailable || readOnly) return null;

  return (
    <CrmStageSelect
      caseId={caseId}
      stage={stage}
      stages={stages}
      onChange={onChange}
      onFollowUpRequired={onFollowUpRequired}
    />
  );
}
