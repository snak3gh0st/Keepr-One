// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  calendarExportFilename,
  downloadIcsCalendar,
  formatCalendarUtc,
  type CalendarEventDetails,
} from "@/lib/scheduling/calendar-export";

const event: CalendarEventDetails = {
  id: "booking-1",
  title: "Revisão, proteção & renda",
  ownerName: "María; Silva",
  startsAt: "2026-08-29T13:00:00.000Z",
  endsAt: "2026-08-29T13:30:00.000Z",
  timeZone: "America/New_York",
};

describe("calendar links", () => {
  it("formats UTC instants for calendar providers", () => {
    expect(formatCalendarUtc(event.startsAt)).toBe("20260829T130000Z");
    expect(() => formatCalendarUtc("not-a-date")).toThrow("Data de calendário inválida");
  });

  it("creates a prefilled Google Calendar URL", () => {
    const url = new URL(buildGoogleCalendarUrl(event));
    expect(url.origin).toBe("https://calendar.google.com");
    expect(url.pathname).toBe("/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe("20260829T130000Z/20260829T133000Z");
    expect(url.searchParams.get("details")).toContain("María; Silva");
    expect(url.searchParams.get("location")).toBe("Google Meet");
    expect(url.searchParams.get("ctz")).toBe("America/New_York");
  });

  it("creates a prefilled Outlook web URL", () => {
    const url = new URL(buildOutlookCalendarUrl(event));
    expect(url.origin).toBe("https://outlook.live.com");
    expect(url.pathname).toBe("/calendar/deeplink/compose");
    expect(url.searchParams.get("rru")).toBe("addevent");
    expect(url.searchParams.get("allday")).toBe("false");
    expect(url.searchParams.get("subject")).toBe(event.title);
    expect(url.searchParams.get("startdt")).toBe(event.startsAt);
    expect(url.searchParams.get("enddt")).toBe(event.endsAt);
  });

  it("creates a standards-based ICS file with escaped and folded content", () => {
    const longEvent = {
      ...event,
      title: `${event.title} — ${"planejamento ".repeat(8)}`,
    };
    const ics = buildIcsCalendar(longEvent, new Date("2026-08-28T17:00:00.000Z"));
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("UID:booking-1@calendar.keeprone.com\r\n");
    expect(ics).toContain("DTSTAMP:20260828T170000Z\r\n");
    expect(ics).toContain("DTSTART:20260829T130000Z\r\n");
    expect(ics).toContain("DTEND:20260829T133000Z\r\n");
    expect(ics).toContain("Revisão\\, proteção & renda");
    expect(ics).toContain("María\\; Silva");
    expect(ics).toContain("CLASS:PRIVATE\r\n");
    expect(ics).toContain("\r\n ");
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    for (const line of ics.trimEnd().split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("builds a safe, readable calendar filename", () => {
    expect(calendarExportFilename("Revisão: Proteção / Renda")).toBe("revisao-protecao-renda.ics");
    expect(calendarExportFilename("---")).toBe("agendamento-keepr-one.ics");
  });

  it("downloads the universal calendar file without exposing event data in a URL", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:keepr-calendar");
    const revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });

    try {
      downloadIcsCalendar(event);

      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(click).toHaveBeenCalledOnce();
      expect(document.querySelector('a[href="blob:keepr-calendar"]')).toBeNull();
      vi.advanceTimersByTime(1_000);
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:keepr-calendar");
    } finally {
      vi.useRealTimers();
      click.mockRestore();
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    }
  });

  it("rejects an inverted interval", () => {
    expect(() => buildIcsCalendar({ ...event, endsAt: event.startsAt })).toThrow(
      "O fim do agendamento deve ser posterior ao início",
    );
  });
});
