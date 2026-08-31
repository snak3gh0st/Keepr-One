"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin, { type EventResizeDoneArg } from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import ptBrLocale from "@fullcalendar/core/locales/pt-br";
import type {
  DateSelectArg,
  DatesSetArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { CalendarEventCard } from "./CalendarEventCard";
import { CalendarEventModal } from "./CalendarEventModal";
import { CalendarQuickCreate, type CalendarQuickDraft, type CalendarQuickSlot } from "./CalendarQuickCreate";
import type {
  CalendarEventInput,
  CalendarEventView,
  CalendarAvailabilityResult,
  CalendarMoveInput,
  CalendarMutationResult,
  CalendarPageData,
  CalendarPreferencesInput,
  CalendarRange,
  CalendarSourceView,
  CalendarViewMode,
} from "./types";

type CalendarWorkspaceProps = {
  initialData: CalendarPageData;
  onCreate: (input: CalendarEventInput) => Promise<CalendarMutationResult>;
  onUpdate: (input: CalendarEventInput) => Promise<CalendarMutationResult>;
  onCancel: (input: { id: string; baseRevision: number; sendInvites: boolean }) => Promise<CalendarMutationResult>;
  onDelete: (input: { id: string; baseRevision: number; sendInvites: boolean }) => Promise<CalendarMutationResult>;
  onMove: (input: CalendarMoveInput) => Promise<CalendarMutationResult>;
  onRetrySync: (input: { id: string }) => Promise<CalendarMutationResult>;
  onRangeChange: (range: CalendarRange) => Promise<CalendarPageData>;
  onResolveEvent: (eventId: string) => Promise<CalendarEventView | null>;
  onPreferencesChange: (input: CalendarPreferencesInput) => Promise<CalendarMutationResult>;
  onAssociateCase: (input: { eventId: string; caseId: string }) => Promise<CalendarMutationResult>;
  onCheckAvailability?: (input: {
    startsAtLocal: string;
    endsAtLocal: string;
    timeZone: string;
    excludeEventId?: string;
  }) => Promise<CalendarAvailabilityResult>;
  onRefresh: (range: CalendarRange) => Promise<CalendarPageData>;
};

type ModalState =
  | { mode: "create"; start: string | null; end: string | null; allDay: boolean; title?: string; caseId?: string | null }
  | { mode: "details" | "edit"; event: CalendarEventView }
  | null;

const VIEW_TO_FULLCALENDAR: Record<Exclude<CalendarViewMode, "list">, string> = {
  month: "dayGridMonth",
  week: "timeGridWeek",
  day: "timeGridDay",
};

const FULLCALENDAR_TO_VIEW: Record<string, CalendarViewMode> = {
  dayGridMonth: "month",
  timeGridWeek: "week",
  timeGridDay: "day",
};

export function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Invalid calendar date");
  return `${year}-${month}-${day}`;
}

export function fullCalendarAllDayDateKey(dateStr: string | undefined, date: Date, timeZone: string) {
  // FullCalendar exposes all-day boundaries as calendar-local YYYY-MM-DD
  // strings. Prefer that lossless value; the Date is only a fallback.
  const calendarDate = /^(\d{4}-\d{2}-\d{2})$/.exec(dateStr ?? "")?.[1];
  return calendarDate ?? dateKeyInTimeZone(date, timeZone);
}

export function shiftDateKey(day: string, offset: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error("Invalid calendar day");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + offset, 12));
  return date.toISOString().slice(0, 10);
}

function displayDateForKey(day: string) {
  return new Date(`${day}T12:00:00.000Z`);
}

export function eventOccursOnLocalDay(event: CalendarEventView, day: string, timeZone: string) {
  if (event.allDay) {
    if (!event.startDate) return false;
    // Google and FullCalendar both model an all-day end as exclusive.
    return event.startDate <= day && (event.endDate ? day < event.endDate : day === event.startDate);
  }
  if (!event.startsAt) return false;
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(event.startsAt)) === day;
}

export function localDayIsWithinRange(range: CalendarRange, day: string, timeZone: string) {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone });
  return formatter.format(start) <= day && day <= formatter.format(new Date(end.getTime() - 1));
}

