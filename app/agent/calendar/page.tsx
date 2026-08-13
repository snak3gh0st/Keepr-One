import { Shell } from "@/components/Shell";
import { CalendarWorkspaceLoader } from "@/components/calendar/CalendarWorkspaceLoader";
import { getCurrentAgent } from "@/lib/agent-context";
import { prisma } from "@/lib/prisma";
import { dayBoundsInTimeZone, zonedParts, zonedDateTimeToUtc } from "@/lib/calendar";
import {
  cancelCalendarEventAction,
  associateCalendarCaseAction,
  checkCalendarAvailabilityAction,
  createCalendarEventAction,
  deleteCalendarEventAction,
  getCalendarEventAction,
  getCalendarPageData,
  moveCalendarEventAction,
  retryCalendarEventSyncAction,
  setCalendarPreferencesAction,
  updateCalendarEventAction,
} from "./actions";

export const dynamic = "force-dynamic";

function initialRange(now: Date, timeZone: string) {
  const local = zonedParts(now, timeZone);
  const monthStart = zonedDateTimeToUtc({ year: local.year, month: local.month, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
  const nextMonth = local.month === 12 ? 1 : local.month + 1;
  const nextYear = local.month === 12 ? local.year + 1 : local.year;
  const monthEnd = zonedDateTimeToUtc({ year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 }, timeZone);
  // FullCalendar can render adjacent dates, so retain a safe margin and avoid
  // an initial waterfall when users change from week to month.
  return {
    start: new Date(monthStart.getTime() - 8 * 86_400_000).toISOString(),
    end: new Date(monthEnd.getTime() + 8 * 86_400_000).toISOString(),
  };
}

type AgentCalendarPageProps = {
  searchParams: Promise<{ event?: string | string[] }>;
};

export default async function AgentCalendarPage({ searchParams }: AgentCalendarPageProps) {
  const agent = await getCurrentAgent();
  const user = await prisma.user.findUnique({ where: { id: agent.userId }, select: { name: true, timeZone: true } });
  if (!user) throw new Error("Calendar user not found");
  // Validate the timezone through the calendar domain before it reaches Intl.
  dayBoundsInTimeZone(new Date(), user.timeZone);
  const query = await searchParams;
  const requestedEventId = Array.isArray(query.event) ? query.event[0] : query.event;
  const data = await getCalendarPageData(initialRange(new Date(), user.timeZone));
  const requestedEvent = requestedEventId && !data.events.some((event) => event.id === requestedEventId)
    ? await getCalendarEventAction(requestedEventId)
    : null;
  const initialData = requestedEvent ? { ...data, events: [...data.events, requestedEvent] } : data;

  return (
    <Shell role="AGENT" userName={user.name}>
      <CalendarWorkspaceLoader
        initialData={initialData}
        onCreate={createCalendarEventAction}
        onUpdate={updateCalendarEventAction}
        onCancel={cancelCalendarEventAction}
        onDelete={deleteCalendarEventAction}
        onMove={moveCalendarEventAction}
        onRetrySync={retryCalendarEventSyncAction}
        onRangeChange={getCalendarPageData}
        onResolveEvent={getCalendarEventAction}
        onPreferencesChange={setCalendarPreferencesAction}
        onAssociateCase={associateCalendarCaseAction}
        onCheckAvailability={checkCalendarAvailabilityAction}
        onRefresh={getCalendarPageData}
      />
    </Shell>
  );
}
