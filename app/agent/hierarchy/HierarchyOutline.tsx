"use client";

import { Avatar } from "@/components/Avatar";
import { useI18n } from "@/components/i18n/LanguageProvider";
import { AGENCY_RECRUITMENT_STAGE_LABEL, AGENCY_RECRUITMENT_STAGE_LABEL_EN } from "../agency/recruitment-ui";
import {
  buildHierarchyBranch,
  HIERARCHY_SUBSCRIPTION_STATUS_LABEL,
  HIERARCHY_SUBSCRIPTION_STATUS_LABEL_EN,
  type HierarchyBranch,
  type HierarchyViewNode,
} from "./view-model";

function BranchItem({ branch }: { branch: HierarchyBranch }) {
  const { copy, language } = useI18n();
  const { node, children } = branch;
  const label = node.kind === "SELF"
    ? copy("Você", "You")
    : node.kind === "AGENCY"
      ? copy("Agência", "Agency")
      : copy("Agente", "Agent");
  const stageLabel = node.recruitmentStage
    ? (language === "PT" ? AGENCY_RECRUITMENT_STAGE_LABEL : AGENCY_RECRUITMENT_STAGE_LABEL_EN)[node.recruitmentStage]
    : null;
  const subscriptionLabel = (language === "PT" ? HIERARCHY_SUBSCRIPTION_STATUS_LABEL : HIERARCHY_SUBSCRIPTION_STATUS_LABEL_EN)[node.subscriptionStatus];

  return (
    <li className="hierarchy-outline-item">
      <div
        className="hierarchy-outline-person"
        data-kind={node.kind.toLowerCase()}
        aria-label={copy(
          "{name}, {kind}, nível {depth}{stage}, {subscription}",
          "{name}, {kind}, level {depth}{stage}, {subscription}",
          { name: node.name, kind: label, depth: node.depth, stage: stageLabel ? copy(`, etapa ${stageLabel}`, `, stage ${stageLabel}`) : "", subscription: subscriptionLabel },
        )}
      >
        <Avatar name={node.name} />
        <span className="hierarchy-outline-copy">
          <strong>{node.name}</strong>
          <span>
            {node.agencyName ?? (node.kind === "SELF" ? copy("Origem desta visão", "Starting point") : label)}
          </span>
        </span>
        <span className="hierarchy-outline-meta">
          <span data-kind={node.kind.toLowerCase()}>{label}</span>
          {stageLabel ? <small className="hierarchy-node-stage">{stageLabel}</small> : null}
          <small className="hierarchy-subscription-status" data-status={node.subscriptionStatus}>
            {subscriptionLabel}
          </small>
          <small>{copy("Nível {depth}", "Level {depth}", { depth: node.depth })}</small>
        </span>
      </div>

      {children.length > 0 ? (
        <ol className="hierarchy-outline-children">
          {children.map((child) => (
            <BranchItem key={child.node.agentId} branch={child} />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function HierarchyOutline({ nodes }: { nodes: readonly HierarchyViewNode[] }) {
  const { copy } = useI18n();
  const root = buildHierarchyBranch(nodes);
  if (!root) return null;

  return (
    <section className="hierarchy-outline" aria-labelledby="hierarchy-outline-title">
      <div className="hierarchy-outline-heading">
        <div>
          <h2 id="hierarchy-outline-title">{copy("Mapa da equipe por ramificação", "Team map by branch")}</h2>
          <p>{copy("Cada agente ou subagência aparece no ramo de quem criou o vínculo.", "Each agent or sub-agency appears under the branch of the person who created the link.")}</p>
        </div>
        <span>{copy("{count} na equipe", "{count} on the team", { count: Math.max(0, nodes.length - 1) })}</span>
      </div>
      <ol className="hierarchy-outline-root">
        <BranchItem branch={root} />
      </ol>
    </section>
  );
}
