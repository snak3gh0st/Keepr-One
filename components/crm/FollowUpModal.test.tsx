// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowUpModal } from "./FollowUpModal";

afterEach(cleanup);

describe("FollowUpModal", () => {
  it("offers quick dates and sends a complete wall-clock value", async () => {
    const submit = vi.fn(async () => ({ ok: true as const }));
    render(
      <FollowUpModal
        open
        onClose={vi.fn()}
        prospectName="João Silva"
        initialDate="2026-08-16"
        onSubmit={submit}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Quando deseja fazer o follow-up?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/João Silva/)).toBeInTheDocument();
    const tomorrow = screen.getByRole("button", { name: "Amanhã" });
    expect(tomorrow).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(tomorrow);
    expect(tomorrow).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.clear(screen.getByLabelText("Data"));
    await userEvent.type(screen.getByLabelText("Data"), "2026-08-16");
    await userEvent.clear(screen.getByLabelText("Assunto"));
    await userEvent.type(screen.getByLabelText("Assunto"), "Revisar proposta");
    await userEvent.clear(screen.getByLabelText("Horário"));
    await userEvent.type(screen.getByLabelText("Horário"), "14:35");
    await userEvent.click(screen.getByRole("button", { name: "Agendar follow-up" }));

    expect(submit).toHaveBeenCalledWith({
      title: "Revisar proposta",
      scheduledAt: "2026-08-16T14:35",
    });
  });
});
