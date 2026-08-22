// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildQuickCreateInput, CalendarQuickCreate } from "./CalendarQuickCreate";
import type { CalendarSourceView } from "./types";

const calendar: CalendarSourceView = {
  id: "calendar-primary",
  name: "Agenda principal",
  color: "#69df93",
  visible: true,
  isPrimary: true,
  isDefault: true,
  canWrite: true,
  syncStatus: "SYNCED",
};

const slot = {
  start: "2026-08-20T13:00:00.000Z",
  end: "2026-08-20T13:30:00.000Z",
  allDay: false,
  anchor: { x: 320, y: 240 },
};

afterEach(cleanup);

describe("CalendarQuickCreate", () => {
  it("builds a minimal safe event in the user's wall-clock timezone", () => {
    expect(buildQuickCreateInput({
      slot,
      title: " Revisar proposta ",
      caseId: "case-1",
      timeZone: "UTC",
      calendars: [calendar],
    })).toMatchObject({
      title: "Revisar proposta",
      startsAtLocal: "2026-08-20T13:00",
      endsAtLocal: "2026-08-20T13:30",
      calendarId: calendar.id,
      caseId: "case-1",
      reminderMinutes: 15,
      sendInvites: false,
    });
  });

  it("creates from the compact form and preserves lead selection", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    render(
      <CalendarQuickCreate
        slot={slot}
        timeZone="UTC"
        calendars={[calendar]}
        cases={[{ id: "case-1", name: "Ana Ribeiro" }]}
        onCreate={onCreate}
        onClose={onClose}
        onMoreOptions={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Título"), "Revisar proposta");
    await user.selectOptions(screen.getByLabelText("Lead ou cliente"), "case-1");
    await user.click(screen.getByRole("button", { name: /^Criar/ }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: "Revisar proposta",
      caseId: "case-1",
    })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hands the draft to the complete editor", async () => {
    const user = userEvent.setup();
    const onMoreOptions = vi.fn();
    render(
      <CalendarQuickCreate
        slot={slot}
        timeZone="UTC"
        calendars={[calendar]}
        cases={[]}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        onMoreOptions={onMoreOptions}
      />,
    );
    await user.type(screen.getByLabelText("Título"), "Reunião de revisão");
    await user.click(screen.getByRole("button", { name: "Mais opções" }));
    expect(onMoreOptions).toHaveBeenCalledWith({ title: "Reunião de revisão", caseId: null });
  });
});
