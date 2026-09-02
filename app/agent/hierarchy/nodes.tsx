"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Avatar } from "@/components/Avatar";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { NODE_WIDTH } from "@/lib/hierarchy-layout";
import {
  AGENCY_RECRUITMENT_STAGE_LABEL,
  AGENCY_RECRUITMENT_STAGE_LABEL_EN,
  type AgencyRecruitmentStageValue,
} from "../agency/recruitment-ui";
import {
  HIERARCHY_SUBSCRIPTION_STATUS_LABEL,
  HIERARCHY_SUBSCRIPTION_STATUS_LABEL_EN,
  type HierarchySubscriptionStatus,
} from "./view-model";

export type ViewNodeData = {
  name: string;
  depth: number;
  kind: "SELF" | "AGENT" | "AGENCY";
  agencyName: string | null;
  recruitmentStage: AgencyRecruitmentStageValue | null;
  subscriptionStatus: HierarchySubscriptionStatus;
};

export type ViewFlowNode = Node<ViewNodeData, "view">;

export function ViewNode({ data }: NodeProps<ViewFlowNode>) {
  const { copy, language } = useI18n();
  const label = data.kind === "SELF"
    ? copy("Você", "You")
    : data.kind === "AGENCY"
      ? copy("Agência", "Agency")
      : copy("Agente", "Agent");
  const stageLabel = data.recruitmentStage
    ? (language === "PT" ? AGENCY_RECRUITMENT_STAGE_LABEL : AGENCY_RECRUITMENT_STAGE_LABEL_EN)[data.recruitmentStage]
    : null;
  const subscriptionLabel = (language === "PT" ? HIERARCHY_SUBSCRIPTION_STATUS_LABEL : HIERARCHY_SUBSCRIPTION_STATUS_LABEL_EN)[data.subscriptionStatus];

  return (
    <div style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!h-0 !w-0 !border-0 !opacity-0" isConnectable={false} />
      <div
        className="hierarchy-node-card"
        data-kind={data.kind.toLowerCase()}
        aria-label={copy(
          "{name}, {kind}, nível {depth}{stage}, {subscription}",
          "{name}, {kind}, level {depth}{stage}, {subscription}",
          { name: data.name, kind: label, depth: data.depth, stage: stageLabel ? copy(`, etapa ${stageLabel}`, `, stage ${stageLabel}`) : "", subscription: subscriptionLabel },
        )}
      >
        <Avatar name={data.name} />
        <span className="hierarchy-node-copy">
          <strong>{data.name}</strong>
          <span>{data.agencyName ?? (data.kind === "SELF" ? copy("Origem desta visão", "Starting point") : label)}</span>
        </span>
        <span className="hierarchy-node-meta">
          <span data-kind={data.kind.toLowerCase()}>{label}</span>
          {stageLabel ? <small className="hierarchy-node-stage">{stageLabel}</small> : null}
          <small className="hierarchy-subscription-status" data-status={data.subscriptionStatus}>
            {subscriptionLabel}
          </small>
          <small>{copy("Nível {depth}", "Level {depth}", { depth: data.depth })}</small>
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-0 !w-0 !border-0 !opacity-0" isConnectable={false} />
    </div>
  );
}
