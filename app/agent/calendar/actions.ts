"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentAgent } from "@/lib/agent-context";
import {
  CalendarDomainError,
  cancelCalendarEvent,
  associateCalendarEventWithCase,
  createCalendarEvent,
  getCalendarConnectionForUser,
  getCalendarEventForUser,
  getCalendarEventsForRange,
  setCalendarPreferences,
  updateCalendarEvent,
  zonedDateTimeToUtc,
  retryCalendarEventSync,
  checkCalendarConflictPolicy,
} from "@/lib/calendar";
import { addCalendarDays } from "@/lib/calendar/time";
import { getGoogleCalendarEnv, isGoogleCalendarConfigured } from "@/lib/calendar/google/env";
import { getGoogleFreeBusyForUser } from "@/lib/calendar/google/freebusy";
import {
  mapDomainCalendarConnectionToUi,
  mapDomainCalendarEventToUi,
} from "@/components/calendar/server-adapter";
import type {
  CalendarAvailabilityResult,
  CalendarEventInput,
  CalendarMoveInput,
  CalendarMutationResult,
  CalendarPageData,
  CalendarPreferencesInput,
  CalendarRange,
} from "@/components/calendar/types";

const RANGE_LIMIT_MS = 400 * 86_400_000;
const WRITABLE_CALENDAR_ROLES = new Set(["owner", "writer"]);

function parseLocal(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new CalendarDomainError("VALIDATION_ERROR", "Horário local inválido.");
  try {
    return zonedDateTimeToUtc({
      year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
      hour: Number(match[4]), minute: Number(match[5]), second: 0,
    }, timeZone);
  } catch {
    throw new CalendarDomainError("VALIDATION_ERROR", "Esse horário não existe no fuso selecionado.");
  }
}

function toSchedule(input: Pick<CalendarEventInput, "allDay" | "startDate" | "endDate" | "startsAtLocal" | "endsAtLocal" | "timeZone">) {
  if (input.allDay) {
    if (!input.startDate || !input.endDate) throw new CalendarDomainError("VALIDATION_ERROR", "Informe o período do compromisso.");
    return { allDay: true as const, startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone };
  }
  if (!input.startsAtLocal || !input.endsAtLocal) throw new CalendarDomainError("VALIDATION_ERROR", "Informe início e término.");
  return {
    allDay: false as const,
    startsAt: parseLocal(input.startsAtLocal, input.timeZone),
    endsAt: parseLocal(input.endsAtLocal, input.timeZone),
    timeZone: input.timeZone,
  };
}

function reminderJson(minutes: number | null) {
  return minutes === null ? null : { useDefault: false, overrides: [{ method: "popup", minutes }] };
}

function revalidateCalendarSurfaces(caseId?: string | null) {
  revalidatePath("/agent/calendar");
  revalidatePath("/agent");
  if (caseId) revalidatePath(`/agent/cases/${caseId}`);
}

function mutationError(error: unknown): CalendarMutationResult {
  if (error instanceof CalendarDomainError) return { ok: false, message: error.message, code: error.code };
  console.error("Calendar mutation failed", error);
  return { ok: false, message: "Não foi possível salvar esse compromisso agora.", code: "UNEXPECTED_ERROR" };
}

async function userContext() {
  const agent = await getCurrentAgent();
  const user = await prisma.user.findUnique({ where: { id: agent.userId }, select: { timeZone: true } });
  if (!user) throw new Error("Calendar user not found");
  return { agent, timeZone: user.timeZone };
}

async function caseViews(ownerUserId: string) {
  const cases = await prisma.insuranceCase.findMany({
    where: { assignedAgent: { userId: ownerUserId }, status: "OPEN" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      prospect: { select: { firstName: true, lastName: true, email: true } },
      crmStage: { select: { name: true } },
    },
  });
  return cases.map((item) => ({
    id: item.id,
    name: `${item.prospect.firstName} ${item.prospect.lastName}`.trim(),
    email: item.prospect.email,
    stage: item.crmStage?.name ?? null,
  }));
}

