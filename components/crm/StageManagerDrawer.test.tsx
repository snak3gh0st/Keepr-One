// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StageManagerDrawer } from "./StageManagerDrawer";

const stages = [
  { id: "new", name: "Novo Lead", position: 0, systemKey: "NEW_LEAD", active: true, caseCount: 2 },
  { id: "follow", name: "Follow-up", position: 1, systemKey: "FOLLOW_UP", active: true, caseCount: 0 },
];

afterEach(cleanup);

describe("StageManagerDrawer", () => {
  it("requires a custom destination before removing a default stage", async () => {
    render(
      <StageManagerDrawer
        open
        onClose={vi.fn()}
        stages={stages}
        onChanged={vi.fn()}
        actions={{
          create: vi.fn(async () => ({ ok: true as const })),
          rename: vi.fn(async () => ({ ok: true as const })),
          reorder: vi.fn(async () => ({ ok: true as const })),
          archive: vi.fn(async () => ({ ok: true as const })),
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Remover Novo Lead" }));
    expect(await screen.findByText(/crie primeiro uma etapa personalizada/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Transferir para" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remover etapa" })).toBeDisabled();
  });

  it("rolls back an optimistic reorder when persistence fails", async () => {
    const reorder = vi.fn(async () => ({ ok: false as const, message: "Conflito de ordem." }));
    render(
      <StageManagerDrawer
        open
        onClose={vi.fn()}
        stages={stages}
        onChanged={vi.fn()}
        actions={{
          create: vi.fn(async () => ({ ok: true as const })),
          rename: vi.fn(async () => ({ ok: true as const })),
          reorder,
          archive: vi.fn(async () => ({ ok: true as const })),
        }}
      />,
    );

    const list = screen.getByRole("list");
    expect(list).toHaveTextContent(/Novo Lead.*Follow-up/);
    await userEvent.click(screen.getByRole("button", { name: "Mover Novo Lead para baixo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conflito de ordem.");
    await waitFor(() => expect(list).toHaveTextContent(/Novo Lead.*Follow-up/));
  });
});
