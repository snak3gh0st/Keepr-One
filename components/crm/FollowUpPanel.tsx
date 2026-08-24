"use client";

import { useMemo, useState, useTransition } from "react";
import { FollowUpModal } from "./FollowUpModal";

type Result = { ok: true } | { ok: false; message: string };

export type FollowUpItem = {
  id: string;
  title: string;
  scheduledAt: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED";
  completedAt: string | null;
  cancelledAt: string | null;
};

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/New_York",
  dateStyle: "long",
  timeStyle: "short",
});

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
          <span>Próximo contato</span>
          <h2 id="lead-followup-title">Follow-up</h2>
          <p>Mantenha o ritmo do relacionamento sem depender da memória.</p>
        </div>
        <button
          type="button"
          onClick={() =>
            setModal(next ? { mode: "reschedule", followUp: next } : { mode: "create" })
          }
        >
          <span aria-hidden="true">{next ? "↻" : "+"}</span>
          {next ? "Reagendar follow-up" : "Agendar follow-up"}
        </button>
      </header>

      {next ? (
        <article className="crm-followup-next" data-overdue={overdue || undefined}>
          <div className="crm-followup-date">
            <span>{overdue ? "Atrasado" : "Agendado"}</span>
            <strong>{DATE_TIME.format(new Date(next.scheduledAt))}</strong>
          </div>
          <div className="crm-followup-copy">
            <strong>{next.title}</strong>
            <p>
              {overdue
                ? "Este contato continua na sua fila de Hoje até ser resolvido."
                : `Próximo follow-up com ${prospectName}.`}
            </p>
          </div>
          <div className="crm-followup-actions">
            <button
              type="button"
              disabled={pending}
              onClick={() => setModal({ mode: "reschedule", followUp: next })}
            >
              Reagendar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                resolve(() => onComplete(next.id), () => setCompletedPrompt(true))
              }
            >
              Marcar como realizado
            </button>
            <button
              type="button"
              className="quiet"
              disabled={pending}
              onClick={() => resolve(() => onCancel(next.id))}
            >
              Cancelar
            </button>
          </div>
        </article>
      ) : (
        <div className="crm-followup-empty">
          <span aria-hidden="true"><i /></span>
          <div>
            <strong>Nenhum follow-up pendente.</strong>
            <p>Defina o próximo contato para manter este lead em movimento.</p>
          </div>
          <button type="button" onClick={() => setModal({ mode: "create" })}>
            Definir uma data
          </button>
        </div>
      )}

      {completedPrompt ? (
        <div className="crm-followup-success" role="status">
          <div>
            <strong>Follow-up realizado.</strong>
            <p>Deseja agendar o próximo?</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setCompletedPrompt(false);
              setModal({ mode: "create" });
            }}
          >
            Agendar próximo
          </button>
          <button type="button" className="quiet" onClick={() => setCompletedPrompt(false)}>
            Agora não
          </button>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="crm-followup-history">
          <h3>Histórico recente</h3>
          <ol>
            {history.map((item) => (
              <li key={item.id}>
                <span data-status={item.status.toLowerCase()} aria-hidden="true" />
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.status === "COMPLETED" ? "Realizado" : "Cancelado"} ·{" "}
                    {DATE_TIME.format(new Date(item.completedAt ?? item.cancelledAt ?? item.scheduledAt))}
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
        submitLabel={modal?.mode === "reschedule" ? "Salvar nova data" : "Agendar follow-up"}
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
