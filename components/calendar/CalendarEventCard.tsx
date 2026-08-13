"use client";

import Link from "next/link";
import type { CalendarEventView } from "./types";

function eventWhen(event: CalendarEventView) {
  const date = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: event.timeZone,
  });
  const time = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: event.timeZone,
  });
  if (event.allDay) {
    if (!event.startDate) return "Dia inteiro";
    return `${date.format(new Date(`${event.startDate}T12:00:00Z`))} · dia inteiro`;
  }
  if (!event.startsAt) return "Horário a definir";
  const start = new Date(event.startsAt);
  return `${date.format(start)} · ${time.format(start)}`;
}

export function CalendarEventCard({
  event,
  onOpen,
  compact = false,
}: {
  event: CalendarEventView;
  onOpen?: (event: CalendarEventView) => void;
  compact?: boolean;
}) {
  const pending = event.syncStatus === "PENDING" || event.syncStatus === "PROCESSING";
  const completed = event.status !== "CANCELLED" && eventInstantHasEnded(event);
  const openHref = `/agent/calendar?event=${encodeURIComponent(event.id)}`;

  const content = (
    <>
      <span className="calendar-event-card-time">{eventWhen(event)}</span>
      <strong>{event.title}</strong>
      <span className="calendar-event-card-meta">
        {event.case?.name ?? event.calendarName}
        {event.location ? ` · ${event.location}` : ""}
      </span>
    </>
  );

  return (
    <article
      className="calendar-event-card"
      data-compact={compact || undefined}
      data-cancelled={event.status === "CANCELLED" || undefined}
      style={{ "--event-color": event.calendarColor } as React.CSSProperties}
    >
      {onOpen ? (
        <button type="button" className="calendar-event-card-open" onClick={() => onOpen(event)} aria-label={`Abrir compromisso ${event.title}`}>
          {content}
        </button>
      ) : (
        <Link className="calendar-event-card-open" href={openHref} aria-label={`Abrir compromisso ${event.title}`}>
          {content}
        </Link>
      )}

      <div className="calendar-event-card-footer">
        <span className="calendar-source-dot" aria-hidden="true" />
        <span>{event.source === "CRM" ? "Keepr One" : event.calendarName}</span>
        {pending ? <span className="calendar-sync-chip">Sincronizando…</span> : null}
        {event.syncStatus === "ERROR" ? <span className="calendar-sync-chip" data-error>Falha ao sincronizar</span> : null}
        {completed ? <span className="calendar-sync-chip" data-completed>✓ Concluída</span> : null}
        {event.meetingUrl ? (
          <a href={event.meetingUrl} target="_blank" rel="noreferrer" className="calendar-meet-link">
            Entrar no Meet <span aria-hidden="true">↗</span>
          </a>
        ) : null}
        {event.case ? (
          <Link href={`/agent/cases/${event.case.id}`} className="calendar-lead-link">
            Abrir lead <span aria-hidden="true">↗</span>
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function eventInstantHasEnded(event: CalendarEventView, now = new Date()) {
  if (event.allDay) {
    if (!event.endDate) return false;
    return event.endDate <= dateKeyInTimeZone(now, event.timeZone);
  }
  return Boolean(event.endsAt && new Date(event.endsAt) <= now);
}

function dateKeyInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Compact semantic alias used by Hoje and CRM without coupling them to Agenda. */
export function MeetingActionCard({
  event,
  onOpen,
}: {
  event: CalendarEventView;
  onOpen?: (event: CalendarEventView) => void;
}) {
  return <CalendarEventCard event={event} onOpen={onOpen} compact />;
}
