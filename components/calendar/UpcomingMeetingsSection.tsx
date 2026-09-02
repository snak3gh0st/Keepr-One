"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarEventModal } from "./CalendarEventModal";
import { MeetingActionCard } from "./CalendarEventCard";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { CalendarEventView, CalendarSourceView } from "./types";

export function UpcomingMeetingsSection({
  calendars,
  events,
  timeZone,
}: {
  calendars: CalendarSourceView[];
  events: CalendarEventView[];
  timeZone: string;
}) {
  const { copy } = useI18n();
  const [selected, setSelected] = useState<CalendarEventView | null>(null);

  if (!events.length) return null;

  return (
    <section
      aria-labelledby="upcoming-meetings-title"
      className="mt-4 overflow-hidden rounded-[24px] border border-border-steel bg-paper/64 p-5 shadow-[var(--shadow-soft)] sm:p-6"
      data-stack-card
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-deep">{copy("Próximos compromissos", "Upcoming events")}</p>
          <h2 id="upcoming-meetings-title" className="mt-1.5 text-xl font-medium tracking-[-0.035em] text-ink sm:text-2xl">
            {copy("O que já está marcado para os próximos dias.", "What is already scheduled for the next few days.")}
          </h2>
        </div>
        <Link href="/agent/calendar" className="inline-flex min-h-9 w-fit items-center rounded-full border border-border-steel bg-paper px-3.5 text-xs font-semibold text-ink transition-colors hover:border-teal/35 hover:bg-teal-pale">
          {copy("Ver na agenda", "View in calendar")} <span aria-hidden className="ml-1.5">↗</span>
        </Link>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => (
          <MeetingActionCard key={event.id} event={event} onOpen={setSelected} />
        ))}
      </div>

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
