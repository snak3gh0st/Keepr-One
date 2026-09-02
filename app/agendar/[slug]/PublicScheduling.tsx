"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  downloadIcsCalendar,
} from "@/lib/scheduling/calendar-export";
import { localeFor, type UserLanguage } from "@/lib/i18n/config";
import { localize, type MessageValues } from "@/lib/i18n/catalog";

gsap.registerPlugin(useGSAP);

type PublicSchedulingPage = {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  ownerName: string;
  ownerLanguage: UserLanguage;
  ownerTimeZone: string;
};

type PublicSlot = {
  startsAt: string;
  endsAt: string;
};

type SlotsResponse = {
  page: PublicSchedulingPage;
  slots: PublicSlot[];
};

type BookingResponse = {
  booking: {
    id: string;
    status: "CONFIRMED";
    title: string;
    ownerName: string;
    startsAt: string;
    endsAt: string;
    inviteeTimeZone: string;
  };
  idempotent: boolean;
};

const COMMON_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "UTC",
];

const DAYS_PER_WEEK = 7;
const TIME_ZONE_NAMES: Record<string, Record<UserLanguage, string>> = {
  "America/New_York": { PT: "Nova York", EN: "New York" },
  "America/Chicago": { PT: "Chicago", EN: "Chicago" },
  "America/Denver": { PT: "Denver", EN: "Denver" },
  "America/Los_Angeles": { PT: "Los Angeles", EN: "Los Angeles" },
  "America/Sao_Paulo": { PT: "São Paulo", EN: "São Paulo" },
  "Europe/London": { PT: "Londres", EN: "London" },
  UTC: { PT: "UTC", EN: "UTC" },
};

function visitorTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function idempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `booking_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function dateKeyInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDateKeyDays(key: string, amount: number) {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key: string) {
  return new Date(`${key}T12:00:00.000Z`);
}

export function slotsByLocalDate(slots: PublicSlot[], timeZone: string) {
  const grouped = new Map<string, PublicSlot[]>();
  for (const slot of slots) {
    const key = dateKeyInTimeZone(new Date(slot.startsAt), timeZone);
    grouped.set(key, [...(grouped.get(key) ?? []), slot]);
  }
  for (const daySlots of grouped.values()) {
    daySlots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return grouped;
}

function formatTime(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatFullDate(value: string, timeZone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function shortDateParts(key: string, locale: string) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(dateFromKey(key));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value.replace(".", "") ?? "";
  return { weekday: read("weekday"), day: read("day"), month: read("month") };
}

function formatDateKey(key: string, options: Intl.DateTimeFormatOptions, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(dateFromKey(key));
}

function formatDateKeyFull(key: string, locale: string) {
  return formatDateKey(key, { weekday: "long", day: "2-digit", month: "long" }, locale);
}

function formatWeekRange(keys: string[], locale: string) {
  const first = keys.at(0);
  const last = keys.at(-1);
  if (!first || !last) return "";
  const start = formatDateKey(first, { day: "2-digit", month: "short" }, locale).replace(".", "");
  const end = formatDateKey(last, { day: "2-digit", month: "short" }, locale).replace(".", "");
  return `${start} – ${end}`;
}

function timeZoneLabel(timeZone: string, language: UserLanguage, locale: string, at = new Date()) {
  const name = TIME_ZONE_NAMES[timeZone]?.[language] ?? timeZone.replaceAll("_", " ");
  if (timeZone === "UTC") return name;
  try {
    const offset = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value;
    return offset ? `${name} (${offset})` : name;
  } catch {
    return name;
  }
}

async function apiError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export function PublicScheduling({
  slug,
  initialLanguage = "PT",
}: {
  slug: string;
  initialLanguage?: UserLanguage;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [timeZone, setTimeZone] = useState(visitorTimeZone);
  const [page, setPage] = useState<PublicSchedulingPage | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<BookingResponse["booking"] | null>(null);
  const [requestKey, setRequestKey] = useState(() => idempotencyKey());
  const [refreshKey, setRefreshKey] = useState(0);
  const dateRailRef = useRef<HTMLDivElement>(null);
  const slotButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingSlotFocusRef = useRef<string | null>(null);
  const hasRenderedTimes = useRef(false);
  const language = page?.ownerLanguage ?? initialLanguage;
  const locale = localeFor(language);
  const copy = useCallback(
    (portuguese: string, english: string, values: MessageValues = {}) =>
      localize(language, portuguese, english, values),
    [language],
  );

  const today = useMemo(() => dateKeyInTimeZone(new Date(), timeZone), [timeZone]);
  const dateKeys = useMemo(() => Array.from({ length: 14 }, (_, index) => addDateKeyDays(today, index)), [today]);
  const groupedSlots = useMemo(() => slotsByLocalDate(slots, timeZone), [slots, timeZone]);
  const timeZoneOptions = useMemo(() => Array.from(new Set([timeZone, ...COMMON_TIME_ZONES])), [timeZone]);
  const visibleDateKeys = useMemo(
    () => dateKeys.slice(weekOffset, weekOffset + DAYS_PER_WEEK),
    [dateKeys, weekOffset],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSelectedSlot(null);
      try {
        const query = new URLSearchParams({ from: today, days: "14", timeZone });
        const response = await fetch(`/api/public/scheduling/${encodeURIComponent(slug)}/slots?${query}`, {
          headers: { Accept: "application/json", "X-Keepr-One-Language": language },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await apiError(response, copy("Esta agenda não está disponível agora.", "This calendar is unavailable right now.")));
        const data = (await response.json()) as SlotsResponse;
        setPage(data.page);
        setSlots(data.slots);
        const grouped = slotsByLocalDate(data.slots, timeZone);
        const nextDate = dateKeys.find((key) => (grouped.get(key)?.length ?? 0) > 0) ?? today;
        const nextIndex = Math.max(0, dateKeys.indexOf(nextDate));
        setSelectedDate(nextDate);
        setWeekOffset(Math.floor(nextIndex / DAYS_PER_WEEK) * DAYS_PER_WEEK);
      } catch (error) {
        if (!controller.signal.aborted) {
          setPage(null);
          setSlots([]);
          setLoadError(error instanceof Error ? error.message : copy("Esta agenda não está disponível agora.", "This calendar is unavailable right now."));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [copy, dateKeys, language, refreshKey, slug, timeZone, today]);

  useEffect(() => {
    const activeDate = dateRailRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    activeDate?.scrollIntoView?.({ behavior: "auto", block: "nearest", inline: "nearest" });
  }, [selectedDate, weekOffset]);

  useEffect(() => {
    if (confirmation) document.getElementById("booking-confirmation-title")?.focus();
  }, [confirmation]);

  useEffect(() => {
    if (bookingError && !selectedSlot && !loading) {
      document.getElementById("public-scheduling-booking-error")?.focus();
    }
  }, [bookingError, loading, selectedSlot]);

  useEffect(() => {
    const pendingStart = pendingSlotFocusRef.current;
    if (selectedSlot || !pendingStart) return;
    const restoreFocus = () => {
      const slotButton = slotButtonRefs.current.get(pendingStart);
      if (!slotButton) return;
      slotButton.focus();
      pendingSlotFocusRef.current = null;
    };
    const frame = window.requestAnimationFrame(restoreFocus);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedSlot]);

  useGSAP(
    () => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const content = rootRef.current?.querySelector("[data-booking-step-content]");
      if (!content) return;
      gsap.fromTo(
        content,
        { autoAlpha: 0.72, x: selectedSlot ? 10 : -8 },
        { autoAlpha: 1, x: 0, duration: 0.24, ease: "power4.out", clearProps: "opacity,transform,visibility" },
      );
    },
    { scope: rootRef, dependencies: [selectedSlot?.startsAt], revertOnUpdate: true },
  );

  useGSAP(
    () => {
      if (!selectedDate) return;
      if (!hasRenderedTimes.current) {
        hasRenderedTimes.current = true;
        return;
      }
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const buttons = rootRef.current?.querySelectorAll("[data-booking-time-option]");
      if (!buttons?.length) return;
      gsap.fromTo(
        buttons,
        { autoAlpha: 0.55, y: 6 },
        { autoAlpha: 1, y: 0, duration: 0.22, stagger: 0.02, ease: "power4.out", clearProps: "opacity,transform,visibility" },
      );
    },
    { scope: rootRef, dependencies: [selectedDate, weekOffset], revertOnUpdate: true },
  );

  useGSAP(
    () => {
      if (!confirmation || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const confirmationPanel = rootRef.current;
      const confirmationMark = confirmationPanel?.querySelector("[data-booking-confirmation-mark]");
      if (!confirmationPanel || !confirmationMark) return;
      gsap.fromTo(
        confirmationPanel,
        { autoAlpha: 0.7, y: 8 },
        { autoAlpha: 1, y: 0, duration: 0.28, ease: "power4.out", clearProps: "opacity,transform,visibility" },
      );
      gsap.fromTo(
        confirmationMark,
        { scale: 0.94 },
        { scale: 1, duration: 0.28, ease: "power4.out", clearProps: "transform" },
      );
    },
    { scope: rootRef, dependencies: [confirmation?.id], revertOnUpdate: true },
  );

  function selectDate(key: string) {
    setSelectedDate(key);
    setSelectedSlot(null);
    setBookingError(null);
  }

  function showWeek(nextOffset: number) {
    const boundedOffset = Math.min(
      Math.max(0, nextOffset),
      Math.max(0, dateKeys.length - DAYS_PER_WEEK),
    );
    const nextKeys = dateKeys.slice(boundedOffset, boundedOffset + DAYS_PER_WEEK);
    const nextDate = nextKeys.find((key) => (groupedSlots.get(key)?.length ?? 0) > 0) ?? nextKeys[0] ?? today;
    setWeekOffset(boundedOffset);
    selectDate(nextDate);
  }

  function chooseSlot(slot: PublicSlot) {
    setSelectedSlot(slot);
    setBookingError(null);
    setRequestKey(idempotencyKey());
    const focusDetails = () => document.getElementById("booking-details-title")?.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusDetails);
    else focusDetails();
  }

  function changeSlot() {
    const previousStart = selectedSlot?.startsAt;
    pendingSlotFocusRef.current = previousStart ?? null;
    setSelectedSlot(null);
    setBookingError(null);
  }

  async function book(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setBookingError(null);
    try {
      const response = await fetch(`/api/public/scheduling/${encodeURIComponent(slug)}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "X-Keepr-One-Language": language },
        body: JSON.stringify({
          startsAt: selectedSlot.startsAt,
          name: String(form.get("name") ?? "").trim(),
          email: String(form.get("email") ?? "").trim(),
          timeZone,
          phone: String(form.get("phone") ?? "").trim() || undefined,
          notes: String(form.get("notes") ?? "").trim() || undefined,
          idempotencyKey: requestKey,
          hp: String(form.get("company") ?? ""),
        }),
      });
      if (!response.ok) {
        const message = await apiError(response, copy("Não foi possível confirmar este horário.", "We could not confirm this time."));
        if (response.status === 409) {
          setSelectedSlot(null);
          setRefreshKey((value) => value + 1);
        }
        throw new Error(message);
      }
      const data = (await response.json()) as BookingResponse;
      setConfirmation(data.booking);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : copy("Não foi possível confirmar este horário.", "We could not confirm this time."));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="public-scheduling-loading" role="status">
        <span aria-hidden="true" />
        <strong>{copy("Consultando horários disponíveis", "Checking available times")}</strong>
        <p>{copy("Isso leva apenas alguns segundos.", "This only takes a few seconds.")}</p>
      </div>
    );
  }

  if (loadError || !page) {
    return (
      <section className="public-scheduling-unavailable" role="alert">
        <p>{copy("Agenda indisponível", "Calendar unavailable")}</p>
        <h1>{copy("Não foi possível abrir este link.", "We could not open this link.")}</h1>
        <span>{loadError ?? copy("Confirme o endereço recebido e tente novamente.", "Check the link you received and try again.")}</span>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>{copy("Tentar novamente", "Try again")}</button>
      </section>
    );
  }

  if (confirmation) {
    const calendarEvent = {
      id: confirmation.id,
      title: confirmation.title,
      ownerName: confirmation.ownerName,
      startsAt: confirmation.startsAt,
      endsAt: confirmation.endsAt,
      timeZone: confirmation.inviteeTimeZone,
    };
    const confirmationTimeZone = timeZoneLabel(
      confirmation.inviteeTimeZone,
      language,
      locale,
      new Date(confirmation.startsAt),
    );

    return (
      <div ref={rootRef} className="public-scheduling-confirmation" data-booking-confirmation>
        <section className="public-scheduling-confirmation-summary" aria-labelledby="booking-confirmation-title">
          <header className="public-scheduling-confirmation-status" role="status" aria-live="polite">
            <div className="public-scheduling-confirmation-mark" aria-hidden="true" data-booking-confirmation-mark>✓</div>
            <div>
              <p>{copy("Horário reservado", "Time reserved")}</p>
              <h1 id="booking-confirmation-title" tabIndex={-1}>{copy("Agendamento confirmado", "Booking confirmed")}</h1>
              <span>{confirmation.title}</span>
            </div>
          </header>

          <dl aria-label={copy("Resumo do agendamento", "Booking summary")}>
            <div><dt>{copy("Com", "With")}</dt><dd>{confirmation.ownerName}</dd></div>
            <div><dt>{copy("Data", "Date")}</dt><dd>{formatFullDate(confirmation.startsAt, confirmation.inviteeTimeZone, locale)}</dd></div>
            <div><dt>{copy("Horário", "Time")}</dt><dd>{formatTime(confirmation.startsAt, confirmation.inviteeTimeZone, locale)} – {formatTime(confirmation.endsAt, confirmation.inviteeTimeZone, locale)}</dd></div>
            <div><dt>{copy("Fuso", "Time zone")}</dt><dd>{confirmationTimeZone}</dd></div>
          </dl>

          <p className="public-scheduling-confirmation-note">
            <strong>{copy("Convite oficial por e-mail", "Official email invitation")}</strong>
            {copy("Você receberá os detalhes e o link do Google Meet na sua caixa de entrada.", "You will receive the details and Google Meet link in your inbox.")}
          </p>
        </section>

        <aside className="public-scheduling-calendar-add" aria-labelledby="calendar-add-title">
          <div className="public-scheduling-calendar-add-heading">
            <div>
              <p>{copy("Próximo passo", "Next step")}</p>
              <h2 id="calendar-add-title">{copy("Salve no seu calendário", "Save it to your calendar")}</h2>
              <span>{copy("Escolha onde deseja guardar este compromisso.", "Choose where you want to save this event.")}</span>
            </div>
          </div>

          <details className="public-scheduling-calendar-picker">
            <summary>
              <span>{copy("Adicionar à agenda", "Add to calendar")}</span>
              <span aria-hidden="true">⌄</span>
            </summary>
            <div className="public-scheduling-calendar-options">
              <a
                data-provider="google"
                href={buildGoogleCalendarUrl(calendarEvent)}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                <span aria-hidden="true">G</span>
                <span><strong>{copy("Google Agenda", "Google Calendar")}</strong><small>{copy("Abrir evento preenchido", "Open prefilled event")}</small></span>
                <span aria-hidden="true">↗</span>
              </a>
              <a
                data-provider="outlook"
                href={buildOutlookCalendarUrl(calendarEvent)}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                <span aria-hidden="true">O</span>
                <span><strong>Microsoft Outlook</strong><small>{copy("Abrir evento preenchido", "Open prefilled event")}</small></span>
                <span aria-hidden="true">↗</span>
              </a>
              <button
                type="button"
                data-provider="universal"
                onClick={() => downloadIcsCalendar(calendarEvent)}
              >
                <span aria-hidden="true">↓</span>
                <span><strong>{copy("Apple Calendar e outros", "Apple Calendar and others")}</strong><small>{copy("Baixar arquivo universal .ics", "Download universal .ics file")}</small></span>
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </details>

          <p className="public-scheduling-calendar-help">
            {copy("Se o convite já apareceu no seu calendário, não é necessário adicionar novamente.", "If the invitation is already in your calendar, you do not need to add it again.")}
          </p>
        </aside>
      </div>
    );
  }

  const daySlots = groupedSlots.get(selectedDate) ?? [];
  const selectedDateLabel = selectedDate ? formatDateKeyFull(selectedDate, locale) : "";
  const currentTimeZoneLabel = timeZoneLabel(timeZone, language, locale);

  return (
    <div ref={rootRef} className="public-scheduling-shell">
      <div className="public-scheduling-workspace">
        <aside className="public-scheduling-event" aria-labelledby="public-scheduling-title">
          <div className="public-scheduling-event-copy">
            <p>{copy("Reunião com {name}", "Meeting with {name}", { name: page.ownerName })}</p>
            <h1 id="public-scheduling-title">{page.title}</h1>
            {page.description ? <span>{page.description}</span> : null}
          </div>

          <dl className="public-scheduling-event-facts" aria-label={copy("Detalhes da reunião", "Meeting details")}>
            <div><dt>{copy("Duração", "Duration")}</dt><dd>{page.durationMinutes} {copy("minutos", "minutes")}</dd></div>
            <div><dt>{copy("Formato", "Format")}</dt><dd>Google Meet</dd></div>
            <div><dt>{copy("Horários", "Times")}</dt><dd>{currentTimeZoneLabel}</dd></div>
          </dl>

          <ol className="public-scheduling-progress" aria-label={copy("Etapas do agendamento", "Booking steps")}>
            <li aria-current={!selectedSlot ? "step" : undefined} data-complete={selectedSlot ? true : undefined}>
              <span aria-hidden="true">1</span>
              <div><strong>{copy("Data e horário", "Date and time")}</strong><small>{copy("Escolha uma opção disponível.", "Choose an available option.")}</small></div>
            </li>
            <li aria-current={selectedSlot ? "step" : undefined}>
              <span aria-hidden="true">2</span>
              <div><strong>{copy("Seus dados", "Your details")}</strong><small>{copy("Confirme para receber o convite.", "Confirm to receive the invitation.")}</small></div>
            </li>
          </ol>

          <div className="public-scheduling-event-note">
            <strong>{copy("Convite automático", "Automatic invitation")}</strong>
            <p>{copy("O evento e o link do Google Meet serão enviados por e-mail.", "The event and Google Meet link will be sent by email.")}</p>
          </div>
        </aside>

        <section className="public-scheduling-stage">
          {selectedSlot ? (
            <form className="public-scheduling-form" onSubmit={book} data-booking-step-content>
              <button type="button" className="public-scheduling-back" onClick={changeSlot}>← {copy("Voltar aos horários", "Back to times")}</button>
              <div className="public-scheduling-selected-slot">
                <div><span>{copy("Horário escolhido", "Selected time")}</span><strong>{formatFullDate(selectedSlot.startsAt, timeZone, locale)}</strong></div>
                <small>{formatTime(selectedSlot.startsAt, timeZone, locale)} – {formatTime(selectedSlot.endsAt, timeZone, locale)}</small>
              </div>
              <div className="public-scheduling-form-heading">
                <h2 id="booking-details-title" tabIndex={-1}>{copy("Confirme seus dados", "Confirm your details")}</h2>
                <p>{copy("Usaremos estas informações somente para organizar a reunião.", "We will only use this information to organize the meeting.")}</p>
              </div>
              <div className="public-scheduling-form-grid">
                <label><span>{copy("Nome completo", "Full name")}</span><input name="name" autoComplete="name" minLength={2} maxLength={100} required /></label>
                <label><span>{copy("E-mail", "Email")}</span><input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
                <label><span>{copy("Telefone", "Phone")} <i>{copy("opcional", "optional")}</i></span><input name="phone" type="tel" autoComplete="tel" maxLength={30} /></label>
                <label className="public-scheduling-field-wide"><span>{copy("Observação", "Notes")} <i>{copy("opcional", "optional")}</i></span><textarea name="notes" rows={3} maxLength={1000} /></label>
                <label className="public-scheduling-honeypot" aria-hidden="true"><span>{copy("Empresa", "Company")}</span><input name="company" tabIndex={-1} autoComplete="off" /></label>
              </div>
              {bookingError ? <p className="public-scheduling-inline-error" role="alert">{bookingError}</p> : null}
              <div className="public-scheduling-form-actions">
                <small>{copy("Ao confirmar, o horário será reservado e o convite chegará no seu e-mail.", "When you confirm, the time will be reserved and the invitation will arrive by email.")}</small>
                <button type="submit" className="public-scheduling-submit" disabled={submitting}>{submitting ? copy("Confirmando…", "Confirming…") : copy("Confirmar agendamento", "Confirm booking")}</button>
              </div>
            </form>
          ) : (
            <div className="public-scheduling-picker" data-booking-step-content>
              <header>
                <div>
                  <h2 id="public-scheduling-date-title">{copy("Escolha o melhor horário", "Choose the best time")}</h2>
                  <p>{copy("Datas e horários disponíveis nos próximos 14 dias.", "Available dates and times over the next 14 days.")}</p>
                </div>
                <label>
                  <span>{copy("Seu fuso horário", "Your time zone")}</span>
                  <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                    {timeZoneOptions.map((zone) => <option key={zone} value={zone}>{timeZoneLabel(zone, language, locale)}</option>)}
                  </select>
                </label>
              </header>

              <div className="public-scheduling-week-toolbar">
                <div><span>{copy("Período exibido", "Displayed period")}</span><strong aria-live="polite">{formatWeekRange(visibleDateKeys, locale)}</strong></div>
                <div>
                  <button type="button" aria-label={copy("Semana anterior", "Previous week")} disabled={weekOffset === 0} onClick={() => showWeek(weekOffset - DAYS_PER_WEEK)}>←</button>
                  <button type="button" aria-label={copy("Próxima semana", "Next week")} disabled={weekOffset + DAYS_PER_WEEK >= dateKeys.length} onClick={() => showWeek(weekOffset + DAYS_PER_WEEK)}>→</button>
                </div>
              </div>

              <div ref={dateRailRef} className="public-scheduling-date-rail" role="group" aria-label={copy("Datas disponíveis", "Available dates")}>
                {visibleDateKeys.map((key) => {
                  const parts = shortDateParts(key, locale);
                  const available = (groupedSlots.get(key)?.length ?? 0) > 0;
                  return (
                    <button key={key} type="button" data-active={selectedDate === key || undefined} aria-pressed={selectedDate === key} disabled={!available} onClick={() => selectDate(key)}>
                      <span>{parts.weekday}</span><strong>{parts.day}</strong><small>{parts.month}</small>
                    </button>
                  );
                })}
              </div>

              <section className="public-scheduling-times" aria-labelledby="public-scheduling-times-title">
                <header>
                  <div><span>{copy("Horários para", "Times for")}</span><h3 id="public-scheduling-times-title">{selectedDateLabel}</h3></div>
                  <small>{daySlots.length} {daySlots.length === 1 ? copy("horário disponível", "available time") : copy("horários disponíveis", "available times")}</small>
                </header>
                <div className="public-scheduling-time-list" role="group" aria-label={selectedDate
                  ? copy("Horários para {date}", "Times for {date}", { date: selectedDate })
                  : copy("Horários", "Times")}>
                  {daySlots.length ? daySlots.map((slot) => (
                    <button
                      key={slot.startsAt}
                      ref={(node) => {
                        if (node) slotButtonRefs.current.set(slot.startsAt, node);
                        else slotButtonRefs.current.delete(slot.startsAt);
                      }}
                      type="button"
                      data-booking-time-option
                      onClick={() => chooseSlot(slot)}
                    >
                      {formatTime(slot.startsAt, timeZone, locale)}
                    </button>
                  )) : <p>{copy("Sem horários neste dia. Escolha outra data ou avance uma semana.", "No times are available on this day. Choose another date or move to the next week.")}</p>}
                </div>
              </section>
              {bookingError && !selectedSlot ? <p id="public-scheduling-booking-error" className="public-scheduling-inline-error" role="alert" tabIndex={-1}>{bookingError}</p> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