async function caseView(ownerUserId: string, caseId: string | null | undefined) {
  if (!caseId) return null;
  const item = await prisma.insuranceCase.findFirst({
    where: { id: caseId, assignedAgent: { userId: ownerUserId } },
    select: { id: true, prospect: { select: { firstName: true, lastName: true, email: true } }, crmStage: { select: { name: true } } },
  });
  return item ? { id: item.id, name: `${item.prospect.firstName} ${item.prospect.lastName}`.trim(), email: item.prospect.email, stage: item.crmStage?.name ?? null } : null;
}

export async function getCalendarPageData(range: CalendarRange): Promise<CalendarPageData> {
  const { agent, timeZone } = await userContext();
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > RANGE_LIMIT_MS) {
    throw new CalendarDomainError("VALIDATION_ERROR", "Período da agenda inválido.");
  }
  const [connectionDomain, eventDomains, cases] = await Promise.all([
    getCalendarConnectionForUser(agent.userId),
    getCalendarEventsForRange({ ownerUserId: agent.userId, start, end }),
    caseViews(agent.userId),
  ]);
  const mapped = mapDomainCalendarConnectionToUi(connectionDomain);
  if (!connectionDomain && !isGoogleCalendarConfigured()) mapped.connection.status = "NOT_CONFIGURED";
  const caseMap = new Map(cases.map((item) => [item.id, item]));
  const calendarMap = new Map(mapped.calendars.map((item) => [item.id, item]));
  return {
    ...mapped,
    events: eventDomains.map((event) => mapDomainCalendarEventToUi(event, {
      timeZone,
      case: event.caseId ? caseMap.get(event.caseId) ?? null : null,
      canWrite: calendarMap.get(event.calendar.id)?.canWrite ?? false,
    })),
    cases,
    timeZone,
    focusDate: new Date().toISOString(),
    range: { start: start.toISOString(), end: end.toISOString() },
  };
}

/** Resolves a notification/deep-link target outside the loaded grid range. */
export async function getCalendarEventAction(eventId: string) {
  if (!eventId.trim() || eventId.length > 200) return null;
  const { agent, timeZone } = await userContext();
  const event = await getCalendarEventForUser({ ownerUserId: agent.userId, eventId });
  if (!event) return null;
  const [linkedCase, connection] = await Promise.all([
    caseView(agent.userId, event.caseId),
    getCalendarConnectionForUser(agent.userId),
  ]);
  const source = connection?.calendars.find((calendar) => calendar.id === event.calendar.id);
  return mapDomainCalendarEventToUi(event, {
    timeZone,
    case: linkedCase,
    canWrite: Boolean(source?.accessRole && WRITABLE_CALENDAR_ROLES.has(source.accessRole)),
  });
}

export async function createCalendarEventAction(input: CalendarEventInput): Promise<CalendarMutationResult> {
  try {
    const { agent, timeZone } = await userContext();
    if (input.timeZone !== timeZone) throw new CalendarDomainError("VALIDATION_ERROR", "O fuso da agenda foi atualizado. Recarregue a página.");
    const conflictGuard = await checkCalendarConflictPolicy({
      ownerUserId: agent.userId, schedule: toSchedule(input), userTimeZone: timeZone,
      allowConflict: input.allowConflict, conflictOverrideToken: input.conflictOverrideToken,
    });
    if (!conflictGuard.ok) return conflictGuard;
    const event = await createCalendarEvent({
      ownerUserId: agent.userId,
      calendarId: input.calendarId,
      caseId: input.caseId,
      title: input.title,
      description: input.description,
      schedule: toSchedule(input),
      location: input.location,
      createGoogleMeet: input.createGoogleMeet ? true : undefined,
      attendees: input.attendeeEmails.map((email) => ({ email })),
      reminders: reminderJson(input.reminderMinutes),
      sendInvites: input.sendInvites,
    });
    revalidateCalendarSurfaces(input.caseId);
    return { ok: true, event: mapDomainCalendarEventToUi(event, { timeZone, case: await caseView(agent.userId, input.caseId), canWrite: true }) };
  } catch (error) { return mutationError(error); }
}

