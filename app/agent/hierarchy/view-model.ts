import {
  sanitizeAgencyRecruitmentStage,
  type AgencyRecruitmentStageValue,
} from "../agency/recruitment-ui";

export type HierarchySubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED"
  | "NO_SUBSCRIPTION";

export const HIERARCHY_SUBSCRIPTION_STATUS_LABEL: Record<
  HierarchySubscriptionStatus,
  string
> = {
  TRIALING: "Período de teste",
  ACTIVE: "Assinatura ativa",
  PAST_DUE: "Pagamento pendente",
  CANCELED: "Assinatura cancelada",
  EXPIRED: "Assinatura expirada",
  NO_SUBSCRIPTION: "Sem assinatura",
};

const HIERARCHY_SUBSCRIPTION_STATUS_SET = new Set<string>(
  Object.keys(HIERARCHY_SUBSCRIPTION_STATUS_LABEL),
);

export function sanitizeHierarchySubscriptionStatus(
  value: string | null | undefined,
): HierarchySubscriptionStatus {
  return value && HIERARCHY_SUBSCRIPTION_STATUS_SET.has(value)
    ? (value as HierarchySubscriptionStatus)
    : "NO_SUBSCRIPTION";
}

export type AgencyTreeNodeInput = {
  agentId: string;
  name: string;
  parentAgentId: string | null;
  depth: number;
  kind: "SELF" | "AGENT" | "AGENCY";
  agencyName: string | null;
  subscriptionStatus?: string | null;
  recruitmentStage?: string | null;
};

export type HierarchyViewNode = {
  agentId: string;
  name: string;
  parentAgentId: string | null;
  depth: number;
  kind: "SELF" | "AGENT" | "AGENCY";
  agencyName: string | null;
  recruitmentStage: AgencyRecruitmentStageValue | null;
  subscriptionStatus: HierarchySubscriptionStatus;
};

export type HierarchyBranch = {
  node: HierarchyViewNode;
  children: HierarchyBranch[];
};

/**
 * Keeps the service's stable order while enforcing the client boundary again:
 * only the selected root and nodes whose complete parent chain reaches it are
 * allowed into the browser payload. The root's real parent is deliberately
 * erased so an upline identifier is never serialized.
 */
export function createHierarchyView(
  input: readonly AgencyTreeNodeInput[],
  rootAgentId: string,
): HierarchyViewNode[] {
  const uniqueInput: AgencyTreeNodeInput[] = [];
  const seenIds = new Set<string>();

  for (const node of input) {
    if (seenIds.has(node.agentId)) continue;
    seenIds.add(node.agentId);
    uniqueInput.push(node);
  }

  const inputById = new Map(uniqueInput.map((node) => [node.agentId, node]));
  const root = inputById.get(rootAgentId);
  if (!root) return [];

  const reachesRootMemo = new Map<string, boolean>([[rootAgentId, true]]);
  const depthMemo = new Map<string, number>([[rootAgentId, 0]]);

  function reachesRoot(agentId: string, trail = new Set<string>()): boolean {
    const cached = reachesRootMemo.get(agentId);
    if (cached !== undefined) return cached;
    if (trail.has(agentId)) return false;

    const node = inputById.get(agentId);
    if (!node?.parentAgentId) {
      reachesRootMemo.set(agentId, false);
      return false;
    }

    const nextTrail = new Set(trail);
    nextTrail.add(agentId);
    const result = reachesRoot(node.parentAgentId, nextTrail);
    reachesRootMemo.set(agentId, result);
    return result;
  }

  function getDepth(agentId: string): number {
    const cached = depthMemo.get(agentId);
    if (cached !== undefined) return cached;

    const node = inputById.get(agentId);
    const parentDepth = node?.parentAgentId ? getDepth(node.parentAgentId) : -1;
    const depth = parentDepth + 1;
    depthMemo.set(agentId, depth);
    return depth;
  }

  return uniqueInput.flatMap((node): HierarchyViewNode[] => {
    if (node.agentId !== rootAgentId && !reachesRoot(node.agentId)) return [];

    const isRoot = node.agentId === rootAgentId;
    return [{
      agentId: node.agentId,
      name: node.name,
      parentAgentId: isRoot ? null : node.parentAgentId,
      depth: isRoot ? 0 : getDepth(node.agentId),
      kind: isRoot ? "SELF" : node.kind === "SELF" ? "AGENT" : node.kind,
      agencyName: node.agencyName,
      recruitmentStage: sanitizeAgencyRecruitmentStage(node.recruitmentStage),
      subscriptionStatus: sanitizeHierarchySubscriptionStatus(node.subscriptionStatus),
    }];
  });
}

export function buildHierarchyBranch(
  nodes: readonly HierarchyViewNode[],
): HierarchyBranch | null {
  const root = nodes.find((node) => node.parentAgentId === null);
  if (!root) return null;

  const childrenByParent = new Map<string, HierarchyViewNode[]>();
  for (const node of nodes) {
    if (!node.parentAgentId) continue;
    const siblings = childrenByParent.get(node.parentAgentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentAgentId, siblings);
  }

  const visited = new Set<string>();
  function makeBranch(node: HierarchyViewNode): HierarchyBranch {
    if (visited.has(node.agentId)) return { node, children: [] };
    visited.add(node.agentId);
    return {
      node,
      children: (childrenByParent.get(node.agentId) ?? []).map(makeBranch),
    };
  }

  return makeBranch(root);
}

export function getHierarchySummary(nodes: readonly HierarchyViewNode[]) {
  return {
    peopleBelow: Math.max(0, nodes.length - 1),
    agenciesBelow: nodes.filter((node) => node.kind === "AGENCY").length,
    depth: nodes.reduce((maximum, node) => Math.max(maximum, node.depth), 0),
  };
}
