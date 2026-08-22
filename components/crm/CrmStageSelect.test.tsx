// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrmStageSelect } from "./CrmStageSelect";

const stages = [
  { id: "new", name: "Novo Lead", position: 0, systemKey: "NEW_LEAD", active: true, caseCount: 1 },
  { id: "qualified", name: "Qualificado", position: 1, systemKey: "QUALIFIED", active: true, caseCount: 0 },
];

afterEach(cleanup);

describe("CrmStageSelect", () => {
  it("keeps a failed save visible and exposes its busy state", async () => {
    let resolveChange: ((value: { ok: false; message: string }) => void) | undefined;
    const onChange = vi.fn(
      () => new Promise<{ ok: false; message: string }>((resolve) => { resolveChange = resolve; }),
    );
    render(
      <CrmStageSelect
        caseId="case-1"
        stage={stages[0]}
        stages={stages}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Alterar etapa/ }));
    await userEvent.selectOptions(screen.getByRole("combobox"), "qualified");
    expect(screen.getByRole("combobox").parentElement).toHaveAttribute("aria-busy", "true");
    resolveChange?.({ ok: false, message: "Etapa inválida para este agente." });

    expect(await screen.findByRole("alert")).toHaveTextContent("Etapa inválida para este agente.");
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true"));
  });
});
