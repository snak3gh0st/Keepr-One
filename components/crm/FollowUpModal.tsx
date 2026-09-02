"use client";

import { useMemo, useState, useTransition } from "react";
import { OverlaySurface } from "@/components/overlays/OverlaySurface";
import { quickFollowUpDate } from "@/lib/crm/time";
import { useI18n } from "@/components/i18n/LanguageProvider";

type Result = { ok: true } | { ok: false; message: string };

const QUICK_DAYS = [0, 1, 2, 3, 5, 7] as const;

const CRM_DATE_INPUT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dateInputValue(date: Date) {
  const parts = CRM_DATE_INPUT.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function localDate(days: number) {
  return dateInputValue(quickFollowUpDate(days));
}

export function FollowUpModal({
  open,
  onClose,
  prospectName,
  initialDate,
  initialTime = "09:00",
  initialTitle = "Follow-up",
  submitLabel = "Agendar follow-up",
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  prospectName: string;
  initialDate?: string;
  initialTime?: string;
  initialTitle?: string;
  submitLabel?: string;
  onSubmit: (input: { title: string; scheduledAt: string }) => Promise<Result>;
}) {
  const { copy } = useI18n();
  const [title, setTitle] = useState(initialTitle);
  const [date, setDate] = useState(initialDate ?? localDate(1));
  const [time, setTime] = useState(initialTime);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const today = useMemo(() => localDate(0), []);

  function submit() {
    if (!date) {
      setError(copy("Escolha uma data para continuar.", "Choose a date to continue."));
      return;
    }
    startTransition(async () => {
      setError(null);
      const result = await onSubmit({
        title: title.trim() || "Follow-up",
        scheduledAt: `${date}T${time || "09:00"}`,
      });
      if (result.ok) onClose();
      else setError(result.message);
    });
  }

  return (
    <OverlaySurface
      open={open}
      onClose={onClose}
      titleId="follow-up-modal-title"
      descriptionId="follow-up-modal-description"
    >
      <div className="crm-followup-modal">
        <header>
          <div>
            <span>{copy("Próxima ação", "Next action")}</span>
            <h2 id="follow-up-modal-title">{copy("Quando deseja fazer o follow-up?", "When would you like to follow up?")}</h2>
            <p id="follow-up-modal-description">
              {copy("Agende o próximo contato com", "Schedule the next contact with")} <strong>{prospectName}</strong>. {copy("O lembrete aparecerá no módulo Hoje e nas notificações.", "The reminder will appear in Today and in notifications.")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={copy("Fechar modal", "Close dialog")}>
            ×
          </button>
        </header>

        <fieldset className="crm-followup-quick">
          <legend>{copy("Escolha rápida", "Quick choice")}</legend>
          <div>
            {QUICK_DAYS.map((days) => {
              const optionDate = localDate(days);
              const label = days === 0
                ? copy("Hoje", "Today")
                : days === 1
                  ? copy("Amanhã", "Tomorrow")
                  : copy("Em {count} dias", "In {count} days", { count: days });
              return (
                <button
                  type="button"
                  key={days}
                  data-active={date === optionDate || undefined}
                  aria-pressed={date === optionDate}
                  onClick={() => setDate(optionDate)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="crm-followup-fields">
          <label>
            <span>{copy("Assunto", "Subject")}</span>
            <input
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={copy("Ex.: Retomar proposta de proteção", "E.g. Revisit protection proposal")}
            />
          </label>
          <label>
            <span>{copy("Data", "Date")}</span>
            <input
              type="date"
              min={today}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            <span>{copy("Horário", "Time")}</span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>

        {error ? <p className="crm-followup-error" role="alert">{error}</p> : null}

        <footer>
          <button type="button" onClick={onClose} disabled={pending}>
            {copy("Agora não", "Not now")}
          </button>
          <button type="button" onClick={submit} disabled={pending || !date}>
            {pending ? copy("Salvando…", "Saving…") : submitLabel === "Agendar follow-up" ? copy("Agendar follow-up", "Schedule follow-up") : submitLabel}
            <span aria-hidden="true">→</span>
          </button>
        </footer>
      </div>
    </OverlaySurface>
  );
}
