// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HierarchyCanvas } from "./HierarchyCanvas";
import type { HierarchyViewNode } from "./view-model";

const root: HierarchyViewNode = {
  agentId: "root",
  name: "Felipe Lima",
  parentAgentId: null,
  depth: 0,
  kind: "SELF",
  agencyName: "Keepr One",
  recruitmentStage: null,
  subscriptionStatus: "ACTIVE",
};

describe("HierarchyCanvas", () => {
  it("offers the invitation path when the signed-in agency has no descendants", () => {
    render(<HierarchyCanvas agents={[root]} />);

    expect(screen.getByRole("heading", { name: "Mapa da equipe" })).toBeInTheDocument();
    expect(screen.getByText("O mapa da equipe começa em Felipe Lima.")).toBeInTheDocument();
    expect(screen.getByText("Ainda não há agentes ou subagências em nenhuma ramificação.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Convidar para a equipe" })).toHaveAttribute(
      "href",
      "/agent/agency#invite-agent-title",
    );
  });
});