export function rangeAroundLocalDay(day: string): CalendarRange {
  // A UTC margin keeps the selected local day covered across every IANA
  // offset, including DST transitions, while keeping the mobile query small.
  const noon = new Date(`${day}T12:00:00.000Z`);
  if (!Number.isFinite(noon.getTime())) throw new Error("Invalid calendar day");
  return {
    start: new Date(noon.getTime() - 2 * 86_400_000).toISOString(),
    end: new Date(noon.getTime() + 3 * 86_400_000).toISOString(),
  };
}

function toFullCalendarEvent(event: CalendarEventView): EventInput {
  return {
    id: event.id,
    title: event.title,
    start: event.allDay ? event.startDate ?? undefined : event.startsAt ?? undefined,
    end: event.allDay ? event.endDate ?? undefined : event.endsAt ?? undefined,
    allDay: event.allDay,
    editable: event.canEdit,
    backgroundColor: event.calendarColor,
    borderColor: event.calendarColor,
    textColor: "#07100b",
    extendedProps: { event },
  };
}

function EventContent({ event, timeText }: EventContentArg) {
  const item = event.extendedProps.event as CalendarEventView;
  return (
    <span className="calendar-grid-event">
      <i style={{ background: item.calendarColor }} />
      <span>
        {timeText ? <small>{timeText}</small> : null}
        <strong>{event.title}</strong>
        {item.case ? <em>{item.case.name}</em> : null}
      </span>
    </span>
  );
}

export function fullCalendarOptionsForTimeZone(timeZone: string) {
  return { timeZone } as const;
}

function eventRangeFromApi(arg: EventDropArg | EventResizeDoneArg, timeZone: string) {
  const item = arg.event.extendedProps.event as CalendarEventView;
  return {
    id: arg.event.id,
    startsAt: arg.event.allDay ? null : arg.event.start?.toISOString() ?? null,
    endsAt: arg.event.allDay ? null : arg.event.end?.toISOString() ?? null,
    startDate: arg.event.allDay && arg.event.start
      ? fullCalendarAllDayDateKey(arg.event.startStr, arg.event.start, timeZone)
      : null,
    endDate: arg.event.allDay && arg.event.end
      ? fullCalendarAllDayDateKey(arg.event.endStr, arg.event.end, timeZone)
      : null,
    allDay: arg.event.allDay,
    timeZone,
    baseRevision: item.localRevision,
  };
}

function connectionCopy(data: CalendarPageData) {
  switch (data.connection.status) {
    case "CONNECTED":
      return { title: "Google conectado", detail: data.connection.email ?? "Agenda sincronizada", tone: "connected" };
    case "SYNCING":
      return { title: "Sincronizando", detail: "Buscando as últimas alterações…", tone: "syncing" };
    case "RECONNECT_REQUIRED":
      return { title: "Reconecte o Google", detail: "A autorização expirou.", tone: "warning" };
    case "ERROR":
      return { title: "Sincronização pausada", detail: data.connection.errorMessage ?? "Tente novamente em instantes.", tone: "error" };
    case "NOT_CONFIGURED":
      return { title: "Integração indisponível", detail: "A configuração do Google ainda não foi concluída.", tone: "warning" };
    default:
      return { title: "Google Calendar", detail: "Conecte sua agenda para começar.", tone: "neutral" };
  }
}

