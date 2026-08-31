"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  downloadIcsCalendar,
} from "@/lib/scheduling/calendar-export";

gsap.registerPlugin(useGSAP);

type PublicSchedulingPage = {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  ownerName: string;
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
const TIME_ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Nova York",
  "America/Chicago": "Chicago",
  "America/Denver": "Denver",
  "America/Los_Angeles": "Los Angeles",
  "America/Sao_Paulo": "São Paulo",
  "Europe/London": "Londres",
  UTC: "UTC",
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

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatFullDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function shortDateParts(key: string) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(dateFromKey(key));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value.replace(".", "") ?? "";
  return { weekday: read("weekday"), day: read("day"), month: read("month") };
}

function formatDateKey(key: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-BR", {
    ...options,
    timeZone: "UTC",
  }).format(dateFromKey(key));
}

function formatDateKeyFull(key: string) {
  return formatDateKey(key, { weekday: "long", day: "2-digit", month: "long" });
}

function formatWeekRange(keys: string[]) {
  const first = keys.at(0);
  const last = keys.at(-1);
  if (!first || !last) return "";
  const start = formatDateKey(first, { day: "2-digit", month: "short" }).replace(".", "");
  const end = formatDateKey(last, { day: "2-digit", month: "short" }).replace(".", "");
  return `${start} – ${end}`;
}

