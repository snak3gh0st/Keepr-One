"use client";

import { useMemo, useState, useTransition } from "react";
import { OverlaySurface } from "@/components/overlays/OverlaySurface";
import type {
  CalendarCaseOption,
  CalendarAvailabilityResult,
  CalendarEventInput,
  CalendarEventView,
  CalendarMutationResult,
  CalendarSourceView,
} from "./types";

type ModalMode = "create" | "edit" | "details";

export type CalendarEventModalProps = {
  open: boolean;
  onClose: () => void;
  mode: ModalMode;
  event?: CalendarEventView | null;
  initialCase?: CalendarCaseOption | null;
  initialStart?: string | null;
  initialEnd?: string | null;
  initialAllDay?: boolean;
  initialTitle?: string | null;
  timeZone: string;
  calendars: CalendarSourceView[];
  cases?: CalendarCaseOption[];
  onSubmit: (input: CalendarEventInput) => Promise<CalendarMutationResult>;
  onRequestEdit?: (event: CalendarEventView) => void;
  onCancelEvent?: (event: CalendarEventView) => Promise<CalendarMutationResult>;
  onDelete?: (event: CalendarEventView) => Promise<CalendarMutationResult>;
  onAssociateCase?: (event: CalendarEventView, caseId: string) => Promise<CalendarMutationResult>;
  onRetrySync?: (event: CalendarEventView) => Promise<CalendarMutationResult>;
  onCheckAvailability?: (input: {
    startsAtLocal: string;
    endsAtLocal: string;
    timeZone: string;
    excludeEventId?: string;
  }) => Promise<CalendarAvailabilityResult>;
};

function wallClockValue(value: string | null | undefined, timeZone: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function inputSeed(props: CalendarEventModalProps) {
  const defaultCalendar =
    props.calendars.find((calendar) => calendar.isDefault && calendar.canWrite) ??
    props.calendars.find((calendar) => calendar.canWrite) ??
    props.calendars[0];
  const event = props.event;
  const now = props.initialStart ?? new Date().toISOString();
  const initialEnd = props.initialEnd ?? new Date(new Date(now).getTime() + 30 * 60_000).toISOString();
  const allDay = event?.allDay ?? props.initialAllDay ?? false;

  return {
    title: event?.title ?? props.initialTitle ?? "",
    description: event?.description ?? "",
    allDay,
    startsAtLocal: allDay ? "" : initialWallClock(event?.startsAt ?? now, props.timeZone),
    endsAtLocal: allDay ? "" : initialWallClock(event?.endsAt ?? initialEnd, props.timeZone),
    startDate: event?.startDate ?? initialWallClock(now, props.timeZone).slice(0, 10),
    // Domain/Google store all-day end dates exclusively. The date input is
    // intentionally inclusive because that is how people describe the event.
    endDate: event?.endDate
      ? shiftDate(event.endDate, -1)
      : initialWallClock(initialEnd, props.timeZone).slice(0, 10),
    location: event?.location ?? "",
    calendarId: event?.calendarId ?? defaultCalendar?.id ?? "",
    caseId: event?.case?.id ?? props.initialCase?.id ?? "",
    attendeeEmails: event?.attendees.map((attendee) => attendee.email).join(", ") ?? props.initialCase?.email ?? "",
    createGoogleMeet: false,
    sendInvites: true,
    reminderMinutes: (event?.reminderMinutes ?? 15) as number | null,
  };
}

function friendlyDate(event: CalendarEventView) {
  if (event.allDay && event.startDate) {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(
      new Date(`${event.startDate}T12:00:00`),
    );
  }
  if (!event.startsAt) return "Horário a definir";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: event.timeZone,
  }).format(new Date(event.startsAt));
}

function durationLabel(event: CalendarEventView) {
  if (event.allDay || !event.startsAt || !event.endsAt) return null;
  const minutes = Math.max(0, Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 60_000));
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function endLabel(event: CalendarEventView) {
  if (event.allDay) {
    if (!event.endDate) return "Dia inteiro";
    const inclusiveEnd = shiftDate(event.endDate, -1);
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date(`${inclusiveEnd}T12:00:00`));
  }
  if (!event.endsAt) return "Término a definir";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: event.timeZone,
  }).format(new Date(event.endsAt));
}

