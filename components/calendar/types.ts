export type CalendarViewMode = "month" | "week" | "day" | "list";

export type CalendarConnectionStatus =
  | "NOT_CONFIGURED"
  | "CONNECTED"
  | "SYNCING"
  | "RECONNECT_REQUIRED"
  | "ERROR"
  | "DISCONNECTED";

export type CalendarSyncStatus = "SYNCED" | "PENDING" | "PROCESSING" | "ERROR";

export type CalendarSourceView = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  isPrimary: boolean;
  isDefault: boolean;
  canWrite: boolean;
  syncStatus: CalendarSyncStatus;
};

export type CalendarCaseOption = {
  id: string;
  name: string;
  email?: string | null;
  stage?: string | null;
  stageSystemKey?: string | null;
};

export type CalendarEventView = {
  id: string;
  title: string;
  description?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  allDay: boolean;
  timeZone: string;
  location?: string | null;
  meetingUrl?: string | null;
  status: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  source: "CRM" | "GOOGLE";
  syncStatus: CalendarSyncStatus;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  case: CalendarCaseOption | null;
  attendees: Array<{ email: string; name?: string | null; responseStatus?: string }>;
  reminderMinutes: number | null;
  recurrence: string[];
  providerRecurringEventId: string | null;
  localRevision: number;
  canEdit: boolean;
  canDelete: boolean;
};

export type CalendarConnectionView = {
  status: CalendarConnectionStatus;
  email: string | null;
  displayName: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
};

export type CalendarPageData = {
  connection: CalendarConnectionView;
  calendars: CalendarSourceView[];
  events: CalendarEventView[];
  cases: CalendarCaseOption[];
  timeZone: string;
  focusDate: string;
  range: { start: string; end: string };
};

/**
 * Wall-clock values deliberately travel with an IANA timezone. The server is
 * responsible for turning them into instants and rejecting DST gaps.
 */
export type CalendarEventInput = {
  id?: string;
  title: string;
  description?: string | null;
  allDay: boolean;
  startsAtLocal: string | null;
  endsAtLocal: string | null;
  startDate: string | null;
  /** Exclusive on submit; CalendarEventModal presents an inclusive end date. */
  endDate: string | null;
  timeZone: string;
  location?: string | null;
  calendarId: string;
  caseId?: string | null;
  attendeeEmails: string[];
  createGoogleMeet: boolean;
  sendInvites: boolean;
  reminderMinutes: number | null;
  /** Required for compare-and-swap edits; omitted only on create. */
  baseRevision?: number;
  /** Explicit user override after the server reports a scheduling conflict. */
  allowConflict?: boolean;
  /** Short-lived server proof that the exact conflict was shown to this user. */
  conflictOverrideToken?: string;
};

export type CalendarMoveInput = {
  id: string;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  /** Exclusive for all-day events, matching Google Calendar and FullCalendar. */
  endDate: string | null;
  allDay: boolean;
  timeZone: string;
  baseRevision: number;
  /** Explicit user override after the server reports a scheduling conflict. */
  allowConflict?: boolean;
  conflictOverrideToken?: string;
};

export type CalendarPreferencesInput = {
  visibleCalendarIds: string[];
  defaultCalendarId: string;
};

export type CalendarMutationResult =
  | { ok: true; event?: CalendarEventView }
  | { ok: false; message: string; code?: string; conflicts?: CalendarConflict[]; conflictOverrideToken?: string };

export type CalendarRange = { start: string; end: string };

export type CalendarConflict = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
};

export type CalendarSuggestedSlot = {
  startsAtLocal: string;
  endsAtLocal: string;
  label: string;
};

export type CalendarAvailabilityResult =
  | { ok: true; conflicts: CalendarConflict[]; suggestedSlots: CalendarSuggestedSlot[] }
  | { ok: false; message: string };