export function CalendarWorkspace(props: CalendarWorkspaceProps) {
  const { onResolveEvent } = props;
  const searchParams = useSearchParams();
  const requestedEventId = searchParams.get("event");
  const [data, setData] = useState(props.initialData);
  const [view, setView] = useState<CalendarViewMode>("week");
  const [modal, setModal] = useState<ModalState>(() =>
    searchParams.get("create") === "1"
      ? { mode: "create", start: null, end: null, allDay: false }
      : requestedEventId && props.initialData.events.find((item) => item.id === requestedEventId)
        ? { mode: "details", event: props.initialData.events.find((item) => item.id === requestedEventId)! }
        : null,
  );
  const [mobileDay, setMobileDay] = useState(() =>
    dateKeyInTimeZone(new Date(props.initialData.focusDate), props.initialData.timeZone),
  );
  const [quickCreate, setQuickCreate] = useState<CalendarQuickSlot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [moveConflict, setMoveConflict] = useState<{ input: CalendarMoveInput; message: string } | null>(null);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [loadingRange, startRangeTransition] = useTransition();
  const [savingPreferences, setSavingPreferences] = useState(false);
  const calendarRef = useRef<FullCalendar>(null);
  const dataRef = useRef(data);
  const rangeRequestRef = useRef(0);
  const lastRequestedRangeRef = useRef<string | null>(null);
  const deepLinkRequestRef = useRef(0);
  const openedDeepLinkRef = useRef<string | null>(requestedEventId);
  const preferencesBusyRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();
  const connection = connectionCopy(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const requestId = ++deepLinkRequestRef.current;
    if (!requestedEventId) {
      const previouslyOpened = openedDeepLinkRef.current;
      openedDeepLinkRef.current = null;
      if (previouslyOpened) {
        setModal((current) => current && "event" in current && current.event.id === previouslyOpened ? null : current);
      }
      return;
    }

    const localEvent = dataRef.current.events.find((event) => event.id === requestedEventId);
    if (localEvent) {
      openedDeepLinkRef.current = requestedEventId;
      setModal({ mode: "details", event: localEvent });
      return;
    }

    setModal((current) => current && "event" in current && current.event.id !== requestedEventId ? null : current);
    void onResolveEvent(requestedEventId).then((event) => {
      if (requestId !== deepLinkRequestRef.current) return;
      if (!event) {
        setMessage("Esse compromisso não está mais disponível.");
        return;
      }
      openedDeepLinkRef.current = requestedEventId;
      setData((current) => current.events.some((item) => item.id === event.id)
        ? current
        : { ...current, events: [...current.events, event] });
      setModal({ mode: "details", event });
    }).catch(() => {
      if (requestId === deepLinkRequestRef.current) setMessage("Esse compromisso não está mais disponível.");
    });
  }, [onResolveEvent, requestedEventId]);

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("create");
      router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
    }
  }, [pathname, router, searchParams]);

  useEffect(() => {
    const tablet = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const mobile = window.matchMedia("(max-width: 767px)");
    const adapt = () => {
      if (mobile.matches) setView("list");
      else if (tablet.matches) changeView("day");
      else changeView("week");
    };
    const timeout = window.setTimeout(adapt, 0);
    tablet.addEventListener("change", adapt);
    mobile.addEventListener("change", adapt);
    return () => {
      tablet.removeEventListener("change", adapt);
      mobile.removeEventListener("change", adapt);
      window.clearTimeout(timeout);
    };
  }, []);

  const visibleCalendarIds = useMemo(
    () => new Set(data.calendars.filter((calendar) => calendar.visible).map((calendar) => calendar.id)),
    [data.calendars],
  );
  const visibleEvents = useMemo(
    () => data.events.filter((event) => visibleCalendarIds.has(event.calendarId) && event.status !== "CANCELLED"),
    [data.events, visibleCalendarIds],
  );
  const mobileEvents = useMemo(
    () => visibleEvents.filter((event) => eventOccursOnLocalDay(event, mobileDay, data.timeZone)).sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return (a.startsAt ?? a.startDate ?? "").localeCompare(b.startsAt ?? b.startDate ?? "");
    }),
    [data.timeZone, mobileDay, visibleEvents],
  );

  function changeView(next: CalendarViewMode) {
    setQuickCreate(null);
    setView(next);
    if (next !== "list") calendarRef.current?.getApi().changeView(VIEW_TO_FULLCALENDAR[next]);
  }

  function loadRange(info: DatesSetArg) {
    setQuickCreate(null);
    const nextView = FULLCALENDAR_TO_VIEW[info.view.type];
    if (nextView) setView(nextView);
    setCalendarTitle(info.view.title);
    setMobileDay(dateKeyInTimeZone(info.view.calendar.getDate(), dataRef.current.timeZone));
    const next = { start: info.start.toISOString(), end: info.end.toISOString() };
    void requestRange(next);
  }

  function requestRange(next: CalendarRange) {
    const key = `${next.start}|${next.end}`;
    const current = dataRef.current.range;
    if (next.start === current.start && next.end === current.end) {
      // Returning to the rendered range invalidates an older request that is
      // still in flight, otherwise its late response could replace this view.
      if (lastRequestedRangeRef.current) {
        rangeRequestRef.current += 1;
        lastRequestedRangeRef.current = null;
      }
      return;
    }
    if (lastRequestedRangeRef.current === key) return;
    lastRequestedRangeRef.current = key;
    const requestId = ++rangeRequestRef.current;
    startRangeTransition(async () => {
      try {
        const result = await props.onRangeChange(next);
        if (requestId !== rangeRequestRef.current) return;
        dataRef.current = result;
        setData(result);
      } catch {
        if (requestId === rangeRequestRef.current) setMessage("Não foi possível carregar esse período.");
      } finally {
        if (requestId === rangeRequestRef.current) lastRequestedRangeRef.current = null;
      }
    });
  }

  function selectMobileDay(day: string) {
    setMobileDay(day);
    if (!localDayIsWithinRange(dataRef.current.range, day, dataRef.current.timeZone)) {
      requestRange(rangeAroundLocalDay(day));
    }
  }

  async function mutate(
    action: (input: CalendarEventInput) => Promise<CalendarMutationResult>,
    input: CalendarEventInput,
  ) {
    const result = await action(input);
    if (result.ok) {
      if (result.event) {
        setData((current) => ({
          ...current,
          events: [...current.events.filter((event) => event.id !== result.event?.id), result.event!],
        }));
      } else router.refresh();
    }
    return result;
  }

  async function cancelOrDelete(event: CalendarEventView, operation: "cancel" | "delete") {
    const result = await (operation === "cancel" ? props.onCancel : props.onDelete)({
      id: event.id,
      baseRevision: event.localRevision,
      sendInvites: true,
    });
    if (result.ok) {
      setData((current) => ({ ...current, events: current.events.filter((item) => item.id !== event.id) }));
    }
    return result;
  }

  async function associateCase(event: CalendarEventView, caseId: string) {
    const result = await props.onAssociateCase({ eventId: event.id, caseId });
    if (result.ok) {
      const linkedCase = data.cases.find((item) => item.id === caseId) ?? null;
      setData((current) => ({
        ...current,
        events: current.events.map((item) => item.id === event.id
          ? { ...(result.event ?? item), case: result.event?.case ?? linkedCase }
          : item),
      }));
    }
    return result;
  }

  async function moveEvent(arg: EventDropArg | EventResizeDoneArg) {
    const input = eventRangeFromApi(arg, data.timeZone);
    const result = await props.onMove(input);
    if (!result.ok) {
      arg.revert();
      if (result.code === "SCHEDULE_CONFLICT" && result.conflictOverrideToken) {
        setMoveConflict({ input: { ...input, conflictOverrideToken: result.conflictOverrideToken }, message: result.message });
      } else setMessage(result.message);
      return;
    }
    if (result.event) {
      setData((current) => ({ ...current, events: current.events.map((event) => event.id === result.event?.id ? result.event! : event) }));
    }
  }

  async function confirmMoveConflict() {
    if (!moveConflict) return;
    const result = await props.onMove({ ...moveConflict.input, allowConflict: true });
    setMoveConflict(null);
    if (!result.ok) setMessage(result.message);
    else setData(await props.onRefresh(data.range));
  }

  async function retrySync(event: CalendarEventView) {
    const result = await props.onRetrySync({ id: event.id });
    if (result.ok) {
      setData((current) => ({ ...current, events: current.events.map((item) => item.id === event.id ? { ...item, syncStatus: "PENDING" } : item) }));
    }
    return result;
  }

  async function toggleCalendar(calendar: CalendarSourceView) {
    if (preferencesBusyRef.current) return;
    preferencesBusyRef.current = true;
    setSavingPreferences(true);
    const previous = dataRef.current.calendars;
    const visible = !calendar.visible;
    const nextCalendars = previous.map((item) => item.id === calendar.id ? { ...item, visible } : item);
    const defaultCalendar = nextCalendars.find((item) => item.isDefault && item.visible) ?? nextCalendars.find((item) => item.canWrite && item.visible);
    if (!defaultCalendar) {
      setMessage("Mantenha ao menos um calendário gravável visível.");
      preferencesBusyRef.current = false;
      setSavingPreferences(false);
      return;
    }
    dataRef.current = { ...dataRef.current, calendars: nextCalendars };
    setData((current) => ({ ...current, calendars: nextCalendars }));
    try {
      const result = await props.onPreferencesChange({
        visibleCalendarIds: nextCalendars.filter((item) => item.visible).map((item) => item.id),
        defaultCalendarId: defaultCalendar.id,
      });
      if (!result.ok) {
        dataRef.current = { ...dataRef.current, calendars: previous };
        setData((current) => ({ ...current, calendars: previous }));
        setMessage(result.message);
      }
    } catch {
      dataRef.current = { ...dataRef.current, calendars: previous };
      setData((current) => ({ ...current, calendars: previous }));
      setMessage("Não foi possível salvar a visibilidade dos calendários.");
    } finally {
      preferencesBusyRef.current = false;
      setSavingPreferences(false);
    }
  }

  async function setDefaultCalendar(calendar: CalendarSourceView) {
    if (preferencesBusyRef.current) return;
    preferencesBusyRef.current = true;
    setSavingPreferences(true);
    const previous = dataRef.current.calendars;
    const nextCalendars = previous.map((item) => ({
      ...item,
      visible: item.visible || item.id === calendar.id,
      isDefault: item.id === calendar.id,
    }));
    dataRef.current = { ...dataRef.current, calendars: nextCalendars };
    setData((current) => ({ ...current, calendars: nextCalendars }));
    try {
      const result = await props.onPreferencesChange({
        visibleCalendarIds: nextCalendars.filter((item) => item.visible).map((item) => item.id),
        defaultCalendarId: calendar.id,
      });
      if (!result.ok) {
        dataRef.current = { ...dataRef.current, calendars: previous };
        setData((current) => ({ ...current, calendars: previous }));
        setMessage(result.message);
      }
    } catch {
      dataRef.current = { ...dataRef.current, calendars: previous };
      setData((current) => ({ ...current, calendars: previous }));
      setMessage("Não foi possível definir o calendário padrão.");
    } finally {
      preferencesBusyRef.current = false;
      setSavingPreferences(false);
    }
  }

  function openQuickCreate(slot: CalendarQuickSlot) {
    setModal(null);
    setQuickCreate(slot);
  }

  function expandQuickCreate(draft: CalendarQuickDraft) {
    if (!quickCreate) return;
    setModal({
      mode: "create",
      start: quickCreate.start,
      end: quickCreate.end,
      allDay: quickCreate.allDay,
      title: draft.title,
      caseId: draft.caseId,
    });
    setQuickCreate(null);
  }

  function closeModal() {
    setModal(null);
    if (!requestedEventId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("event");
    router.replace(params.size ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  return (
    <div className="calendar-workspace">
      <PageHeader
        title="Agenda"
        eyebrow="Compromissos em curso"
        description={(
          <div className="calendar-header-copy">
            <p>Organize reuniões, compromissos e follow-ups no mesmo fluxo do CRM.</p>
            <div className="calendar-command-status" data-tone={connection.tone}>
              <i />
              <strong>{connection.title}</strong>
              <span>{connection.detail}</span>
            </div>
          </div>
        )}
      >
        <div className="calendar-header-actions">
          <Link href="/agent/integrations/google-calendar/scheduling">
            Link de agendamento <span aria-hidden="true">→</span>
          </Link>
          {data.connection.status === "CONNECTED" || data.connection.status === "SYNCING" ? (
            <button type="button" onClick={async () => { try { setData(await props.onRefresh(data.range)); } catch { setMessage("Não foi possível recarregar a agenda."); } }}>
              {data.connection.status === "SYNCING" ? "Atualizar status" : "Recarregar"} <span aria-hidden="true">↻</span>
            </button>
          ) : data.connection.status === "RECONNECT_REQUIRED" ? (
            <Link href="/api/agent/integrations/google-calendar/authorize?returnTo=/agent/calendar">Reconectar Google <span aria-hidden="true">↗</span></Link>
          ) : data.connection.status === "ERROR" ? (
            <Link href="/agent/integrations/google-calendar">Revisar sincronização <span aria-hidden="true">→</span></Link>
          ) : data.connection.status === "NOT_CONFIGURED" ? (
            <Link href="/agent/integrations/google-calendar">Ver configuração <span aria-hidden="true">→</span></Link>
          ) : (
            <Link href="/agent/integrations/google-calendar">Conectar Google <span aria-hidden="true">↗</span></Link>
          )}
          <button type="button" className="calendar-create-button" onClick={() => setModal({ mode: "create", start: null, end: null, allDay: false })}>
            <span aria-hidden="true">+</span> Novo compromisso
          </button>
        </div>
      </PageHeader>

      {message ? <div className="calendar-inline-alert" role="alert"><span>{message}</span><button type="button" onClick={() => setMessage(null)} aria-label="Fechar aviso">×</button></div> : null}
      {moveConflict ? <div className="calendar-move-conflict" role="alert"><div><strong>{moveConflict.message}</strong><span>O compromisso voltou ao horário anterior.</span></div><div><button type="button" onClick={() => setMoveConflict(null)}>Manter horário atual</button><button type="button" onClick={() => void confirmMoveConflict()}>Mover mesmo assim</button></div></div> : null}

      <div className="calendar-toolbar" aria-label="Controles da agenda">
        <div className="calendar-date-controls">
          <button type="button" onClick={() => calendarRef.current?.getApi().prev()} aria-label="Período anterior">←</button>
          <button type="button" onClick={() => calendarRef.current?.getApi().today()}>Hoje</button>
          <button type="button" onClick={() => calendarRef.current?.getApi().next()} aria-label="Próximo período">→</button>
        </div>
        <strong className="calendar-period-title" aria-live="polite">{calendarTitle}</strong>
        <div className="calendar-view-switch" role="group" aria-label="Visualização">
          {(["month", "week", "day", "list"] as CalendarViewMode[]).map((mode) => (
            <button key={mode} type="button" data-active={view === mode || undefined} aria-pressed={view === mode} onClick={() => changeView(mode)}>
              {{ month: "Mês", week: "Semana", day: "Dia", list: "Lista" }[mode]}
            </button>
          ))}
        </div>
        {loadingRange ? <span className="calendar-loading-label">Atualizando período…</span> : null}
      </div>

      <div className="calendar-layout">
        <aside className="calendar-sidebar">
          <section>
            <div className="calendar-sidebar-heading"><div><span>Calendários</span><strong>Visibilidade</strong></div><Link href="/agent/integrations/google-calendar">Configurar</Link></div>
            {data.calendars.length ? (
              <ul className="calendar-source-list">
                {data.calendars.map((calendar) => (
                  <li key={calendar.id}>
                    <label>
                      <input type="checkbox" checked={calendar.visible} disabled={savingPreferences} onChange={() => void toggleCalendar(calendar)} />
                      <i style={{ background: calendar.color }} />
                      <span>{calendar.name}</span>
                    </label>
                    {calendar.canWrite ? <button type="button" disabled={savingPreferences} data-default={calendar.isDefault || undefined} onClick={() => void setDefaultCalendar(calendar)} aria-label={`${calendar.name}${calendar.isDefault ? " é o calendário padrão" : ": definir como padrão"}`}>{calendar.isDefault ? "Padrão" : "Definir"}</button> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="calendar-source-empty"><p>Nenhum calendário disponível.</p><Link href="/agent/integrations/google-calendar">Conectar Google</Link></div>
            )}
          </section>
          <section className="calendar-sidebar-guide">
            <span>Atalhos</span>
            <p>Selecione um horário para criar. Arraste um compromisso para reagendar.</p>
            <small>Alterações no Google são salvas em segundo plano — sua agenda não para por uma falha externa.</small>
          </section>
        </aside>

        <main className="calendar-main-surface">
          <div
            className={`calendar-grid-host ${view === "list" ? "calendar-grid-hidden" : ""}`}
            aria-hidden={view === "list" || undefined}
            inert={view === "list" ? true : undefined}
          >
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
              locale={ptBrLocale}
              {...fullCalendarOptionsForTimeZone(data.timeZone)}
              initialView="timeGridWeek"
              initialDate={data.focusDate}
              headerToolbar={false}
              height="auto"
              firstDay={1}
              nowIndicator
              selectable
              selectMirror
              editable
              eventStartEditable
              eventDurationEditable
              allDayMaintainDuration
              slotMinTime="06:00:00"
              slotMaxTime="22:00:00"
              slotDuration="00:30:00"
              snapDuration="00:15:00"
              scrollTime="08:00:00"
              dayMaxEvents={4}
              events={visibleEvents.map(toFullCalendarEvent)}
              eventContent={(arg) => <EventContent {...arg} />}
              select={(arg: DateSelectArg) => openQuickCreate({
                start: arg.allDay
                  ? fullCalendarAllDayDateKey(arg.startStr, arg.start, data.timeZone)
                  : arg.start.toISOString(),
                end: arg.allDay
                  ? fullCalendarAllDayDateKey(arg.endStr, arg.end, data.timeZone)
                  : arg.end.toISOString(),
                allDay: arg.allDay,
                anchor: arg.jsEvent ? { x: arg.jsEvent.clientX, y: arg.jsEvent.clientY } : null,
              })}
              eventClick={(arg: EventClickArg) => { setQuickCreate(null); setModal({ mode: "details", event: arg.event.extendedProps.event as CalendarEventView }); }}
              eventDrop={(arg: EventDropArg) => void moveEvent(arg)}
              eventResize={(arg: EventResizeDoneArg) => void moveEvent(arg)}
              datesSet={loadRange}
            />
          </div>

          <div className={`calendar-list-view ${view === "list" ? "calendar-list-visible" : ""}`}>
            {visibleEvents.length ? [...visibleEvents].sort((a, b) => (a.startsAt ?? a.startDate ?? "").localeCompare(b.startsAt ?? b.startDate ?? "")).map((event) => <CalendarEventCard key={event.id} event={event} onOpen={(item) => setModal({ mode: "details", event: item })} />) : <CalendarEmptyState onCreate={() => setModal({ mode: "create", start: null, end: null, allDay: false })} />}
          </div>

          <div className="calendar-mobile-view">
            <MobileDateRail active={mobileDay} onSelect={selectMobileDay} />
            <div className="calendar-mobile-day-copy"><span>{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(displayDateForKey(mobileDay))}</span><strong>{mobileEvents.length} {mobileEvents.length === 1 ? "compromisso" : "compromissos"}</strong></div>
            {mobileEvents.length ? <div className="calendar-mobile-list">{mobileEvents.map((event) => <CalendarEventCard key={event.id} event={event} onOpen={(item) => setModal({ mode: "details", event: item })} />)}</div> : <CalendarEmptyState onCreate={() => openQuickCreate({ start: `${mobileDay}T09:00:00`, end: `${mobileDay}T09:30:00`, allDay: false, anchor: null })} />}
          </div>
        </main>
      </div>

      <button type="button" className="calendar-mobile-create" onClick={() => openQuickCreate({ start: `${mobileDay}T09:00:00`, end: `${mobileDay}T09:30:00`, allDay: false, anchor: null })}><span aria-hidden="true">+</span><span>Agendar</span></button>

      {quickCreate ? (
        <CalendarQuickCreate
          slot={quickCreate}
          timeZone={data.timeZone}
          calendars={data.calendars}
          cases={data.cases}
          onCreate={(input) => mutate(props.onCreate, input)}
          onClose={() => { setQuickCreate(null); calendarRef.current?.getApi().unselect(); }}
          onMoreOptions={expandQuickCreate}
        />
      ) : null}

      <CalendarEventModal
        open={Boolean(modal)}
        onClose={closeModal}
        mode={modal?.mode ?? "create"}
        event={modal && "event" in modal ? modal.event : null}
        initialStart={modal?.mode === "create" ? modal.start : null}
        initialEnd={modal?.mode === "create" ? modal.end : null}
        initialAllDay={modal?.mode === "create" ? modal.allDay : false}
        initialTitle={modal?.mode === "create" ? modal.title : null}
        initialCase={modal?.mode === "create" && modal.caseId ? data.cases.find((item) => item.id === modal.caseId) ?? null : null}
        timeZone={data.timeZone}
        calendars={data.calendars}
        cases={data.cases}
        onSubmit={(input) => mutate(input.id ? props.onUpdate : props.onCreate, input)}
        onRequestEdit={(event) => setModal({ mode: "edit", event })}
        onCancelEvent={(event) => cancelOrDelete(event, "cancel")}
        onDelete={(event) => cancelOrDelete(event, "delete")}
        onAssociateCase={associateCase}
        onRetrySync={retrySync}
        onCheckAvailability={props.onCheckAvailability}
      />
    </div>
  );
}

function CalendarEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="calendar-empty-state">
      <span aria-hidden="true"><i /><i /><i /></span>
      <strong>Esse espaço está livre.</strong>
      <p>Reserve o próximo contato ou conecte o Google Calendar para reunir seus compromissos.</p>
      <button type="button" onClick={onCreate}>Criar compromisso</button>
    </div>
  );
}

function MobileDateRail({ active, onSelect }: { active: string; onSelect: (value: string) => void }) {
  const days = Array.from({ length: 9 }, (_, index) => shiftDateKey(active, index - 2));
  return (
    <div className="calendar-mobile-date-rail" role="list" aria-label="Escolher dia">
      {days.map((key) => {
        const date = displayDateForKey(key);
        return <button type="button" key={key} data-active={key === active || undefined} aria-pressed={key === active} onClick={() => onSelect(key)}><span>{new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(date).replace(".", "")}</span><strong>{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "UTC" }).format(date)}</strong></button>;
      })}
    </div>
  );
}
