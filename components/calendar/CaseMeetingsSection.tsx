"use client";

import Link from "next/link";
import { MeetingActionCard } from "./CalendarEventCard";
import type { CalendarConnectionView, CalendarEventView } from "./types";

type MeetingCopy = { title: string; description: string; defaultTitle: string; actionLabel: "Agendar reunião" | "Reagendar reunião" };

const RESCHEDULE_STAGES = new Set(["RESCHEDULE_FIRST_MEETING", "RESCHEDULE_ILLUSTRATION"]);

const FIRST_MEETING_STAGES = new Set([
  "QUALIFIED",
  "FIRST_MEETING_SCHEDULED",
  "RESCHEDULE_FIRST_MEETING",
]);
const ILLUSTRATION_STAGES = new Set([
  "CREATE_ILLUSTRATION",
  "ILLUSTRATION_SCHEDULED",
  "RESCHEDULE_ILLUSTRATION",
]);
const APPLICATION_STAGES = new Set(["CONTRACT_CLOSED", "APPLICATION"]);
const CLIENT_STAGES = new Set(["POLICY_ISSUED", "ACTIVE_CLIENT"]);

/** Copy follows stable CRM semantics, never a user-editable stage label. */
export function caseMeetingCopy(systemKey: string | null, prospectName: string): MeetingCopy {
  const actionLabel = RESCHEDULE_STAGES.has(systemKey ?? "") ? "Reagendar reunião" : "Agendar reunião";
  if (FIRST_MEETING_STAGES.has(systemKey ?? "")) {
    return {
      title: "Transforme interesse em uma conversa com direção.",
      description: "Agende ou ajuste a primeira reunião e deixe o próximo passo claro para todos.",
      defaultTitle: `Primeira reunião · ${prospectName}`,
      actionLabel,
    };
  }
  if (ILLUSTRATION_STAGES.has(systemKey ?? "")) {
    return {
      title: "Leve a proposta para a mesa no momento certo.",
      description: "Reserve a apresentação da ilustração e mantenha cliente, proposta e agenda conectados.",
      defaultTitle: `Apresentação da ilustração · ${prospectName}`,
      actionLabel,
    };
  }
  if (APPLICATION_STAGES.has(systemKey ?? "")) {
    return {
      title: "Faça a aplicação avançar sem perder o ritmo.",
      description: "Organize assinatura, documentos e alinhamentos em um compromisso vinculado ao lead.",
      defaultTitle: `Revisão da aplicação · ${prospectName}`,
      actionLabel,
    };
  }
  if (CLIENT_STAGES.has(systemKey ?? "")) {
    return {
      title: "O relacionamento continua depois da emissão.",
      description: "Planeje entrega, revisão ou acompanhamento e mantenha a carteira próxima.",
      defaultTitle: `Acompanhamento · ${prospectName}`,
      actionLabel,
    };
  }
  if (systemKey === "LOST") {
    return {
      title: "Uma nova conversa pode reabrir a oportunidade.",
      description: "Se houver um novo sinal de interesse, reserve o contato sem alterar a etapa do CRM.",
      defaultTitle: `Retomar conversa · ${prospectName}`,
      actionLabel,
    };
  }
  return {
    title: "Dê data e hora ao próximo passo.",
    description: "Agende uma conversa sem depender da etapa atual e mantenha o atendimento em movimento.",
    defaultTitle: `Reunião com ${prospectName}`,
    actionLabel,
  };
}

function eventInstant(event: CalendarEventView, end = false) {
  const value = end ? event.endsAt ?? event.startsAt : event.startsAt;
  if (value) return new Date(value).getTime();
  const date = end ? event.endDate ?? event.startDate : event.startDate;
  return date ? new Date(`${date}T00:00:00.000Z`).getTime() : 0;
}