export async function updateCalendarEventAction(input: CalendarEventInput): Promise<CalendarMutationResult> {
  try {
    if (!input.id || !input.baseRevision) throw new CalendarDomainError("VALIDATION_ERROR", "Revisão do compromisso inválida.");
    const { agent, timeZone } = await userContext();
    if (input.timeZone !== timeZone) throw new CalendarDomainError("VALIDATION_ERROR", "O fuso da agenda foi atualizado. Recarregue a página.");
    const conflictGuard = await checkCalendarConflictPolicy({
      ownerUserId: agent.userId, eventId: input.id, schedule: toSchedule(input), userTimeZone: timeZone,
      allowConflict: input.allowConflict, conflictOverrideToken: input.conflictOverrideToken,
    });
    if (!conflictGuard.ok) return conflictGuard;
    const event = await updateCalendarEvent({
      ownerUserId: agent.userId,
      eventId: input.id,
      baseRevision: input.baseRevision,
      calendarId: input.calendarId,
      caseId: input.caseId,
      title: input.title,
      description: input.description,
      schedule: toSchedule(input),
      location: input.location,
      createGoogleMeet: input.createGoogleMeet ? true : undefined,
      attendees: input.attendeeEmails.map((email) => ({ email })),
      reminders: reminderJson(input.reminderMinutes),
      sendInvites: input.sendInvites,
    });
    revalidateCalendarSurfaces(event.caseId);
    return { ok: true, event: mapDomainCalendarEventToUi(event, { timeZone, case: await caseView(agent.userId, input.caseId), canWrite: true }) };
  } catch (error) { return mutationError(error); }
}

export async function cancelCalendarEventAction(input: { id: string; baseRevision: number; sendInvites: boolean }): Promise<CalendarMutationResult> {
  try {
    const { agent } = await userContext();
    const event = await cancelCalendarEvent({ ownerUserId: agent.userId, eventId: input.id, baseRevision: input.baseRevision, sendInvites: input.sendInvites });
    revalidateCalendarSurfaces(event.caseId);
    return { ok: true };
  } catch (error) { return mutationError(error); }
}

export const deleteCalendarEventAction = cancelCalendarEventAction;

export async function moveCalendarEventAction(input: CalendarMoveInput): Promise<CalendarMutationResult> {
  try {
    const { agent, timeZone } = await userContext();
    if (input.timeZone !== timeZone) throw new CalendarDomainError("VALIDATION_ERROR", "O fuso da agenda foi atualizado. Recarregue a página.");
    const moveSchedule = input.allDay
      ? { allDay: true as const, startDate: input.startDate!, endDate: input.endDate ?? addCalendarDays(input.startDate!, 1), timeZone }
      : { allDay: false as const, startsAt: new Date(input.startsAt!), endsAt: new Date(input.endsAt!), timeZone };
    const conflictGuard = await checkCalendarConflictPolicy({
      ownerUserId: agent.userId, eventId: input.id, schedule: moveSchedule, userTimeZone: timeZone,
      allowConflict: input.allowConflict, conflictOverrideToken: input.conflictOverrideToken,
    });
    if (!conflictGuard.ok) return conflictGuard;
    const event = await updateCalendarEvent({
      ownerUserId: agent.userId,
      eventId: input.id,
      baseRevision: input.baseRevision,
      schedule: moveSchedule,
      sendInvites: true,
    });
    revalidateCalendarSurfaces(event.caseId);
    return {
      ok: true,
      event: mapDomainCalendarEventToUi(event, {
        timeZone,
        case: await caseView(agent.userId, event.caseId),
        canWrite: true,
      }),
    };
  } catch (error) { return mutationError(error); }
}

