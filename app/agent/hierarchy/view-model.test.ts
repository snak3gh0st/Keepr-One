import { describe, expect, it } from "vitest";
import {
  buildHierarchyBranch,
  createHierarchyView,
  getHierarchySummary,
  type AgencyTreeNodeInput,
} from "./view-model";

const nestedTree: AgencyTreeNodeInput[] = [
  {
    agentId: "root",
    name: "Agência Principal",
    parentAgentId: "ancestor-that-must-not-leak",
    depth: 9,
    kind: "SELF",
    agencyName: "Principal",
    recruitmentStage: null,
    subscriptionStatus: "ACTIVE",
  },
  {
    agentId: "subagency",
    name: "Marina Alves",
    parentAgentId: "root",
    depth: 99,
    kind: "AGENCY",
    agencyName: "Alves Financial",
    recruitmentStage: "QUALIFIED",
    subscriptionStatus: "TRIALING",
  },
  {
    agentId: "subagent",
    name: "Caio Lima",
    parentAgentId: "subagency",
    depth: 99,
    kind: "AGENT",
    agencyName: null,
    recruitmentStage: "UNTRUSTED_STAGE",
    subscriptionStatus: "UNTRUSTED_STATUS",
  },
  {
    agentId: "sibling",
    name: "Bianca Costa",
    parentAgentId: "root",
    depth: 99,
    kind: "AGENT",
    agencyName: null,
    recruitmentStage: null,
    subscriptionStatus: "PAST_DUE",
  },
];

describe("createHierarchyView", () => {
  it("starts at the signed-in agent, erases its parent and recalculates depth", () => {
    expect(createHierarchyView(nestedTree, "root")).toEqual([
      expect.objectContaining({ agentId: "root", parentAgentId: null, depth: 0, kind: "SELF" }),
      expect.objectContaining({ agentId: "subagency", parentAgentId: "root", depth: 1 }),
      expect.objectContaining({ agentId: "subagent", parentAgentId: "subagency", depth: 2, recruitmentStage: null, subscriptionStatus: "NO_SUBSCRIPTION" }),
      expect.objectContaining({ agentId: "sibling", parentAgentId: "root", depth: 1 }),
    ]);
    expect(JSON.stringify(createHierarchyView(nestedTree, "root"))).not.toContain(
      "ancestor-that-must-not-leak",
    );
    expect(createHierarchyView(nestedTree, "root")[1]?.recruitmentStage).toBe("QUALIFIED");
    expect(createHierarchyView(nestedTree, "root")[1]?.subscriptionStatus).toBe("TRIALING");
    expect(JSON.stringify(createHierarchyView(nestedTree, "root"))).not.toContain("UNTRUSTED_STAGE");
    expect(JSON.stringify(createHierarchyView(nestedTree, "root"))).not.toContain("UNTRUSTED_STATUS");
  });

  it("drops ancestors, unrelated roots, orphans, cycles and duplicate ids", () => {
    const polluted: AgencyTreeNodeInput[] = [
      ...nestedTree,
      { ...nestedTree[1]!, name: "Duplicate" },
      { agentId: "ancestor", name: "Acima", parentAgentId: null, depth: 0, kind: "AGENCY", agencyName: "Acima" },
      { agentId: "orphan", name: "Órfão", parentAgentId: "missing", depth: 1, kind: "AGENT", agencyName: null },
      { agentId: "cycle-a", name: "A", parentAgentId: "cycle-b", depth: 1, kind: "AGENT", agencyName: null },
      { agentId: "cycle-b", name: "B", parentAgentId: "cycle-a", depth: 2, kind: "AGENT", agencyName: null },
    ];

    expect(createHierarchyView(polluted, "root").map((node) => node.agentId)).toEqual([
      "root",
      "subagency",
      "subagent",
      "sibling",
    ]);
  });

  it("preserves the service order and normalizes a second SELF node to AGENT", () => {
    const input = [nestedTree[0]!, nestedTree[3]!, { ...nestedTree[1]!, kind: "SELF" as const }];
    const view = createHierarchyView(input, "root");

    expect(view.map((node) => node.agentId)).toEqual(["root", "sibling", "subagency"]);
    expect(view[2]?.kind).toBe("AGENT");
  });
});

describe("hierarchy view helpers", () => {
  it("creates nested branches with service-defined sibling order", () => {
    const branch = buildHierarchyBranch(createHierarchyView(nestedTree, "root"));

    expect(branch?.node.agentId).toBe("root");
    expect(branch?.children.map(({ node }) => node.agentId)).toEqual(["subagency", "sibling"]);
    expect(branch?.children[0]?.children[0]?.node.agentId).toBe("subagent");
  });

  it("counts only descendants, descendant agencies and the deepest layer", () => {
    expect(getHierarchySummary(createHierarchyView(nestedTree, "root"))).toEqual({
      peopleBelow: 3,
      agenciesBelow: 1,
      depth: 2,
    });
  });
});