function timeZoneLabel(timeZone: string, at = new Date()) {
  const name = TIME_ZONE_NAMES[timeZone] ?? timeZone.replaceAll("_", " ");
  if (timeZone === "UTC") return name;
  try {
    const offset = new Intl.DateTimeFormat("pt-BR", {
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

export function PublicScheduling({ slug }: { slug: string }) {
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

  const today = useMemo(() => dateKeyInTimeZone(new Date(), timeZone), [timeZone]);
  const dateKeys = useMemo(() => Array.from({ length: 14 }, (_, index) => addDateKeyDays(today, index)), [today]);
  const groupedSlots = useMemo(() => slotsByLocalDate(slots, timeZone), [slots, timeZone]);
  const timeZoneOptions = useMemo(() => Array.from(new Set([timeZone, ...COMMON_TIME_ZONES])), [timeZone]);
  const visibleDateKeys = useMemo(
    () => dateKeys.slice(weekOffset, weekOffset + DAYS_PER_WEEK),
    [dateKeys, weekOffset],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSelectedSlot(null);
      try {
        const query = new URLSearchParams({ from: today, days: "14", timeZone });
        const response = await fetch(`/api/public/scheduling/${encodeURIComponent(slug)}/slots?${query}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(await apiError(response, "Esta agenda não está disponível agora."));
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
          setLoadError(error instanceof Error ? error.message : "Esta agenda não está disponível agora.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [dateKeys, refreshKey, slug, timeZone, today]);

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
        headers: { "Content-Type": "application/json", Accept: "application/json" },
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
        const message = await apiError(response, "Não foi possível confirmar este horário.");
        if (response.status === 409) {
          setSelectedSlot(null);
          setRefreshKey((value) => value + 1);
        }
        throw new Error(message);
      }
      const data = (await response.json()) as BookingResponse;
      setConfirmation(data.booking);
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "Não foi possível confirmar este horário.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="public-scheduling-loading" role="status">
        <span aria-hidden="true" />
        <strong>Consultando horários disponíveis</strong>
        <p>Isso leva apenas alguns segundos.</p>
      </div>
    );
  }

  if (loadError || !page) {
    return (
      <section className="public-scheduling-unavailable" role="alert">
        <p>Agenda indisponível</p>
        <h1>Não foi possível abrir este link.</h1>
        <span>{loadError ?? "Confirme o endereço recebido e tente novamente."}</span>
        <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>Tentar novamente</button>
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
      new Date(confirmation.startsAt),
    );

    return (
      <div ref={rootRef} className="public-scheduling-confirmation" data-booking-confirmation>
        <section className="public-scheduling-confirmation-summary" aria-labelledby="booking-confirmation-title">
          <header className="public-scheduling-confirmation-status" role="status" aria-live="polite">
            <div className="public-scheduling-confirmation-mark" aria-hidden="true" data-booking-confirmation-mark>✓</div>
            <div>
              <p>Horário reservado</p>
              <h1 id="booking-confirmation-title" tabIndex={-1}>Agendamento confirmado</h1>
              <span>{confirmation.title}</span>
            </div>
          </header>

          <dl aria-label="Resumo do agendamento">
            <div><dt>Com</dt><dd>{confirmation.ownerName}</dd></div>
            <div><dt>Data</dt><dd>{formatFullDate(confirmation.startsAt, confirmation.inviteeTimeZone)}</dd></div>
            <div><dt>Horário</dt><dd>{formatTime(confirmation.startsAt, confirmation.inviteeTimeZone)} – {formatTime(confirmation.endsAt, confirmation.inviteeTimeZone)}</dd></div>
            <div><dt>Fuso</dt><dd>{confirmationTimeZone}</dd></div>
          </dl>

          <p className="public-scheduling-confirmation-note">
            <strong>Convite oficial por e-mail</strong>
            Você receberá os detalhes e o link do Google Meet na sua caixa de entrada.
          </p>
        </section>

        <aside className="public-scheduling-calendar-add" aria-labelledby="calendar-add-title">
          <div className="public-scheduling-calendar-add-heading">
            <div>
              <p>Próximo passo</p>
              <h2 id="calendar-add-title">Salve no seu calendário</h2>
              <span>Escolha onde deseja guardar este compromisso.</span>
            </div>
          </div>

          <details className="public-scheduling-calendar-picker">
            <summary>
              <span>Adicionar à agenda</span>
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
                <span><strong>Google Agenda</strong><small>Abrir evento preenchido</small></span>
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
                <span><strong>Microsoft Outlook</strong><small>Abrir evento preenchido</small></span>
                <span aria-hidden="true">↗</span>
              </a>
              <button
                type="button"
                data-provider="universal"
                onClick={() => downloadIcsCalendar(calendarEvent)}
              >
                <span aria-hidden="true">↓</span>
                <span><strong>Apple Calendar e outros</strong><small>Baixar arquivo universal .ics</small></span>
                <span aria-hidden="true">↓</span>
              </button>
            </div>
          </details>

          <p className="public-scheduling-calendar-help">
            Se o convite já apareceu no seu calendário, não é necessário adicionar novamente.
          </p>
        </aside>
      </div>
    );
  }

  const daySlots = groupedSlots.get(selectedDate) ?? [];
  const selectedDateLabel = selectedDate ? formatDateKeyFull(selectedDate) : "";
  const currentTimeZoneLabel = timeZoneLabel(timeZone);

  return (
    <div ref={rootRef} className="public-scheduling-shell">
      <div className="public-scheduling-workspace">
        <aside className="public-scheduling-event" aria-labelledby="public-scheduling-title">
          <div className="public-scheduling-event-copy">
            <p>Reunião com {page.ownerName}</p>
            <h1 id="public-scheduling-title">{page.title}</h1>
            {page.description ? <span>{page.description}</span> : null}
          </div>

          <dl className="public-scheduling-event-facts" aria-label="Detalhes da reunião">
            <div><dt>Duração</dt><dd>{page.durationMinutes} minutos</dd></div>
            <div><dt>Formato</dt><dd>Google Meet</dd></div>
            <div><dt>Horários</dt><dd>{currentTimeZoneLabel}</dd></div>
          </dl>

          <ol className="public-scheduling-progress" aria-label="Etapas do agendamento">
            <li aria-current={!selectedSlot ? "step" : undefined} data-complete={selectedSlot ? true : undefined}>
              <span aria-hidden="true">1</span>
              <div><strong>Data e horário</strong><small>Escolha uma opção disponível.</small></div>
            </li>
            <li aria-current={selectedSlot ? "step" : undefined}>
              <span aria-hidden="true">2</span>
              <div><strong>Seus dados</strong><small>Confirme para receber o convite.</small></div>
            </li>
          </ol>

          <div className="public-scheduling-event-note">
            <strong>Convite automático</strong>
            <p>O evento e o link do Google Meet serão enviados por e-mail.</p>
          </div>
        </aside>

        <section className="public-scheduling-stage">
          {selectedSlot ? (
            <form className="public-scheduling-form" onSubmit={book} data-booking-step-content>
              <button type="button" className="public-scheduling-back" onClick={changeSlot}>← Voltar aos horários</button>
              <div className="public-scheduling-selected-slot">
                <div><span>Horário escolhido</span><strong>{formatFullDate(selectedSlot.startsAt, timeZone)}</strong></div>
                <small>{formatTime(selectedSlot.startsAt, timeZone)} – {formatTime(selectedSlot.endsAt, timeZone)}</small>
              </div>
              <div className="public-scheduling-form-heading">
                <h2 id="booking-details-title" tabIndex={-1}>Confirme seus dados</h2>
                <p>Usaremos estas informações somente para organizar a reunião.</p>
              </div>
              <div className="public-scheduling-form-grid">
                <label><span>Nome completo</span><input name="name" autoComplete="name" minLength={2} maxLength={100} required /></label>
                <label><span>E-mail</span><input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
                <label><span>Telefone <i>opcional</i></span><input name="phone" type="tel" autoComplete="tel" maxLength={30} /></label>
                <label className="public-scheduling-field-wide"><span>Observação <i>opcional</i></span><textarea name="notes" rows={3} maxLength={1000} /></label>
                <label className="public-scheduling-honeypot" aria-hidden="true"><span>Empresa</span><input name="company" tabIndex={-1} autoComplete="off" /></label>
              </div>
              {bookingError ? <p className="public-scheduling-inline-error" role="alert">{bookingError}</p> : null}
              <div className="public-scheduling-form-actions">
                <small>Ao confirmar, o horário será reservado e o convite chegará no seu e-mail.</small>
                <button type="submit" className="public-scheduling-submit" disabled={submitting}>{submitting ? "Confirmando…" : "Confirmar agendamento"}</button>
              </div>
            </form>
          ) : (
            <div className="public-scheduling-picker" data-booking-step-content>
              <header>
                <div>
                  <h2 id="public-scheduling-date-title">Escolha o melhor horário</h2>
                  <p>Datas e horários disponíveis nos próximos 14 dias.</p>
                </div>
                <label>
                  <span>Seu fuso horário</span>
                  <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                    {timeZoneOptions.map((zone) => <option key={zone} value={zone}>{timeZoneLabel(zone)}</option>)}
                  </select>
                </label>
              </header>

              <div className="public-scheduling-week-toolbar">
                <div><span>Período exibido</span><strong aria-live="polite">{formatWeekRange(visibleDateKeys)}</strong></div>
                <div>
                  <button type="button" aria-label="Semana anterior" disabled={weekOffset === 0} onClick={() => showWeek(weekOffset - DAYS_PER_WEEK)}>←</button>
                  <button type="button" aria-label="Próxima semana" disabled={weekOffset + DAYS_PER_WEEK >= dateKeys.length} onClick={() => showWeek(weekOffset + DAYS_PER_WEEK)}>→</button>
                </div>
              </div>

              <div ref={dateRailRef} className="public-scheduling-date-rail" role="group" aria-label="Datas disponíveis">
                {visibleDateKeys.map((key) => {
                  const parts = shortDateParts(key);
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
                  <div><span>Horários para</span><h3 id="public-scheduling-times-title">{selectedDateLabel}</h3></div>
                  <small>{daySlots.length} {daySlots.length === 1 ? "horário disponível" : "horários disponíveis"}</small>
                </header>
                <div className="public-scheduling-time-list" role="group" aria-label={selectedDate ? `Horários para ${selectedDate}` : "Horários"}>
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
                      {formatTime(slot.startsAt, timeZone)}
                    </button>
                  )) : <p>Sem horários neste dia. Escolha outra data ou avance uma semana.</p>}
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
