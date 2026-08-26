"use client";

import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Avatar } from "@/components/Avatar";
import { NODE_WIDTH } from "@/lib/hierarchy-layout";
import {
  AGENCY_RECRUITMENT_STAGE_LABEL,
  type AgencyRecruitmentStageValue,
} from "../agency/recruitment-ui";
import {
  HIERARCHY_SUBSCRIPTION_STATUS_LABEL,
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

function kindLabel(kind: ViewNodeData["kind"]): string {
  if (kind === "SELF") return "Você";
  if (kind === "AGENCY") return "Agência";
  return "Agente";
}

export function ViewNode({ data }: NodeProps<ViewFlowNode>) {
  const label = kindLabel(data.kind);
  const stageLabel = data.recruitmentStage
    ? AGENCY_RECRUITMENT_STAGE_LABEL[data.recruitmentStage]
    : null;
  const subscriptionLabel = HIERARCHY_SUBSCRIPTION_STATUS_LABEL[data.subscriptionStatus];

  return (
    <div style={{ width: NODE_WIDTH }}>
      <Handle type="target" position={Position.Top} className="!h-0 !w-0 !border-0 !opacity-0" isConnectable={false} />
      <div
        className="hierarchy-node-card"
        data-kind={data.kind.toLowerCase()}
        aria-label={`${data.name}, ${label}, nível ${data.depth}${stageLabel ? `, etapa ${stageLabel}` : ""}, ${subscriptionLabel}`}
      >
        <Avatar name={data.name} />
        <span className="hierarchy-node-copy">
          <strong>{data.name}</strong>
          <span>{data.agencyName ?? (data.kind === "SELF" ? "Origem desta visão" : label)}</span>
        </span>
        <span className="hierarchy-node-meta">
          <span data-kind={data.kind.toLowerCase()}>{label}</span>
          {stageLabel ? <small className="hierarchy-node-stage">{stageLabel}</small> : null}
          <small className="hierarchy-subscription-status" data-status={data.subscriptionStatus}>
            {subscriptionLabel}
          </small>
          <small>Nível {data.depth}</small>
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-0 !w-0 !border-0 !opacity-0" isConnectable={false} />
    </div>
  );
}
