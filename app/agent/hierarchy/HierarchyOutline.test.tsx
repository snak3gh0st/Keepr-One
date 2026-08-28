// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HierarchyOutline } from "./HierarchyOutline";
import type { HierarchyViewNode } from "./view-model";

afterEach(cleanup);

const nodes: HierarchyViewNode[] = [
  { agentId: "root", name: "Felipe Lima", parentAgentId: null, depth: 0, kind: "SELF", agencyName: "Keepr One", recruitmentStage: null, subscriptionStatus: "ACTIVE" },
  { agentId: "agency", name: "Marina Alves", parentAgentId: "root", depth: 1, kind: "AGENCY", agencyName: "Alves Financial", recruitmentStage: "QUALIFIED", subscriptionStatus: "TRIALING" },
  { agentId: "agent", name: "Caio Souza", parentAgentId: "agency", depth: 2, kind: "AGENT", agencyName: null, recruitmentStage: "ACTIVE", subscriptionStatus: "PAST_DUE" },
];

describe("HierarchyOutline", () => {
  it("renders a semantic nested ordered list with agency labels and levels", () => {
    const { container } = render(<HierarchyOutline nodes={nodes} />);

    expect(screen.getByRole("heading", { name: "Mapa da equipe por ramificação" })).toBeInTheDocument();
    expect(screen.getByText("Cada agente ou subagência aparece no ramo de quem criou o vínculo.")).toBeVisible();
    expect(screen.getByLabelText("Felipe Lima, Você, nível 0, Assinatura ativa")).toBeInTheDocument();
    expect(screen.getByLabelText("Marina Alves, Agência, nível 1, etapa Qualificado, Período de teste")).toHaveTextContent("Alves Financial");
    expect(screen.getByLabelText("Caio Souza, Agente, nível 2, etapa Ativo, Pagamento pendente")).toBeInTheDocument();
    expect(screen.getByText("Qualificado")).toBeVisible();
    expect(screen.getByText("Pagamento pendente")).toBeVisible();

    const orderedLists = container.querySelectorAll("ol");
    expect(orderedLists).toHaveLength(3);
    expect(within(orderedLists[0]!).getByText("Felipe Lima")).toBeInTheDocument();
  });

  it("does not render an empty tree", () => {
    const { container } = render(<HierarchyOutline nodes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