export async function retryCalendarEventSyncAction(input: { id: string }): Promise<CalendarMutationResult> {
  try {
    const { agent } = await userContext();
    await retryCalendarEventSync({ ownerUserId: agent.userId, eventId: input.id });
    revalidateCalendarSurfaces();
    return { ok: true };
  } catch (error) { return mutationError(error); }
}

export async function setCalendarPreferencesAction(input: CalendarPreferencesInput): Promise<CalendarMutationResult> {
  try {
    const { agent } = await userContext();
    await setCalendarPreferences({ ownerUserId: agent.userId, visibleCalendarIds: input.visibleCalendarIds, crmDefaultCalendarId: input.defaultCalendarId });
    revalidatePath("/agent/calendar");
    return { ok: true };
  } catch (error) { return mutationError(error); }
}

export async function associateCalendarCaseAction(input: { eventId: string; caseId: string }): Promise<CalendarMutationResult> {
  try {
    const { agent, timeZone } = await userContext();
    const event = await associateCalendarEventWithCase({ ownerUserId: agent.userId, eventId: input.eventId, caseId: input.caseId });
    revalidateCalendarSurfaces(event.caseId);
    return { ok: true, event: mapDomainCalendarEventToUi(event, { timeZone, case: await caseView(agent.userId, input.caseId), canWrite: true }) };
  } catch (error) { return mutationError(error); }
}

export async function checkCalendarAvailabilityAction(input: {
  startsAtLocal: string; endsAtLocal: string; timeZone: string; excludeEventId?: string;
}): Promise<CalendarAvailabilityResult> {
  try {
    const { agent, timeZone } = await userContext();
    if (input.timeZone !== timeZone) throw new CalendarDomainError("VALIDATION_ERROR", "Fuso horário divergente.");
    const start = parseLocal(input.startsAtLocal, timeZone);
    const end = parseLocal(input.endsAtLocal, timeZone);
    if (end <= start) throw new CalendarDomainError("VALIDATION_ERROR", "Período inválido.");
    const configured = isGoogleCalendarConfigured();
    const conflictsResult = await checkCalendarConflictPolicy({
      ownerUserId: agent.userId, eventId: input.excludeEventId,
      schedule: { allDay: false, startsAt: start, endsAt: end, timeZone }, userTimeZone: timeZone,
    });
    const conflicts = conflictsResult.ok ? [] : conflictsResult.conflicts;
    const duration = end.getTime() - start.getTime();
    const suggestedSlots: Array<{ startsAtLocal: string; endsAtLocal: string; label: string }> = [];
    if (conflicts.length) {
      for (let offset = 30; offset <= 180 && suggestedSlots.length < 3; offset += 30) {
        const next = new Date(start.getTime() + offset * 60_000);
        const nextEnd = new Date(next.getTime() + duration);
        const [occupied, providerBusy] = await Promise.all([
          getCalendarEventsForRange({ ownerUserId: agent.userId, start: next, end: nextEnd }),
          configured
            ? getGoogleFreeBusyForUser(
                { ownerUserId: agent.userId, start: next, end: nextEnd, timeZone },
                getGoogleCalendarEnv(),
              )
            : Promise.resolve({ connected: false, intervals: [] }),
        ]);
        if (
          !occupied.some((event) => event.id !== input.excludeEventId) &&
          providerBusy.intervals.length === 0
        ) {
          const local = wallClock(next, timeZone);
          const localEnd = wallClock(nextEnd, timeZone);
          suggestedSlots.push({ startsAtLocal: local, endsAtLocal: localEnd, label: local.slice(11).replace(":", "h") });
        }
      }
    }
    return { ok: true, conflicts, suggestedSlots };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Não foi possível verificar a disponibilidade." };
  }
}

function wallClock(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
