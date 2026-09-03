import { describe, expect, it } from "vitest";
import type { CalendarEventView } from "./types";
import {
  calendarEventContentData,
  dateKeyInTimeZone,
  eventOccursOnLocalDay,
  fullCalendarAllDayDateKey,
  fullCalendarOptionsForTimeZone,
  localDayIsWithinRange,
  rangeAroundLocalDay,
  shiftDateKey,
} from "./CalendarWorkspace";

describe("CalendarWorkspace timezone contract", () => {
  it("accepts FullCalendar selection mirrors without a domain event", () => {
    expect(calendarEventContentData(undefined)).toEqual({
      color: "currentColor",
      caseName: null,
    });
  });
  it("passes the user's IANA timezone to FullCalendar", () => {
    expect(fullCalendarOptionsForTimeZone("America/Los_Angeles")).toEqual({
      timeZone: "America/Los_Angeles",
    });
  });

  it("derives the calendar day from its configured timezone, not the device timezone", () => {
    const deviceTimeZone = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu";
    try {
      const instant = new Date("2026-08-12T02:30:00.000Z");
      expect(instant.getDate()).toBe(11);
      expect(dateKeyInTimeZone(instant, "America/New_York")).toBe("2026-08-11");
      expect(dateKeyInTimeZone(instant, "Asia/Tokyo")).toBe("2026-08-12");
    } finally {
      if (deviceTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = deviceTimeZone;
    }
  });

  it("preserves FullCalendar's all-day date string across timezone boundaries", () => {
    const utcMidnightMarker = new Date("2026-08-12T00:00:00.000Z");
    // Converting this marker as an instant in New York would incorrectly yield
    // August 11; the dateStr is the authoritative all-day calendar date.
    expect(fullCalendarAllDayDateKey("2026-08-12", utcMidnightMarker, "America/New_York")).toBe("2026-08-12");
  });
});

describe("CalendarWorkspace mobile date semantics", () => {
  const allDayEvent = {
    allDay: true,
    startDate: "2026-08-10",
    endDate: "2026-08-13",
    startsAt: null,
  } as CalendarEventView;

  it("includes every day of a multi-day all-day event except its exclusive end", () => {
    expect(eventOccursOnLocalDay(allDayEvent, "2026-08-10", "America/New_York")).toBe(true);
    expect(eventOccursOnLocalDay(allDayEvent, "2026-08-12", "America/New_York")).toBe(true);
    expect(eventOccursOnLocalDay(allDayEvent, "2026-08-13", "America/New_York")).toBe(false);
  });

  it("keeps a single-day event visible when a provider omits its end date", () => {
    const singleDay = { ...allDayEvent, startDate: "2026-08-12", endDate: null };
    expect(eventOccursOnLocalDay(singleDay, "2026-08-12", "America/New_York")).toBe(true);
    expect(eventOccursOnLocalDay(singleDay, "2026-08-13", "America/New_York")).toBe(false);
  });

  it("detects whether a local date is covered and builds a safe fetch margin", () => {
    const range = {
      start: "2026-08-10T04:00:00.000Z",
      end: "2026-08-13T04:00:00.000Z",
    };
    expect(localDayIsWithinRange(range, "2026-08-12", "America/New_York")).toBe(true);
    expect(localDayIsWithinRange(range, "2026-08-13", "America/New_York")).toBe(false);
    const next = rangeAroundLocalDay("2026-08-13");
    expect(new Date(next.start) < new Date("2026-08-13T00:00:00.000Z")).toBe(true);
    expect(new Date(next.end) > new Date("2026-08-14T00:00:00.000Z")).toBe(true);
  });

  it("moves the mobile date rail by calendar dates across a DST boundary", () => {
    expect(shiftDateKey("2026-03-08", -1)).toBe("2026-03-07");
    expect(shiftDateKey("2026-03-08", 1)).toBe("2026-03-09");
  });
});
