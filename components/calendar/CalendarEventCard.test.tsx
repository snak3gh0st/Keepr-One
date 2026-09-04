// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarEventCard } from "./CalendarEventCard";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import type { CalendarEventView } from "./types";

vi.mock("@/lib/auth-client", () => ({
  authClient: { updateUser: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const event: CalendarEventView = {
  id: "event/42",
  title: "Reunião de proposta",
  description: null,
  startsAt: "2026-08-20T13:00:00.000Z",
  endsAt: "2026-08-20T13:30:00.000Z",
  startDate: null,
  endDate: null,
  allDay: false,
  timeZone: "UTC",
  location: "Google Meet",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  status: "CONFIRMED",
  source: "GOOGLE",
  syncStatus: "SYNCED",
  calendarId: "calendar-primary",
  calendarName: "Agenda principal",
  calendarColor: "#2563eb",
  case: { id: "case-1", name: "Ana Ribeiro" },
  attendees: [],
  reminderMinutes: 15,
  recurrence: [],
  providerRecurringEventId: null,
  localRevision: 3,
  canEdit: true,
  canDelete: true,
};

afterEach(cleanup);

describe("CalendarEventCard", () => {
  it("falls back to the calendar route and keeps Meet and lead links available", () => {
    render(<CalendarEventCard event={event} />);

    expect(
      screen.getByRole("link", { name: `Abrir compromisso ${event.title}` }),
    ).toHaveAttribute("href", "/agent/calendar?event=event%2F42");

    const meetLink = screen.getByRole("link", { name: "Entrar no Meet" });
    expect(meetLink).toHaveAttribute("href", event.meetingUrl);
    expect(meetLink).toHaveAttribute("target", "_blank");
    expect(meetLink).toHaveAttribute("rel", "noreferrer");

    expect(screen.getByRole("link", { name: "Abrir lead" })).toHaveAttribute(
      "href",
      "/agent/cases/case-1",
    );
  });

  it("derives a completed label from a past end time without persisting another timeline row", () => {
    render(<CalendarEventCard event={{ ...event, endsAt: "2020-08-20T13:30:00.000Z" }} />);

    expect(screen.getByText("✓ Concluída")).toBeInTheDocument();
  });

  it("respects the event timezone and exclusive end date for all-day completion", () => {
    render(<CalendarEventCard event={{
      ...event,
      allDay: true,
      startsAt: null,
      endsAt: null,
      startDate: "2020-08-20",
      endDate: "2020-08-21",
      timeZone: "America/New_York",
    }} />);

    expect(screen.getByText("✓ Concluída")).toBeInTheDocument();
  });

  it("formats timed events in the account display timezone", () => {
    render(<CalendarEventCard event={{
      ...event,
      startsAt: "2026-09-04T16:00:00.000Z",
      endsAt: "2026-09-04T16:30:00.000Z",
      timeZone: "America/Sao_Paulo",
    }} displayTimeZone="America/New_York" />);

    expect(screen.getByText(/12:00/)).toBeInTheDocument();
    expect(screen.queryByText(/13:00/)).not.toBeInTheDocument();
  });

  it("renders controls and derived states in English", () => {
    render(
      <LanguageProvider initialLanguage="EN">
        <CalendarEventCard event={{ ...event, endsAt: "2020-08-20T13:30:00.000Z" }} />
      </LanguageProvider>,
    );

    expect(screen.getByRole("link", { name: `Open event ${event.title}` })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join Meet" })).toBeInTheDocument();
    expect(screen.getByText("✓ Completed")).toBeInTheDocument();
  });

});
