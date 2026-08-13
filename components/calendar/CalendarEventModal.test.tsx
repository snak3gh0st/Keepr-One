// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventModal } from "./CalendarEventModal";
import type { CalendarEventView, CalendarSourceView } from "./types";

const calendar: CalendarSourceView = {
  id: "calendar-primary",
  name: "Agenda principal",
  color: "#2563eb",
  visible: true,
  isPrimary: true,
  isDefault: true,
  canWrite: true,
  syncStatus: "SYNCED",
};

const allDayEvent: CalendarEventView = {
  id: "event-all-day",
  title: "Conferência anual",
  description: null,
  startsAt: null,
  endsAt: null,
  startDate: "2026-08-20",
  // The domain value is exclusive, so the event is shown through August 22.
  endDate: "2026-08-23",
  allDay: true,
  timeZone: "UTC",
  location: null,
  meetingUrl: null,
  status: "CONFIRMED",
  source: "GOOGLE",
  syncStatus: "SYNCED",
  calendarId: calendar.id,
  calendarName: calendar.name,
  calendarColor: calendar.color,
  case: null,
  attendees: [],
  reminderMinutes: 15,
  recurrence: [],
  providerRecurringEventId: null,
  localRevision: 7,
  canEdit: true,
  canDelete: true,
};

afterEach(cleanup);

