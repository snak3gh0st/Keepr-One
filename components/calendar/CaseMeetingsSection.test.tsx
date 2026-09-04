// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { caseMeetingCopy, splitCaseMeetings } from "./CaseMeetingsSection";
import { CaseMeetingsSection } from "./CaseMeetingsSection";
import type { CalendarEventView } from "./types";

afterEach(cleanup);

function event(overrides: Partial<CalendarEventView> & Pick<CalendarEventView, "id">): CalendarEventView {
  return {
    id: overrides.id,
    title: overrides.title ?? "Reunião",
    description: null,
    startsAt: overrides.startsAt ?? "2026-08-12T14:00:00.000Z",
    endsAt: overrides.endsAt ?? "2026-08-12T14:30:00.000Z",
    startDate: null,
    endDate: null,
    allDay: false,
    timeZone: "America/New_York",
    location: null,
    meetingUrl: null,
    status: overrides.status ?? "CONFIRMED",
    source: "CRM",
    syncStatus: "SYNCED",
    calendarId: "calendar",
    calendarName: "Agenda principal",
    calendarColor: "#69df93",
    case: null,
    attendees: [],
  reminderMinutes: 15,
  recurrence: [],
  providerRecurringEventId: null,
    localRevision: 1,
    canEdit: true,
    canDelete: false,
  };
}

describe("CaseMeetingsSection helpers", () => {
  it("derives meeting copy from immutable stage semantics instead of labels", () => {
    expect(caseMeetingCopy("FIRST_MEETING_SCHEDULED", "Ana")).toMatchObject({ defaultTitle: "Primeira reunião · Ana", actionLabel: "Agendar reunião" });
    expect(caseMeetingCopy("RESCHEDULE_FIRST_MEETING", "Ana").actionLabel).toBe("Reagendar reunião");
    expect(caseMeetingCopy("ILLUSTRATION_SCHEDULED", "Ana").defaultTitle).toBe("Apresentação da ilustração · Ana");
    expect(caseMeetingCopy("RESCHEDULE_ILLUSTRATION", "Ana").actionLabel).toBe("Reagendar reunião");
    expect(caseMeetingCopy("APPLICATION", "Ana").defaultTitle).toBe("Revisão da aplicação · Ana");
    expect(caseMeetingCopy(null, "Ana").defaultTitle).toBe("Reunião com Ana");
    expect(caseMeetingCopy("APPLICATION", "Ana", "EN")).toMatchObject({
      defaultTitle: "Application review · Ana",
      actionLabel: "Schedule meeting",
    });
  });

  it("places the nearest active commitment first and keeps completed/cancelled history", () => {
    const result = splitCaseMeetings([
      event({ id: "later", startsAt: "2026-08-13T15:00:00.000Z", endsAt: "2026-08-13T15:30:00.000Z" }),
      event({ id: "next", startsAt: "2026-08-12T14:00:00.000Z", endsAt: "2026-08-12T14:30:00.000Z" }),
      event({ id: "past", startsAt: "2026-08-11T14:00:00.000Z", endsAt: "2026-08-11T14:30:00.000Z" }),
      event({ id: "cancelled", status: "CANCELLED", startsAt: "2026-08-15T14:00:00.000Z", endsAt: "2026-08-15T14:30:00.000Z" }),
    ], "2026-08-12T13:00:00.000Z");

    expect(result.next?.id).toBe("next");
    expect(result.upcoming.map((item) => item.id)).toEqual(["later"]);
    expect(result.history.map((item) => item.id)).toEqual(["cancelled", "past"]);
  });

  it("never exposes private event details to a leader viewing a downline lead", () => {
    render(
      <CaseMeetingsSection
        canManage={false}
        connection={{
          status: "CONNECTED",
          email: "agent-private@example.com",
          displayName: "Agente privado",
          lastSyncAt: null,
          errorMessage: null,
        }}
        events={[event({ id: "private-event", title: "Consulta médica particular" })]}
        now="2026-08-12T13:00:00.000Z"
        timeZone="America/New_York"
        systemKey="QUALIFIED"
        prospectName="Ana"
        onSchedule={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText("Agenda individual do agente responsável")).toBeInTheDocument();
    expect(screen.queryByText("Consulta médica particular")).not.toBeInTheDocument();
    expect(screen.queryByText("agent-private@example.com")).not.toBeInTheDocument();
  });
});
