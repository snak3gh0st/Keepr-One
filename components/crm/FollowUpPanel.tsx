"use client";

import { useMemo, useState, useTransition } from "react";
import { FollowUpModal } from "./FollowUpModal";
import { useI18n } from "@/components/i18n/LanguageProvider";

type Result = { ok: true } | { ok: false; message: string };

export type FollowUpItem = {
  id: string;
  title: string;
  scheduledAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  completedAt: string | null;
  cancelledAt: string | null;
};

function dateInputValue(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function timeInputValue(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

export function FollowUpPanel({
  prospectName,
  followUps,
  onSchedule,
  onReschedule,
  onComplete,
  onCancel,
  onRefresh,
  now,
}: {
  prospectName: string;
  followUps: FollowUpItem[];
  onSchedule: (input: { title: string; scheduledAt: string }) => Promise<Result>;
  onReschedule: (
    followUpId: string,
    input: { title: string; scheduledAt: string },
  ) => Promise<Result>;
  onComplete: (followUpId: string) => Promise<Result>;
  onCancel: (followUpId: string) => Promise<Result>;
  onRefresh: () => void;
  now: string;
}) {
  const { copy, locale } = useI18n();
  const dateTime = useMemo(() => new Intl.DateTimeFormat(locale, {
    timeZone: "America/New_York",
    dateStyle: "long",
    timeStyle: "short",
  }), [locale]);
  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "reschedule"; followUp: FollowUpItem }
    | null
  >(null);
  const [completedPrompt, setCompletedPrompt] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const scheduled = useMemo(
    () =>
      followUps
        .filter((item) => item.status === "SCHEDULED")
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)),
    [followUps],
  );
  const next = scheduled[0] ?? null;
  const history = followUps.filter((item) => item.status !== "SCHEDULED").slice(0, 4);
  const overdue = next ? new Date(next.scheduledAt).getTime() < new Date(now).getTime() : false;

  function resolve(
    action: () => Promise<Result>,
    after?: () => void,
  ) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      after?.();
      onRefresh();
    });
  }

  return (
    <section className="crm-followup-panel" aria-labelledby="lead-followup-title">
      <header>
        <div>
          <span>{copy("Próximo contato", "Next contact")}</span>
          <h2 id="lead-followup-title">Follow-up</h2>
          <p>{copy("Mantenha o ritmo do relacionamento sem depender da memória.", "Keep the relationship moving without relying on memory.")}</p>
        </div>
        <button
          type="button"
          onClick={() =>
            setModal(next ? { mode: "reschedule", followUp: next } : { mode: "create" })
          }
        >
          <span aria-hidden="true">{next ? "↻" : "+"}</span>
          {next ? copy("Reagendar follow-up", "Reschedule follow-up") : copy("Agendar follow-up", "Schedule follow-up")}
        </button>
      </header>

      {next ? (
        <article className="crm-followup-next" data-overdue={overdue || undefined}>
          <div className="crm-followup-date">
            <span>{overdue ? copy("Atrasado", "Overdue") : copy("Agendado", "Scheduled")}</span>
            <strong>{dateTime.format(new Date(next.scheduledAt))}</strong>
          </div>
          <div className="crm-followup-copy">
            <strong>{next.title}</strong>
            <p>
              {overdue
                ? copy("Este contato continua na sua fila de Hoje até ser resolvido.", "This contact remains in your Today queue until it is resolved.")
                : copy("Próximo follow-up com {name}.", "Next follow-up with {name}.", { name: prospectName })}
            </p>
          </div>
          <div className="crm-followup-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => setModal({ mode: "reschedule", followUp: next })}
            >
              {copy("Reagendar", "Reschedule")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                resolve(() => onComplete(next.id), () => setCompletedPrompt(true))
              }
            >
              {copy("Marcar como realizado", "Mark as completed")}
            </button>
            <button
              type="button"
              className="quiet"
              disabled={pending}
              onClick={() => resolve(() => onCancel(next.id))}
            >
              {copy("Cancelar", "Cancel")}
            </button>
          </div>
        </article>
      ) : (
        <div className="crm-followup-empty">
          <span aria-hidden="true"><i /></span>
          <div>
            <strong>{copy("Nenhum follow-up pendente.", "No pending follow-ups.")}</strong>
            <p>{copy("Defina o próximo contato para manter este lead em movimento.", "Set the next contact to keep this lead moving.")}</p>
          </div>
          <button type="button" onClick={() => setModal({ mode: "create" })}>
            {copy("Definir uma data", "Set a date")}
          </button>
        </div>
      )}

      {completedPrompt ? (
        <div className="crm-followup-success" role="status">
          <div>
            <strong>{copy("Follow-up realizado.", "Follow-up completed.")}</strong>
            <p>{copy("Deseja agendar o próximo?", "Would you like to schedule the next one?")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCompletedPrompt(false);
              setModal({ mode: "create" });
            }}
          >
            {copy("Agendar próximo", "Schedule next")}
          </button>
          <button type="button" className="quiet" onClick={() => setCompletedPrompt(false)}>
            {copy("Agora não", "Not now")}
          </button>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="crm-followup-history">
          <h3>{copy("Histórico recente", "Recent history")}</h3>
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <span data-status={item.status.toLowerCase()} aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.status === "COMPLETED" ? copy("Realizado", "Completed") : copy("Cancelado", "Cancelled")} ·{" "}
                    {dateTime.format(new Date(item.completedAt ?? item.cancelledAt ?? item.scheduledAt))}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {message ? <p className="crm-followup-error" role="alert">{message}</p> : null}

      <FollowUpModal
        key={
          modal?.mode === "reschedule"
            ? `reschedule-${modal.followUp.id}`
            : modal?.mode ?? "closed"
        }
        open={Boolean(modal)}
        onClose={() => setModal(null)}
        prospectName={prospectName}
        initialTitle={modal?.mode === "reschedule" ? modal.followUp.title : "Follow-up"}
        initialDate={
          modal?.mode === "reschedule"
            ? dateInputValue(modal.followUp.scheduledAt)
            : undefined
        }
        initialTime={
          modal?.mode === "reschedule"
            ? timeInputValue(modal.followUp.scheduledAt)
            : undefined
        }
        submitLabel={modal?.mode === "reschedule" ? copy("Salvar nova data", "Save new date") : copy("Agendar follow-up", "Schedule follow-up")}
        onSubmit={async (input) => {
          const result =
            modal?.mode === "reschedule"
              ? await onReschedule(modal.followUp.id, input)
              : await onSchedule(input);
          if (result.ok) onRefresh();
          return result;
        }}
      />
    </section>
  );
}
