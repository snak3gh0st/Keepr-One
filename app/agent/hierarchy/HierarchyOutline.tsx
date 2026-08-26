import { Avatar } from "@/components/Avatar";
import { AGENCY_RECRUITMENT_STAGE_LABEL } from "../agency/recruitment-ui";
import {
  buildHierarchyBranch,
  HIERARCHY_SUBSCRIPTION_STATUS_LABEL,
  type HierarchyBranch,
  type HierarchyViewNode,
} from "./view-model";

function kindLabel(kind: HierarchyViewNode["kind"]): string {
  if (kind === "SELF") return "Você";
  if (kind === "AGENCY") return "Agência";
  return "Agente";
}

function BranchItem({ branch }: { branch: HierarchyBranch }) {
  const { node, children } = branch;
  const label = kindLabel(node.kind);
  const stageLabel = node.recruitmentStage
    ? AGENCY_RECRUITMENT_STAGE_LABEL[node.recruitmentStage]
    : null;
  const subscriptionLabel = HIERARCHY_SUBSCRIPTION_STATUS_LABEL[node.subscriptionStatus];

  return (
    <li className="hierarchy-outline-item">
      <div
        className="hierarchy-outline-person"
        data-kind={node.kind.toLowerCase()}
        aria-label={`${node.name}, ${label}, nível ${node.depth}${stageLabel ? `, etapa ${stageLabel}` : ""}, ${subscriptionLabel}`}
      >
        <Avatar name={node.name} />
        <span className="hierarchy-outline-copy">
          <strong>{node.name}</strong>
          <span>
            {node.agencyName ?? (node.kind === "SELF" ? "Origem desta visão" : label)}
          </span>
        </span>
        <span className="hierarchy-outline-meta">
          <span data-kind={node.kind.toLowerCase()}>{label}</span>
          {stageLabel ? <small className="hierarchy-node-stage">{stageLabel}</small> : null}
          <small className="hierarchy-subscription-status" data-status={node.subscriptionStatus}>
            {subscriptionLabel}
          </small>
          <small>Nível {node.depth}</small>
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
  const root = buildHierarchyBranch(nodes);
  if (!root) return null;

  return (
    <section className="hierarchy-outline" aria-labelledby="hierarchy-outline-title">
      <div className="hierarchy-outline-heading">
        <div>
          <h2 id="hierarchy-outline-title">Ordem da sua estrutura</h2>
          <p>Cada pessoa aparece dentro do ramo de quem a convidou.</p>
        </div>
        <span>{Math.max(0, nodes.length - 1)} abaixo de você</span>
      </div>
      <ol className="hierarchy-outline-root">
        <BranchItem branch={root} />
      </ol>
    </section>
  );
}