describe("CalendarEventModal", () => {
  it("shows end time, duration, reminder and Google recurrence in details", () => {
    render(
      <CalendarEventModal
        open
        mode="details"
        event={{
          ...allDayEvent,
          allDay: false,
          startsAt: "2026-08-20T13:00:00.000Z",
          endsAt: "2026-08-20T14:30:00.000Z",
          startDate: null,
          endDate: null,
          recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TH"],
        }}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        timeZone="UTC"
        calendars={[calendar]}
      />,
    );

    expect(screen.getByText("14:30 · 1 h 30 min")).toBeInTheDocument();
    expect(screen.getByText("15 minutos antes")).toBeInTheDocument();
    expect(screen.getByText("Repete semanalmente")).toBeInTheDocument();
  });
  it("only overrides a server-revalidated conflict after explicit confirmation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false as const,
        code: "SCHEDULE_CONFLICT",
        message: "Já existe um compromisso nesse horário.",
        conflictOverrideToken: "signed-proof",
        conflicts: [{
          id: "busy-1",
          title: "Reunião existente",
          startsAt: "2026-08-20T13:00:00.000Z",
          endsAt: "2026-08-20T13:30:00.000Z",
        }],
      })
      .mockResolvedValueOnce({ ok: true as const });

    render(<CalendarEventModal open mode="create" onClose={vi.fn()} onSubmit={onSubmit}
      initialStart="2026-08-20T13:00:00.000Z" initialEnd="2026-08-20T13:30:00.000Z"
      timeZone="UTC" calendars={[calendar]} />);
    await user.type(screen.getByLabelText("Título"), "Nova reunião");
    await user.click(screen.getByRole("button", { name: "Criar compromisso" }));

    expect(await screen.findByRole("button", { name: "Agendar mesmo assim" })).toBeInTheDocument();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("allowConflict");
    await user.click(screen.getByRole("button", { name: "Agendar mesmo assim" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({
      allowConflict: true,
      conflictOverrideToken: "signed-proof",
    });
  });

  it("confirms cancellation with title, time and guest impact before mutating", async () => {
    const user = userEvent.setup();
    const onCancelEvent = vi.fn(async () => ({ ok: true as const }));
    const cancellable = {
      ...allDayEvent,
      canDelete: false,
      attendees: [{ email: "ana@example.com", responseStatus: "ACCEPTED" }],
    };
    render(<CalendarEventModal open mode="details" event={cancellable} onClose={vi.fn()}
      onSubmit={vi.fn()} onCancelEvent={onCancelEvent} timeZone="UTC" calendars={[calendar]} />);

    await user.click(screen.getByRole("button", { name: "Cancelar compromisso" }));
    expect(onCancelEvent).not.toHaveBeenCalled();
    expect(screen.getByText(`Cancelar “${cancellable.title}”?`)).toBeInTheDocument();
    expect(screen.getByText(/1 convidado será avisado pelo Google/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.queryByText(`Cancelar “${cancellable.title}”?`)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancelar compromisso" }));
    const destructiveButtons = screen.getAllByRole("button", { name: "Cancelar compromisso" });
    await user.click(destructiveButtons.find((button) => !button.hasAttribute("disabled"))!);
    await waitFor(() => expect(onCancelEvent).toHaveBeenCalledWith(cancellable));
  });

  it("offers an idempotent manual retry for failed synchronization", async () => {
    const user = userEvent.setup();
    const onRetrySync = vi.fn(async () => ({ ok: true as const }));
    render(<CalendarEventModal open mode="details" event={{ ...allDayEvent, syncStatus: "ERROR" }}
      onClose={vi.fn()} onSubmit={vi.fn()} onRetrySync={onRetrySync}
      timeZone="UTC" calendars={[calendar]} />);
    expect(screen.getByText("O Google ainda não recebeu esta alteração.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(onRetrySync).toHaveBeenCalledOnce());
  });

  it("submits attendee chips and invitation options when creating an event", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => ({ ok: true as const }));

    render(
      <CalendarEventModal
        open
        mode="create"
        onClose={onClose}
        onSubmit={onSubmit}
        initialStart="2026-08-20T13:00:00.000Z"
        initialEnd="2026-08-20T13:45:00.000Z"
        initialCase={{ id: "case-1", name: "Ana Ribeiro" }}
        timeZone="UTC"
        calendars={[calendar]}
        cases={[{ id: "case-1", name: "Ana Ribeiro" }]}
      />,
    );

    await user.clear(screen.getByLabelText("Título"));
    await user.click(screen.getByLabelText("Título"));
    await user.type(screen.getByLabelText("Título"), "Revisar proposta");

    const attendeeInput = screen.getByPlaceholderText("email@cliente.com");
    await user.type(attendeeInput, "Alice@Example.COM");
    await user.click(screen.getByRole("button", { name: "Adicionar" }));
    await user.type(attendeeInput, "bob@example.com{Enter}");

    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remover alice@example.com" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Criar Google Meet/i }));
    await user.click(screen.getByRole("checkbox", { name: /Enviar convites/i }));
    await user.selectOptions(screen.getByLabelText("Lembrete"), "30");
    await user.click(screen.getByRole("button", { name: /Criar compromisso/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        id: undefined,
        title: "Revisar proposta",
        description: null,
        allDay: false,
        startsAtLocal: "2026-08-20T13:00",
        endsAtLocal: "2026-08-20T13:45",
        startDate: null,
        endDate: null,
        timeZone: "UTC",
        location: null,
        calendarId: calendar.id,
        caseId: "case-1",
        attendeeEmails: ["alice@example.com", "bob@example.com"],
        createGoogleMeet: true,
        sendInvites: false,
        reminderMinutes: 30,
        baseRevision: undefined,
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("shows inclusive all-day dates while submitting an exclusive domain end", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => ({ ok: true as const }));

    render(
      <CalendarEventModal
        open
        mode="edit"
        event={allDayEvent}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        timeZone="UTC"
        calendars={[calendar]}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Dia inteiro" })).toBeChecked();
    expect(screen.getByLabelText("Data")).toHaveValue("2026-08-20");
    expect(screen.getByLabelText("Até")).toHaveValue("2026-08-22");

    await user.click(screen.getByRole("button", { name: /Salvar alterações/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: allDayEvent.id,
        allDay: true,
        startsAtLocal: null,
        endsAtLocal: null,
        startDate: "2026-08-20",
        endDate: "2026-08-23",
        baseRevision: 7,
      }),
    );
  });

  it("checks availability and applies a suggested slot", async () => {
    const user = userEvent.setup();
    const onCheckAvailability = vi.fn(async () => ({
      ok: true as const,
      conflicts: [
        {
          id: "conflict-1",
          title: "Ligação com cliente",
          startsAt: "2026-08-20T13:00:00.000Z",
          endsAt: "2026-08-20T13:30:00.000Z",
        },
      ],
      suggestedSlots: [
        {
          startsAtLocal: "2026-08-20T15:00",
          endsAtLocal: "2026-08-20T15:30",
          label: "15:00–15:30",
        },
      ],
    }));

    render(
      <CalendarEventModal
        open
        mode="create"
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => ({ ok: true as const }))}
        onCheckAvailability={onCheckAvailability}
        initialStart="2026-08-20T13:00:00.000Z"
        initialEnd="2026-08-20T13:30:00.000Z"
        timeZone="UTC"
        calendars={[calendar]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Ver disponibilidade" }));

    expect(await screen.findByText("Existe um conflito nesse horário.")).toBeInTheDocument();
    expect(screen.getByText("Ligação com cliente")).toBeInTheDocument();
    expect(onCheckAvailability).toHaveBeenCalledWith({
      startsAtLocal: "2026-08-20T13:00",
      endsAtLocal: "2026-08-20T13:30",
      timeZone: "UTC",
      excludeEventId: undefined,
    });

    await user.click(screen.getByRole("button", { name: "15:00–15:30" }));

    expect(screen.getByLabelText("Início")).toHaveValue("2026-08-20T15:00");
    expect(screen.getByLabelText("Término")).toHaveValue("2026-08-20T15:30");
    expect(screen.queryByText("Existe um conflito nesse horário.")).not.toBeInTheDocument();
  });
});