function reminderLabel(minutes: number | null) {
  if (minutes === null) return null;
  if (minutes === 60) return "1 hora antes";
  if (minutes > 60 && minutes % 60 === 0) return `${minutes / 60} horas antes`;
  return `${minutes} minutos antes`;
}

function recurrenceLabel(event: CalendarEventView) {
  const rule = event.recurrence.find((item) => item.startsWith("RRULE:"));
  if (rule?.includes("FREQ=DAILY")) return "Repete diariamente";
  if (rule?.includes("FREQ=WEEKLY")) return "Repete semanalmente";
  if (rule?.includes("FREQ=MONTHLY")) return "Repete mensalmente";
  if (rule?.includes("FREQ=YEARLY")) return "Repete anualmente";
  if (rule || event.providerRecurringEventId) return "Faz parte de uma série recorrente";
  return null;
}

export function CalendarEventModal(props: CalendarEventModalProps) {
  if (!props.open) return null;
  const identity = `${props.mode}:${props.event?.id ?? "new"}:${props.initialStart ?? "now"}:${props.initialCase?.id ?? "none"}`;

  return (
    <OverlaySurface
      open
      onClose={props.onClose}
      titleId="calendar-event-modal-title"
      descriptionId="calendar-event-modal-description"
      variant={props.mode === "details" ? "drawer" : "modal"}
    >
      {props.mode === "details" && props.event ? (
        <CalendarEventDetails key={identity} {...props} event={props.event} />
      ) : (
        <CalendarEventEditor key={identity} {...props} />
      )}
    </OverlaySurface>
  );
}

