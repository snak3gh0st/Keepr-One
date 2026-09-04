"use client";

import Link from "next/link";
import { MeetingActionCard } from "./CalendarEventCard";
import { useI18n } from "@/components/i18n/LanguageProvider";
import type { UserLanguage } from "@/lib/i18n/config";
import type { CalendarConnectionView, CalendarEventView } from "./types";

type MeetingCopy = { title: string; description: string; defaultTitle: string; actionLabel: string };

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
export function caseMeetingCopy(systemKey: string | null, prospectName: string, language: UserLanguage = "PT"): MeetingCopy {
  const copy = (pt: string, en: string) => language === "PT" ? pt : en;
  const actionLabel = RESCHEDULE_STAGES.has(systemKey ?? "") ? copy("Reagendar reunião", "Reschedule meeting") : copy("Agendar reunião", "Schedule meeting");
  if (FIRST_MEETING_STAGES.has(systemKey ?? "")) {
    return {
      title: copy("Transforme interesse em uma conversa com direção.", "Turn interest into a purposeful conversation."),
      description: copy("Agende ou ajuste a primeira reunião e deixe o próximo passo claro para todos.", "Schedule or adjust the first meeting and make the next step clear for everyone."),
      defaultTitle: `${copy("Primeira reunião", "First meeting")} · ${prospectName}`,
      actionLabel,
    };
  }
  if (ILLUSTRATION_STAGES.has(systemKey ?? "")) {
    return {
      title: copy("Leve a proposta para a mesa no momento certo.", "Bring the proposal to the table at the right time."),
      description: copy("Reserve a apresentação da ilustração e mantenha cliente, proposta e agenda conectados.", "Schedule the illustration presentation and keep the client, proposal, and calendar connected."),
      defaultTitle: `${copy("Apresentação da ilustração", "Illustration presentation")} · ${prospectName}`,
      actionLabel,
    };
  }
  if (APPLICATION_STAGES.has(systemKey ?? "")) {
    return {
      title: copy("Faça a aplicação avançar sem perder o ritmo.", "Keep the application moving without losing momentum."),
      description: copy("Organize assinatura, documentos e alinhamentos em um compromisso vinculado ao lead.", "Organize signatures, documents, and alignment in an event linked to the lead."),
      defaultTitle: `${copy("Revisão da aplicação", "Application review")} · ${prospectName}`,
      actionLabel,
    };
  }
  if (CLIENT_STAGES.has(systemKey ?? "")) {
    return {
      title: copy("O relacionamento continua depois da emissão.", "The relationship continues after issuance."),
      description: copy("Planeje entrega, revisão ou acompanhamento e mantenha a carteira próxima.", "Plan delivery, review, or follow-up and stay close to your book of business."),
      defaultTitle: `${copy("Acompanhamento", "Follow-up")} · ${prospectName}`,
      actionLabel,
    };
  }
  if (systemKey === "LOST") {
    return {
      title: copy("Uma nova conversa pode reabrir a oportunidade.", "A new conversation can reopen the opportunity."),
      description: copy("Se houver um novo sinal de interesse, reserve o contato sem alterar a etapa do CRM.", "If there is renewed interest, schedule the contact without changing the CRM stage."),
      defaultTitle: `${copy("Retomar conversa", "Reconnect")} · ${prospectName}`,
      actionLabel,
    };
  }
  return {
    title: copy("Dê data e hora ao próximo passo.", "Give the next step a date and time."),
    description: copy("Agende uma conversa sem depender da etapa atual e mantenha o atendimento em movimento.", "Schedule a conversation regardless of the current stage and keep the case moving."),
    defaultTitle: `${copy("Reunião com", "Meeting with")} ${prospectName}`,
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
  timeZone,
  systemKey,
  prospectName,
  onSchedule,
  onOpen,
}: {
  canManage: boolean;
  connection: CalendarConnectionView;
  events: CalendarEventView[];
  now: string;
  timeZone: string;
  systemKey: string | null;
  prospectName: string;
  onSchedule: () => void;
  onOpen: (event: CalendarEventView) => void;
}) {
  const { copy: translate, language } = useI18n();
  const meetingCopy = caseMeetingCopy(systemKey, prospectName, language);
  const meetings = splitCaseMeetings(events, now);
  const ready = connectionReady(connection);

  return (
    <section id="case-meetings" className="module-main-surface scroll-mt-24" aria-labelledby="case-meetings-title">
      <div className="flex flex-col gap-5 border-b border-border-steel/75 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-teal">{translate("Agenda · Reuniões", "Calendar · Meetings")}</p>
          <h2 id="case-meetings-title" className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink">{meetingCopy.title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">{meetingCopy.description}</p>
        </div>

        {canManage ? (
          ready ? (
            <button
              type="button"
              onClick={onSchedule}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-rail-strong px-5 text-sm font-semibold text-paper transition-transform duration-300 hover:-translate-y-0.5"
            >
              {meetingCopy.actionLabel} <span aria-hidden className="ml-2">＋</span>
            </button>
          ) : (
            <Link
              href="/agent/calendar"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border-steel bg-paper px-5 text-sm font-semibold text-ink transition-colors hover:border-teal/35 hover:bg-teal-pale"
            >
              {translate("Conectar agenda", "Connect calendar")} <span aria-hidden className="ml-2">↗</span>
            </Link>
          )
        ) : null}
      </div>

      {!canManage ? (
        <div className="mt-5 rounded-2xl border border-border-steel bg-canvas/60 px-5 py-4">
          <p className="text-sm font-medium text-ink">{translate("Agenda individual do agente responsável", "Assigned agent's private calendar")}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{translate("Você pode acompanhar este lead, mas os compromissos e dados da agenda permanecem privados para o agente responsável.", "You can follow this lead, but the assigned agent's events and calendar data remain private.")}</p>
        </div>
      ) : !ready ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border-steel bg-canvas/50 px-5 py-5">
          <p className="text-sm font-medium text-ink">{translate("Conecte o Google Calendar para reservar o próximo passo.", "Connect Google Calendar to schedule the next step.")}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{translate("As reuniões serão vinculadas ao lead e aparecerão também no seu Hoje.", "Meetings will be linked to the lead and will also appear in Today.")}</p>
        </div>
      ) : events.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border-steel bg-canvas/50 px-5 py-5">
          <p className="text-sm font-medium text-ink">{translate("Nenhuma reunião vinculada ainda.", "No linked meetings yet.")}</p>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{translate("Agende a primeira conversa para transformar intenção em um compromisso visível.", "Schedule the first conversation to turn intent into a visible commitment.")}</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,.85fr)]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">{translate("Próximo compromisso", "Next event")}</h3>
              <Link href="/agent/calendar" className="text-xs font-semibold text-teal-deep hover:text-teal">{translate("Abrir agenda", "Open calendar")} ↗</Link>
            </div>
            {meetings.next ? (
              <MeetingActionCard event={meetings.next} displayTimeZone={timeZone} onOpen={onOpen} />
            ) : (
              <div className="rounded-2xl border border-dashed border-border-steel px-4 py-5 text-sm text-ink-muted">{translate("Nenhuma reunião futura. Agende o próximo contato quando fizer sentido.", "No future meetings. Schedule the next contact when it makes sense.")}</div>
            )}
            {meetings.upcoming.length > 0 ? (
              <div className="mt-3 grid gap-2.5">
                {meetings.upcoming.slice(0, 2).map((event) => <MeetingActionCard key={event.id} event={event} displayTimeZone={timeZone} onOpen={onOpen} />)}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">{translate("Histórico", "History")}</h3>
              <span className="rounded-full bg-canvas-deep px-2.5 py-1 font-mono text-[10px] text-ink-muted">{meetings.history.length}</span>
            </div>
            {meetings.history.length ? (
              <div className="grid gap-2.5">
                {meetings.history.slice(0, 3).map((event) => <MeetingActionCard key={event.id} event={event} displayTimeZone={timeZone} onOpen={onOpen} />)}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border-steel px-4 py-5 text-sm text-ink-muted">{translate("As reuniões realizadas ou canceladas aparecerão aqui.", "Completed or canceled meetings will appear here.")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
