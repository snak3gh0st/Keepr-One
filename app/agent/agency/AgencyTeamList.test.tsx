// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgencyTeamList, type AgencyTeamMember } from "./AgencyTeamList";

afterEach(cleanup);

const members: AgencyTeamMember[] = [
  {
    id: "owner-1",
    name: "Agente Topo",
    email: "topo@example.com",
    role: "Responsável",
    statusLabel: "Assinatura ativa",
    statusTone: "success",
    priceLabel: "Plano Agência",
  },
  {
    id: "agent-2",
    name: "Maria Silva",
    email: "maria@example.com",
    role: "Agente convidado",
    statusLabel: "Pagamento pendente",
    statusTone: "warning",
    priceLabel: "US$ 49,90/mês",
  },
];

describe("AgencyTeamList", () => {
  it("shows direct team members as operational rows", () => {
    render(
      <AgencyTeamList members={members} agencyName="Agência Principal" />,
    );

    const table = screen.getByRole("table", {
      name: "Equipe e assinaturas da Agência Principal",
    });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByText("Agente Topo")).toBeVisible();
    expect(within(table).getByText("Maria Silva")).toBeVisible();
    expect(within(table).getByText("US$ 49,90/mês")).toBeVisible();
    expect(within(table).getByText("Pagamento pendente")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });

  it("explains how to start when the team is empty", () => {
    render(<AgencyTeamList members={[]} agencyName="Agência Principal" />);

    expect(
      screen.getByText("A equipe ainda não possui vínculos ativos."),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