export function splitCaseMeetings(events: CalendarEventView[], nowIso: string) {
  const now = new Date(nowIso).getTime();
  const active = events
    .filter((event) => event.status !== "CANCELLED" && eventInstant(event, true) > now)
    .sort((left, right) => eventInstant(left) - eventInstant(right));
  const history = events
    .filter((event) => event.status === "CANCELLED" || eventInstant(event, true) <= now)
    .sort((left, right) => eventInstant(right) - eventInstant(left));
  return { next: active[0] ?? null, upcoming: active.slice(1), history };
}

function connectionReady(connection: CalendarConnectionView) {
  return connection.status === "CONNECTED" || connection.status === "SYNCING";
}

export function CaseMeetingsSection({
  canManage,
  connection,
  events,
  now,
  systemKey,
  prospectName,
  onSchedule,
  onOpen,
}: {
  canManage: boolean;
  connection: CalendarConnectionView;
  events: CalendarEventView[];
  now: string;
  systemKey: string | null;
  prospectName: string;
  onSchedule: () => void;
  onOpen: (event: CalendarEventView) => void;
}) {
  const copy = caseMeetingCopy(systemKey, prospectName);
  const meetings = splitCaseMeetings(events, now);
  const ready = connectionReady(connection);

  return (
    <section id="case-meetings" className="module-main-surface scroll-mt-24" aria-labelledby="case-meetings-title">
      <div className="flex flex-col gap-5 border-b border-border-steel/75 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">Agenda · Reuniões</p>
          <h2 id="case-meetings-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{copy.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{copy.description}</p>
        </div>

        {canManage ? (
          ready ? (
            <button
              type="button"
              onClick={onSchedule}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-rail-strong px-5 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
            >
              {copy.actionLabel} <span aria-hidden className="ml-2">＋</span>
            </button>
          ) : (
            <Link
              href="/agent/calendar"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border-steel bg-paper px-5 text-sm font-semibold text-ink transition-colors hover:border-teal/35 hover:bg-teal-pale"
            >
              Conectar agenda <span aria-hidden className="ml-2">↗</span>
            </Link>
          )
        ) : null}
      </div>

      {!canManage ? (
        <div className="mt-5 rounded-2xl border border-border-steel bg-canvas/60 px-5 py-4">
          <p className="text-sm font-medium text-ink">Agenda individual do agente responsável</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Você pode acompanhar este lead, mas os compromissos e dados da agenda permanecem privados para o agente responsável.</p>
        </div>
      ) : !ready ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border-steel bg-canvas/50 px-5 py-5">
          <p className="text-sm font-medium text-ink">Conecte o Google Calendar para reservar o próximo passo.</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">As reuniões serão vinculadas ao lead e aparecerão também no seu Hoje.</p>
        </div>
      ) : events.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border-steel bg-canvas/50 px-5 py-5">
          <p className="text-sm font-medium text-ink">Nenhuma reunião vinculada ainda.</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Agende a primeira conversa para transformar intenção em um compromisso visível.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,.85fr)]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Próximo compromisso</h3>
              <Link href="/agent/calendar" className="text-xs font-semibold text-teal-deep hover:text-teal">Abrir agenda ↗</Link>
            </div>
            {meetings.next ? (
              <MeetingActionCard event={meetings.next} onOpen={onOpen} />
            ) : (
              <div className="rounded-2xl border border-dashed border-border-steel px-4 py-5 text-sm text-ink-muted">Nenhuma reunião futura. Agende o próximo contato quando fizer sentido.</div>
            )}
            {meetings.upcoming.length > 0 ? (
              <div className="mt-3 grid gap-2.5">
                {meetings.upcoming.slice(0, 2).map((event) => <MeetingActionCard key={event.id} event={event} onOpen={onOpen} />)}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Histórico</h3>
              <span className="rounded-full bg-canvas-deep px-2.5 py-1 font-mono text-[10px] text-ink-muted">{meetings.history.length}</span>
            </div>
            {meetings.history.length ? (
              <div className="grid gap-2.5">
                {meetings.history.slice(0, 3).map((event) => <MeetingActionCard key={event.id} event={event} onOpen={onOpen} />)}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border-steel px-4 py-5 text-sm text-ink-muted">As reuniões realizadas ou canceladas aparecerão aqui.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
