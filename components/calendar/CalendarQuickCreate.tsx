"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import type {
  CalendarCaseOption,
  CalendarEventInput,
  CalendarMutationResult,
  CalendarSourceView,
} from "./types";

export type CalendarQuickSlot = {
  start: string;
  end: string;
  allDay: boolean;
  anchor?: { x: number; y: number } | null;
};

export type CalendarQuickDraft = {
  title: string;
  caseId: string | null;
};

function wallClockValue(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value.slice(0, 16);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function localDate(value: string, timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function buildQuickCreateInput(input: {
  slot: CalendarQuickSlot;
  title: string;
  caseId: string | null;
  timeZone: string;
  calendars: CalendarSourceView[];
}): CalendarEventInput {
  const calendar = input.calendars.find((item) => item.isDefault && item.canWrite)
    ?? input.calendars.find((item) => item.canWrite);
  return {
    title: input.title.trim(),
    description: null,
    allDay: input.slot.allDay,
    startsAtLocal: input.slot.allDay ? null : wallClockValue(input.slot.start, input.timeZone),
    endsAtLocal: input.slot.allDay ? null : wallClockValue(input.slot.end, input.timeZone),
    startDate: input.slot.allDay ? localDate(input.slot.start, input.timeZone) : null,
    endDate: input.slot.allDay ? localDate(input.slot.end, input.timeZone) : null,
    timeZone: input.timeZone,
    location: null,
    calendarId: calendar?.id ?? "",
    caseId: input.caseId,
    attendeeEmails: [],
    createGoogleMeet: false,
    sendInvites: false,
    reminderMinutes: 15,
  };
}

function slotLabel(slot: CalendarQuickSlot, timeZone: string) {
  const wallClock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(slot.start);
  const wallEnd = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(slot.end);
  if (wallClock && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(slot.start)) {
    const displayDay = new Date(Date.UTC(Number(wallClock[1]), Number(wallClock[2]) - 1, Number(wallClock[3]), 12));
    const day = new Intl.DateTimeFormat("pt-BR", { weekday: slot.allDay ? "long" : "short", day: "numeric", month: "long", timeZone: "UTC" }).format(displayDay);
    if (slot.allDay) return day;
    return `${day} · ${wallClock[4]}:${wallClock[5]}–${wallEnd?.[4] ?? wallClock[4]}:${wallEnd?.[5] ?? wallClock[5]}`;
  }
  const start = new Date(slot.start);
  if (slot.allDay) {
    return new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(start);
  }
  const day = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone }).format(start);
  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone });
  return `${day} · ${time.format(start)}–${time.format(new Date(slot.end))}`;
}

export function CalendarQuickCreate({
  slot,
  timeZone,
  calendars,
  cases,
  onCreate,
  onClose,
  onMoreOptions,
}: {
  slot: CalendarQuickSlot;
  timeZone: string;
  calendars: CalendarSourceView[];
  cases: CalendarCaseOption[];
  onCreate: (input: CalendarEventInput) => Promise<CalendarMutationResult>;
  onClose: () => void;
  onMoreOptions: (draft: CalendarQuickDraft) => void;
}) {
  const [title, setTitle] = useState("");
  const [caseId, setCaseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const surfaceRef = useRef<HTMLFormElement>(null);
  const writable = useMemo(() => calendars.some((calendar) => calendar.canWrite), [calendars]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointerDown(event: PointerEvent) {
      if (surfaceRef.current && !surfaceRef.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  function submit() {
    if (!title.trim()) {
      setError("Dê um título ao compromisso.");
      return;
    }
    if (!writable) {
      setError("Conecte um calendário gravável antes de criar.");
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await onCreate(buildQuickCreateInput({
        slot,
        title,
        caseId: caseId || null,
        timeZone,
        calendars,
      }));
      if (result.ok) onClose();
      else setError(result.message);
    });
  }

  const position = slot.anchor
    ? ({ "--quick-x": `${slot.anchor.x}px`, "--quick-y": `${slot.anchor.y}px` } as CSSProperties)
    : undefined;

  return (
    <form
      ref={surfaceRef}
      className="calendar-quick-create"
      data-mobile={!slot.anchor || undefined}
      style={position}
      role="dialog"
      aria-modal="false"
      aria-labelledby="calendar-quick-create-title"
      onSubmit={(event) => { event.preventDefault(); submit(); }}
    >
      <header>
        <div>
          <span>Criação rápida</span>
          <strong id="calendar-quick-create-title">Novo compromisso</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar criação rápida">×</button>
      </header>
      <p className="calendar-quick-when"><i aria-hidden="true" />{slotLabel(slot, timeZone)}</p>
      <label>
        <span>Título</span>
        <input autoFocus value={title} maxLength={180} onChange={(event) => { setTitle(event.target.value); setError(null); }} placeholder="Ex.: Revisar proposta" />
      </label>
      <label>
        <span>Lead ou cliente</span>
        <select value={caseId} onChange={(event) => setCaseId(event.target.value)}>
          <option value="">Sem vínculo ao CRM</option>
          {cases.map((item) => <option key={item.id} value={item.id}>{item.name}{item.stage ? ` · ${item.stage}` : ""}</option>)}
        </select>
      </label>
      {error ? <p className="calendar-quick-error" role="alert">{error}</p> : null}
      <footer>
        <button type="button" onClick={() => onMoreOptions({ title: title.trim(), caseId: caseId || null })}>Mais opções</button>
        <button type="submit" className="calendar-quick-submit" disabled={pending || !writable}>{pending ? "Criando…" : "Criar"}<span aria-hidden="true">→</span></button>
      </footer>
    </form>
  );
}
