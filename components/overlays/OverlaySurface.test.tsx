// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlaySurface } from "./OverlaySurface";

afterEach(cleanup);

describe("OverlaySurface", () => {
  it("inerts outside content, traps focus and restores the opener", async () => {
    const close = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Abrir painel</button>
        <OverlaySurface open={false} onClose={close} titleId="surface-title">
          <h2 id="surface-title">Painel</h2>
          <button type="button">Primeira ação</button>
          <button type="button">Última ação</button>
        </OverlaySurface>
      </>,
    );
    const opener = screen.getByRole("button", { name: "Abrir painel" });
    opener.focus();

    rerender(
      <>
        <button type="button">Abrir painel</button>
        <OverlaySurface open onClose={close} titleId="surface-title">
          <h2 id="surface-title">Painel</h2>
          <button type="button">Primeira ação</button>
          <button type="button">Última ação</button>
        </OverlaySurface>
      </>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Primeira ação" })).toHaveFocus());
    expect(screen.getByText("Abrir painel", { selector: "button" })).toHaveAttribute("inert");
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole("button", { name: "Última ação" })).toHaveFocus();

    rerender(
      <>
        <button type="button">Abrir painel</button>
        <OverlaySurface open={false} onClose={close} titleId="surface-title">
          <h2 id="surface-title">Painel</h2>
        </OverlaySurface>
      </>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Abrir painel" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "Abrir painel" })).not.toHaveAttribute("inert");
  });
});
