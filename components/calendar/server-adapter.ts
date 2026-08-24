import "server-only";

import type {
  CalendarConnectionView as DomainConnection,
  CalendarEventView as DomainEvent,
} from "@/lib/calendar/types";
import type {
  CalendarCaseOption,
  CalendarConnectionView,
  CalendarEventView,
  CalendarSourceView,
} from "./types";

const FALLBACK_CALENDAR_COLOR = "#69df93";
const WRITABLE_ROLES = new Set(["owner", "writer"]);

export function mapDomainCalendarConnectionToUi(
  connection: DomainConnection | null,
): { connection: CalendarConnectionView; calendars: CalendarSourceView[] } {
  if (!connection) {
    return {
      connection: {
        status: "DISCONNECTED",
        email: null,
        displayName: null,
        lastSyncAt: null,
        errorMessage: null,
      },
      calendars: [],
    };
  }

  return {
    connection: {
      status: connection.status,
      email: connection.providerEmail,
      displayName: connection.displayName,
      lastSyncAt: connection.lastSyncAt,
      errorMessage: connection.lastErrorCode,
    },
    calendars: connection.calendars.map((calendar) => ({
      id: calendar.id,
      name: calendar.name,
      color: calendar.backgroundColor ?? FALLBACK_CALENDAR_COLOR,
      visible: calendar.visible,
      isPrimary: calendar.isPrimary,
      isDefault: calendar.crmDefault,
      canWrite: Boolean(calendar.accessRole && WRITABLE_ROLES.has(calendar.accessRole)),
      syncStatus: calendar.syncStatus,
    })),
  };
}

export function mapDomainCalendarEventToUi(
  event: DomainEvent,
  options: {
    timeZone: string;
    case?: CalendarCaseOption | null;
    canWrite?: boolean;
  },
): CalendarEventView {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    startDate: event.startDate,
    // Remains exclusive in the view model for FullCalendar. CalendarEventModal
    // converts it to/from an inclusive date for humans at its boundary.
    endDate: event.endDate,
    allDay: event.allDay,
    timeZone: event.timeZone ?? options.timeZone,
    location: event.location,
    meetingUrl: event.meetingUrl,
    status: event.status,
    source: event.source,
    syncStatus: event.syncStatus,
    calendarId: event.calendar.id,
    calendarName: event.calendar.name,
    calendarColor: event.calendar.backgroundColor ?? FALLBACK_CALENDAR_COLOR,
    case: options.case ?? null,
    attendees: event.attendees.map((attendee) => ({
      email: attendee.email,
      name: attendee.name,
      responseStatus: attendee.responseStatus,
    })),
    reminderMinutes: reminderMinutes(event.reminders),
    recurrence: [...event.recurrence],
    providerRecurringEventId: event.providerRecurringEventId,
    localRevision: event.localRevision,
    canEdit: options.canWrite ?? true,
    // Calendar cancellation is append-only from the product perspective and
    // remains auditable in Google/CRM; the domain intentionally has no hard delete.
    canDelete: false,
  };
}

function reminderMinutes(value: DomainEvent["reminders"]): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.minutes === "number") return candidate.minutes;
  if (!Array.isArray(candidate.overrides)) return null;
  const first = candidate.overrides.find(
    (item) => item && typeof item === "object" && typeof (item as { minutes?: unknown }).minutes === "number",
  ) as { minutes?: number } | undefined;
  return first?.minutes ?? null;
}
