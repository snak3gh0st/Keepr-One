"use client";

import { useMemo, useState, useTransition } from "react";
import { OverlaySurface } from "@/components/overlays/OverlaySurface";
import { quickFollowUpDate } from "@/lib/crm/time";

type Result = { ok: true } | { ok: false; message: string };

const QUICK_DATES = [
  { days: 0, label: "Hoje" },
  { days: 1, label: "Amanhã" },
  { days: 2, label: "Em 2 dias" },
  { days: 3, label: "Em 3 dias" },
  { days: 5, label: "Em 5 dias" },
  { days: 7, label: "Em 7 dias" },
];

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
  const [title, setTitle] = useState(initialTitle);
  const [date, setDate] = useState(initialDate ?? localDate(1));
  const [time, setTime] = useState(initialTime);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const today = useMemo(() => localDate(0), []);

  function submit() {
    if (!date) {
      setError("Escolha uma data para continuar.");
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
            <span>Próxima ação</span>
            <h2 id="follow-up-modal-title">Quando deseja fazer o follow-up?</h2>
            <p id="follow-up-modal-description">
              Agende o próximo contato com <strong>{prospectName}</strong>. O lembrete
              aparecerá no módulo Hoje e nas notificações.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar modal">
            ×
          </button>
        </header>

        <fieldset className="crm-followup-quick">
          <legend>Escolha rápida</legend>
          <div>
            {QUICK_DATES.map((option) => {
              const optionDate = localDate(option.days);
              return (
                <button
                  type="button"
                  key={option.days}
                  data-active={date === optionDate || undefined}
                  aria-pressed={date === optionDate}
                  onClick={() => setDate(optionDate)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="crm-followup-fields">
          <label>
            <span>Assunto</span>
            <input
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Retomar proposta de proteção"
            />
          </label>
          <label>
            <span>Data</span>
            <input
              type="date"
              min={today}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            <span>Horário</span>
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
            Agora não
          </button>
          <button type="button" onClick={submit} disabled={pending || !date}>
            {pending ? "Salvando…" : submitLabel}
            <span aria-hidden="true">→</span>
          </button>
        </footer>
      </div>
    </OverlaySurface>
  );
}
