"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarEventModal } from "./CalendarEventModal";
import { MeetingActionCard } from "./CalendarEventCard";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { CalendarConnectionView, CalendarEventView, CalendarSourceView } from "./types";

export function TodayMeetingsSection({
  connection,
  calendars,
  events,
  timeZone,
}: {
  connection: CalendarConnectionView;
  calendars: CalendarSourceView[];
  events: CalendarEventView[];
  timeZone: string;
}) {
  const { copy } = useI18n();
  const [selected, setSelected] = useState<CalendarEventView | null>(null);
  const connected = connection.status === "CONNECTED" || connection.status === "SYNCING";

  return (
    <section
      aria-labelledby="today-meetings-title"
      className="mt-6 overflow-hidden rounded-[28px] border border-border-steel bg-paper/72 p-5 shadow-[var(--shadow-soft)] sm:p-7"
      data-stack-card
    >
      <div className="flex flex-col gap-4 border-b border-border-steel/75 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-deep">{copy("Agenda de hoje", "Today's calendar")}</p>
          <h2 id="today-meetings-title" className="mt-2 max-w-4xl text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">
            {copy("Reuniões antes dos retornos.", "Meetings before follow-ups.")}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
            {copy("Veja primeiro os compromissos com hora marcada; depois avance follow-ups e demais prioridades.", "Start with scheduled events, then move on to follow-ups and other priorities.")}
          </p>
        </div>
        <Link href="/agent/calendar" className="inline-flex min-h-10 w-fit items-center rounded-full border border-border-steel bg-paper px-4 text-xs font-semibold text-ink transition-colors hover:border-teal/35 hover:bg-teal-pale">
          {copy("Abrir agenda", "Open calendar")} <span aria-hidden className="ml-1.5">↗</span>
        </Link>
      </div>

      {!connected ? (
        <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-dashed border-border-steel bg-canvas/55 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-ink">{copy("Sua agenda ainda não está conectada.", "Your calendar is not connected yet.")}</p>
            <p className="mt-1 text-xs leading-5 text-ink-muted">{copy("Conecte o Google Calendar para trazer reuniões e compromissos para o Hoje.", "Connect Google Calendar to bring meetings and events into Today.")}</p>
          </div>
          <Link href="/agent/calendar" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full bg-rail-strong px-4 text-xs font-semibold text-paper">{copy("Conectar agenda", "Connect calendar")}</Link>
        </div>
      ) : events.length ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {events.slice(0, 6).map((event) => (
            <MeetingActionCard key={event.id} event={event} displayTimeZone={timeZone} onOpen={setSelected} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-border-steel bg-canvas/50 px-5 py-5">
          <p className="text-sm font-medium text-ink">{copy("Nenhuma reunião para hoje.", "No meetings today.")}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{copy("Sua agenda está livre. Use esse espaço para avançar os próximos compromissos da operação.", "Your calendar is clear. Use this time to move your next operational priorities forward.")}</p>
        </div>
      )}

      <CalendarEventModal
        key={selected?.id ?? "closed"}
        open={selected !== null}
        mode="details"
        event={selected}
        timeZone={timeZone}
        calendars={calendars}
        onClose={() => setSelected(null)}
        onSubmit={async () => ({ ok: false, message: copy("Abra a Agenda para editar este compromisso.", "Open Calendar to edit this event.") })}
      />
    </section>
  );
}