function CalendarEventDetails(
  props: CalendarEventModalProps & { event: CalendarEventView },
) {
  const { event } = props;
  const [error, setError] = useState<string | null>(null);
  const [caseId, setCaseId] = useState(event.case?.id ?? "");
  const [confirmCancellation, setConfirmCancellation] = useState(false);
  const [pending, startTransition] = useTransition();

  function resolve(
    action: ((event: CalendarEventView) => Promise<CalendarMutationResult>) | undefined,
  ) {
    if (!action) return;
    startTransition(async () => {
      setError(null);
      const result = await action(event);
      if (result.ok) props.onClose();
      else setError(result.message);
    });
  }

  function associateCase() {
    if (!props.onAssociateCase || !caseId) return;
    startTransition(async () => {
      setError(null);
      const result = await props.onAssociateCase!(event, caseId);
      if (result.ok) props.onClose();
      else setError(result.message);
    });
  }

  return (
    <article className="calendar-event-details">
      <header>
        <div>
          <span>Compromisso</span>
          <h2 id="calendar-event-modal-title">{event.title}</h2>
          <p id="calendar-event-modal-description">{friendlyDate(event)}</p>
        </div>
        <button type="button" onClick={props.onClose} aria-label="Fechar detalhes">×</button>
      </header>

      <div className="calendar-event-detail-rail">
        <span style={{ background: event.calendarColor }} aria-hidden="true" />
        <p>{event.calendarName}</p>
        <small>{event.syncStatus === "SYNCED" ? "Sincronizado" : event.syncStatus === "ERROR" ? "Falha na sincronização" : "Sincronização pendente"}</small>
      </div>

      <dl className="calendar-event-detail-list">
        <div><dt>Término</dt><dd>{endLabel(event)}{durationLabel(event) ? ` · ${durationLabel(event)}` : ""}</dd></div>
        {reminderLabel(event.reminderMinutes) ? <div><dt>Lembrete</dt><dd>{reminderLabel(event.reminderMinutes)}</dd></div> : null}
        {recurrenceLabel(event) ? <div><dt>Recorrência</dt><dd>{recurrenceLabel(event)}</dd></div> : null}
        {event.case ? (
          <div><dt>Lead</dt><dd><a href={`/agent/cases/${event.case.id}`}>{event.case.name} ↗</a></dd></div>
        ) : null}
        {event.location ? <div><dt>Local</dt><dd>{event.location}</dd></div> : null}
        {event.meetingUrl ? <div><dt>Reunião</dt><dd><a href={event.meetingUrl} target="_blank" rel="noreferrer">Abrir videochamada ↗</a></dd></div> : null}
        {event.description ? <div><dt>Notas</dt><dd>{event.description}</dd></div> : null}
        {event.attendees.length ? (
          <div><dt>Convidados</dt><dd><ul className="calendar-attendee-status-list">{event.attendees.map((attendee) => <li key={attendee.email}><span>{attendee.name || attendee.email}</span><small>{attendeeStatus(attendee.responseStatus)}</small></li>)}</ul></dd></div>
        ) : null}
      </dl>

      {event.syncStatus === "ERROR" && props.onRetrySync ? (
        <div className="calendar-sync-recovery" role="status">
          <div><strong>O Google ainda não recebeu esta alteração.</strong><p>O compromisso continua salvo na Keepr One. Você pode reenviar a mesma tentativa sem criar duplicidade.</p></div>
          <button type="button" onClick={() => resolve(props.onRetrySync)} disabled={pending}>Tentar novamente</button>
        </div>
      ) : null}

      {!event.case && props.onAssociateCase && props.cases?.length ? (
        <div className="calendar-event-associate">
          <div><span>Conectar ao CRM</span><p>Associe esta reunião a um lead para incluí-la no histórico do atendimento.</p></div>
          <div><select value={caseId} onChange={(item) => setCaseId(item.target.value)} aria-label="Escolher lead"><option value="">Escolha um lead</option>{props.cases.map((item) => <option key={item.id} value={item.id}>{item.name}{item.stage ? ` · ${item.stage}` : ""}</option>)}</select><button type="button" onClick={associateCase} disabled={!caseId || pending}>Associar</button></div>
        </div>
      ) : null}

      {error ? <p className="calendar-form-error" role="alert">{error}</p> : null}

      {confirmCancellation ? (
        <section className="calendar-cancel-confirmation" role="alert" aria-live="assertive">
          <strong>Cancelar “{event.title}”?</strong>
          <p>{friendlyDate(event)}. {event.attendees.length ? `${event.attendees.length} ${event.attendees.length === 1 ? "convidado será avisado" : "convidados serão avisados"} pelo Google.` : "Este compromisso será removido da sua agenda."}</p>
          <div><button type="button" onClick={() => setConfirmCancellation(false)} disabled={pending}>Voltar</button><button type="button" className="calendar-danger-confirm" onClick={() => resolve(props.onCancelEvent)} disabled={pending}>{pending ? "Cancelando…" : "Cancelar compromisso"}</button></div>
        </section>
      ) : null}

      <footer>
        {event.canDelete && props.onDelete ? (
          <button type="button" className="calendar-danger-action" onClick={() => resolve(props.onDelete)} disabled={pending}>Excluir</button>
        ) : event.canEdit && props.onCancelEvent && event.status !== "CANCELLED" ? (
          <button type="button" className="calendar-danger-action" onClick={() => setConfirmCancellation(true)} disabled={pending || confirmCancellation}>Cancelar compromisso</button>
        ) : <span />}
        <div>
          <button type="button" onClick={props.onClose}>Fechar</button>
          {event.canEdit && props.onRequestEdit ? (
            <button type="button" className="calendar-primary-action" onClick={() => props.onRequestEdit?.(event)} disabled={pending}>Editar</button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function CalendarEventEditor(props: CalendarEventModalProps) {
  const seed = useMemo(() => inputSeed(props), [props]);
  const [values, setValues] = useState(seed);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const writableCalendars = props.calendars.filter((calendar) => calendar.canWrite);
  const [attendeeDraft, setAttendeeDraft] = useState("");
  const [duration, setDuration] = useState<number | "custom">(() => {
    if (!values.startsAtLocal || !values.endsAtLocal) return 30;
    const minutes = Math.round((new Date(values.endsAtLocal).getTime() - new Date(values.startsAtLocal).getTime()) / 60_000);
    return [15, 30, 45, 60, 90].includes(minutes) ? minutes : "custom";
  });
  const [availability, setAvailability] = useState<CalendarAvailabilityResult | null>(null);
  const [conflictReview, setConflictReview] = useState<{ message: string; conflicts: NonNullable<Extract<CalendarMutationResult, { ok: false }>["conflicts"]>; token: string } | null>(null);
  const [checkingAvailability, startAvailabilityTransition] = useTransition();
  const attendeeList = useMemo(
    () => values.attendeeEmails.split(/[;,\s]+/).map((email) => email.trim().toLowerCase()).filter(Boolean),
    [values.attendeeEmails],
  );

  function patch<K extends keyof typeof values>(key: K, value: (typeof values)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setConflictReview(null);
  }

  function applyDuration(minutes: number) {
    setDuration(minutes);
    if (!values.startsAtLocal) return;
    const end = new Date(new Date(values.startsAtLocal).getTime() + minutes * 60_000);
    const offset = end.getTimezoneOffset();
    patch("endsAtLocal", new Date(end.getTime() - offset * 60_000).toISOString().slice(0, 16));
    setAvailability(null);
  }

  function addAttendee() {
    const email = attendeeDraft.trim().toLowerCase();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return;
    if (!attendeeList.includes(email)) patch("attendeeEmails", [...attendeeList, email].join(", "));
    setAttendeeDraft("");
  }

  function removeAttendee(email: string) {
    patch("attendeeEmails", attendeeList.filter((item) => item !== email).join(", "));
  }

  function checkAvailability() {
    const checker = props.onCheckAvailability;
    if (!checker || !values.startsAtLocal || !values.endsAtLocal) return;
    startAvailabilityTransition(async () => {
      setAvailability(await checker({
        startsAtLocal: values.startsAtLocal,
        endsAtLocal: values.endsAtLocal,
        timeZone: props.timeZone,
        excludeEventId: props.event?.id,
      }));
    });
  }

  function submit(allowConflict = false) {
    if (!values.title.trim()) return setError("Dê um título ao compromisso.");
    if (!values.calendarId) return setError("Escolha um calendário disponível.");
    if (values.allDay ? !values.startDate : !values.startsAtLocal || !values.endsAtLocal) {
      return setError("Informe quando esse compromisso acontece.");
    }
    if (!values.allDay && values.endsAtLocal <= values.startsAtLocal) {
      return setError("O término precisa ser posterior ao início.");
    }

    startTransition(async () => {
      setError(null);
      const result = await props.onSubmit({
        id: props.event?.id,
        title: values.title.trim(),
        description: values.description.trim() || null,
        allDay: values.allDay,
        startsAtLocal: values.allDay ? null : values.startsAtLocal,
        endsAtLocal: values.allDay ? null : values.endsAtLocal,
        startDate: values.allDay ? values.startDate : null,
        // Date inputs are inclusive. Google and the domain use an exclusive
        // all-day end, so a one-day event is [start, start + 1 day).
        endDate: values.allDay ? shiftDate(values.endDate || values.startDate, 1) : null,
        timeZone: props.timeZone,
        location: values.location.trim() || null,
        calendarId: values.calendarId,
        caseId: values.caseId || null,
        attendeeEmails: values.attendeeEmails
          .split(/[;,\s]+/)
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
        createGoogleMeet: values.createGoogleMeet,
        sendInvites: values.sendInvites,
        reminderMinutes: values.reminderMinutes === null ? null : Number(values.reminderMinutes),
        baseRevision: props.event?.localRevision,
        ...(allowConflict && conflictReview ? { allowConflict: true, conflictOverrideToken: conflictReview.token } : {}),
      });
      if (result.ok) props.onClose();
      else if (result.code === "SCHEDULE_CONFLICT" && result.conflicts?.length && result.conflictOverrideToken) {
        setAvailability({ ok: true, conflicts: result.conflicts, suggestedSlots: [] });
        setConflictReview({ message: result.message, conflicts: result.conflicts, token: result.conflictOverrideToken });
      } else setError(result.message);
    });
  }

  return (
    <form className="calendar-event-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <header>
        <div>
          <span>{props.mode === "edit" ? "Editar compromisso" : "Novo compromisso"}</span>
          <h2 id="calendar-event-modal-title">{props.mode === "edit" ? "Ajuste sem perder o ritmo." : "Reserve o próximo passo."}</h2>
          <p id="calendar-event-modal-description">Vincule o compromisso ao lead para manter atendimento e agenda no mesmo fluxo.</p>
        </div>
        <button type="button" onClick={props.onClose} aria-label="Fechar formulário">×</button>
      </header>

      <div className="calendar-form-grid">
        <label className="calendar-field calendar-field-wide"><span>Título</span><input autoFocus value={values.title} maxLength={180} onChange={(event) => patch("title", event.target.value)} placeholder="Ex.: Revisar proposta com cliente" /></label>
        <label className="calendar-field"><span>Lead ou cliente</span><select value={values.caseId} onChange={(event) => { const caseId = event.target.value; patch("caseId", caseId); const selected = props.cases?.find((item) => item.id === caseId); if (selected?.email && !attendeeList.includes(selected.email.toLowerCase())) patch("attendeeEmails", [...attendeeList, selected.email.toLowerCase()].join(", ")); }}><option value="">Sem vínculo ao CRM</option>{props.cases?.map((item) => <option key={item.id} value={item.id}>{item.name}{item.stage ? ` · ${item.stage}` : ""}</option>)}</select></label>
        <label className="calendar-field"><span>Calendário</span><select value={values.calendarId} onChange={(event) => patch("calendarId", event.target.value)}>{writableCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.isDefault ? " · padrão" : ""}</option>)}</select></label>

        <label className="calendar-all-day"><input type="checkbox" checked={values.allDay} onChange={(event) => patch("allDay", event.target.checked)} /><span>Dia inteiro</span></label>
        {values.allDay ? (
          <>
            <label className="calendar-field"><span>Data</span><input type="date" value={values.startDate} onChange={(event) => patch("startDate", event.target.value)} /></label>
            <label className="calendar-field"><span>Até</span><input type="date" min={values.startDate} value={values.endDate} onChange={(event) => patch("endDate", event.target.value)} /></label>
          </>
        ) : (
          <>
            <label className="calendar-field"><span>Início</span><input type="datetime-local" value={values.startsAtLocal} onChange={(event) => { patch("startsAtLocal", event.target.value); setAvailability(null); if (typeof duration === "number") { const end = new Date(new Date(event.target.value).getTime() + duration * 60_000); const offset = end.getTimezoneOffset(); patch("endsAtLocal", new Date(end.getTime() - offset * 60_000).toISOString().slice(0, 16)); } }} /></label>
            <label className="calendar-field"><span>Término</span><input type="datetime-local" min={values.startsAtLocal} value={values.endsAtLocal} onChange={(event) => { patch("endsAtLocal", event.target.value); setDuration("custom"); setAvailability(null); }} /></label>
            <fieldset className="calendar-duration-options calendar-field-wide"><legend>Duração</legend><div>{[15, 30, 45, 60, 90].map((minutes) => <button key={minutes} type="button" data-active={duration === minutes || undefined} aria-pressed={duration === minutes} onClick={() => applyDuration(minutes)}>{minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 h" : "1 h 30"}</button>)}<span data-active={duration === "custom" || undefined}>Personalizada</span></div></fieldset>
            {props.onCheckAvailability ? <div className="calendar-availability calendar-field-wide"><button type="button" onClick={checkAvailability} disabled={checkingAvailability || !values.startsAtLocal || !values.endsAtLocal}>{checkingAvailability ? "Verificando…" : "Ver disponibilidade"}</button>{availability?.ok ? availability.conflicts.length ? <div data-conflict><strong>{availability.conflicts.length === 1 ? "Existe um conflito nesse horário." : `${availability.conflicts.length} conflitos nesse horário.`}</strong><ul>{availability.conflicts.map((conflict) => <li key={conflict.id}>{conflict.title}</li>)}</ul>{availability.suggestedSlots.length ? <div className="calendar-slot-suggestions"><span>Horários livres próximos</span>{availability.suggestedSlots.map((slot) => <button type="button" key={slot.startsAtLocal} onClick={() => { patch("startsAtLocal", slot.startsAtLocal); patch("endsAtLocal", slot.endsAtLocal); setAvailability(null); }}>{slot.label}</button>)}</div> : null}</div> : <p data-free>✓ Horário livre na sua agenda.</p> : availability && !availability.ok ? <p role="alert" data-conflict>{availability.message}</p> : null}</div> : null}
          </>
        )}

        <label className="calendar-field"><span>Local</span><input value={values.location} maxLength={240} onChange={(event) => patch("location", event.target.value)} placeholder="Online, escritório…" /></label>
        <label className="calendar-field"><span>Lembrete</span><select value={values.reminderMinutes ?? ""} onChange={(event) => patch("reminderMinutes", Number(event.target.value))}><option value="" disabled>Selecione</option>{[5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes === 60 ? "1 hora antes" : `${minutes} minutos antes`}</option>)}</select></label>
        <div className="calendar-attendees calendar-field-wide"><span>Convidados</span><div className="calendar-attendee-entry"><input type="email" value={attendeeDraft} onChange={(event) => setAttendeeDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addAttendee(); } }} placeholder="email@cliente.com" /><button type="button" onClick={addAttendee}>Adicionar</button></div>{attendeeList.length ? <ul>{attendeeList.map((email) => <li key={email}><span>{email}</span><button type="button" onClick={() => removeAttendee(email)} aria-label={`Remover ${email}`}>×</button></li>)}</ul> : null}</div>
        <div className="calendar-form-toggles calendar-field-wide">
          <label><input type="checkbox" checked={Boolean(props.event?.meetingUrl) || values.createGoogleMeet} disabled={Boolean(props.event?.meetingUrl) || !dataHasGoogle(props.calendars)} onChange={(event) => patch("createGoogleMeet", event.target.checked)} /><span><strong>{props.event?.meetingUrl ? "Google Meet ativo" : "Criar Google Meet"}</strong><small>{props.event?.meetingUrl ? "O link existente será preservado." : "O link será gerado pelo Google após salvar."}</small></span></label>
          <label><input type="checkbox" checked={values.sendInvites} onChange={(event) => patch("sendInvites", event.target.checked)} /><span><strong>Enviar convites</strong><small>Notificar os convidados por e-mail sobre esta criação ou alteração.</small></span></label>
        </div>
        <label className="calendar-field calendar-field-wide"><span>Notas</span><textarea value={values.description} maxLength={3000} onChange={(event) => patch("description", event.target.value)} placeholder="Inclua apenas o necessário para este encontro." /></label>
      </div>

      <p className="calendar-timezone-note">Horários em {props.timeZone}</p>
      {error ? <p className="calendar-form-error" role="alert">{error}</p> : null}

      {conflictReview ? <section className="calendar-conflict-confirmation" role="alert" aria-live="assertive"><strong>{conflictReview.message}</strong><p>Revise o horário ou confirme que deseja manter a sobreposição.</p><ul>{conflictReview.conflicts.map((conflict) => <li key={conflict.id}>{conflict.title}</li>)}</ul></section> : null}

      <footer>
        {conflictReview ? <><button type="button" onClick={() => { setConflictReview(null); setAvailability(null); }} disabled={pending}>Voltar e ajustar</button><button type="button" className="calendar-danger-confirm" onClick={() => submit(true)} disabled={pending}>{pending ? "Salvando…" : "Agendar mesmo assim"}</button></> : <><button type="button" onClick={props.onClose} disabled={pending}>Cancelar</button><button type="submit" className="calendar-primary-action" disabled={pending || !writableCalendars.length}>{pending ? "Salvando…" : props.mode === "edit" ? "Salvar alterações" : "Criar compromisso"}<span aria-hidden="true">→</span></button></>}
      </footer>
    </form>
  );
}

function attendeeStatus(value?: string) {
  return ({ ACCEPTED: "Confirmado", DECLINED: "Recusou", TENTATIVE: "Talvez", NEEDS_ACTION: "Aguardando resposta" } as Record<string, string>)[value ?? ""] ?? "Aguardando resposta";
}

function dataHasGoogle(calendars: CalendarSourceView[]) {
  return calendars.some((calendar) => calendar.canWrite);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function initialWallClock(value: string, timeZone: string) {
  // Mobile quick-create deliberately supplies a wall-clock value for the
  // selected rail date. FullCalendar supplies an instant (with Z/offset).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value.slice(0, 16);
  return wallClockValue(value, timeZone);
}
