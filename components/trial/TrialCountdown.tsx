"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const LAST_SEVEN_DAYS = 7 * SECONDS_PER_DAY;
const LAST_DAY = SECONDS_PER_DAY;

export type TrialCountdownPhase =
  | "normal"
  | "last-7-days"
  | "last-24-hours"
  | "expired";

type TrialCountdownBaseProps = {
  /** ISO-8601 instant that remains the canonical end of the trial. */
  endsAt: string;
  className?: string;
  actionHref?: string;
  actionLabel?: string;
  onExpire?: () => void;
};

export type TrialCountdownProps = TrialCountdownBaseProps &
  (
    | {
        /** Server-calculated value, rounded up so access never looks expired early. */
        initialRemainingSeconds: number;
        serverNow?: never;
      }
    | {
        /** ISO-8601 server clock used to derive a hydration-stable initial value. */
        serverNow: string;
        initialRemainingSeconds?: never;
      }
  );

type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

const PHASE_CONTENT: Record<
  TrialCountdownPhase,
  { label: string; description: string; shell: string; dot: string; badge: string }
> = {
  normal: {
    label: "Teste gratuito ativo",
    description: "Acesso completo disponível durante o período de avaliação.",
    shell: "border-teal/20 bg-teal-pale/45",
    dot: "bg-success",
    badge: "bg-paper text-teal-deep",
  },
  "last-7-days": {
    label: "Últimos 7 dias",
    description: "Seu período gratuito termina em breve.",
    shell: "border-gold/30 bg-gold-pale/65",
    dot: "bg-gold-ink",
    badge: "bg-paper text-gold-ink",
  },
  "last-24-hours": {
    label: "Últimas 24 horas",
    description: "Seu período gratuito termina hoje.",
    shell: "border-danger/25 bg-danger-pale/70",
    dot: "bg-danger",
    badge: "bg-paper text-danger",
  },
  expired: {
    label: "Período gratuito encerrado",
    description: "Escolha um plano para continuar usando a plataforma.",
    shell: "border-border-steel bg-panel",
    dot: "bg-ink-muted",
    badge: "bg-paper text-ink-muted",
  },
};

function safeTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function resolveInitialRemainingSeconds(
  props: TrialCountdownProps,
): number {
  const endsAt = safeTimestamp(props.endsAt);
  if (endsAt === null) return 0;

  const rawSeconds =
    props.initialRemainingSeconds !== undefined
      ? props.initialRemainingSeconds
      : (() => {
          const serverNow = safeTimestamp(props.serverNow);
          return serverNow === null
            ? 0
            : (endsAt - serverNow) / 1_000;
        })();

  if (!Number.isFinite(rawSeconds)) return 0;
  return Math.max(0, Math.ceil(rawSeconds));
}

export function getTrialCountdownPhase(
  remainingSeconds: number,
): TrialCountdownPhase {
  if (remainingSeconds <= 0) return "expired";
  if (remainingSeconds <= LAST_DAY) return "last-24-hours";
  if (remainingSeconds <= LAST_SEVEN_DAYS) return "last-7-days";
  return "normal";
}

function splitCountdown(remainingSeconds: number): CountdownParts {
  const safeSeconds = Math.max(0, Math.floor(remainingSeconds));
  const days = Math.floor(safeSeconds / SECONDS_PER_DAY);
  const afterDays = safeSeconds % SECONDS_PER_DAY;
  const hours = Math.floor(afterDays / SECONDS_PER_HOUR);
  const afterHours = afterDays % SECONDS_PER_HOUR;
  const minutes = Math.floor(afterHours / SECONDS_PER_MINUTE);

  return {
    days,
    hours,
    minutes,
    seconds: afterHours % SECONDS_PER_MINUTE,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function plural(value: number, singular: string, pluralForm: string): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function accessibleTimeLabel(parts: CountdownParts): string {
  return [
    plural(parts.days, "dia", "dias"),
    plural(parts.hours, "hora", "horas"),
    plural(parts.minutes, "minuto", "minutos"),
    plural(parts.seconds, "segundo", "segundos"),
  ].join(", ");
}

function CountdownUnit({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center justify-center px-2 py-2.5 sm:min-w-[4.25rem] sm:px-3">
      <strong className="font-mono text-lg font-semibold leading-none tabular-nums text-ink sm:text-xl">
        {pad(value)}
      </strong>
      <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:text-[10px]">
        {label}
      </span>
    </span>
  );
}

/**
 * A server-anchored, hydration-stable countdown for an active founder trial.
 * Access enforcement remains a server concern; this component only presents
 * the already-authorized trial window.
 */
export function TrialCountdown(props: TrialCountdownProps) {
  const statusId = useId();
  const expiredSourceRef = useRef<string | null>(null);
  const { onExpire } = props;
  const initialRemainingSeconds = resolveInitialRemainingSeconds(props);
  const sourceKey = `${props.endsAt}:${initialRemainingSeconds}`;
  const [tickState, setTickState] = useState({
    sourceKey,
    elapsedSeconds: 0,
  });
  const elapsedSeconds =
    tickState.sourceKey === sourceKey ? tickState.elapsedSeconds : 0;
  const remainingSeconds = Math.max(
    0,
    initialRemainingSeconds - elapsedSeconds,
  );
  const phase = getTrialCountdownPhase(remainingSeconds);
  const content = PHASE_CONTENT[phase];
  const parts = splitCountdown(remainingSeconds);
  const timerLabel =
    phase === "expired"
      ? "O período gratuito foi encerrado. Tempo restante: zero."
      : `Tempo restante do período gratuito: ${accessibleTimeLabel(parts)}.`;

  useEffect(() => {
    if (initialRemainingSeconds <= 0) return;

    const startedAt = Date.now();
    const updateElapsedTime = () => {
      const elapsed = Math.min(
        initialRemainingSeconds,
        Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)),
      );

      setTickState({ sourceKey, elapsedSeconds: elapsed });

      return elapsed;
    };
    const intervalId = window.setInterval(() => {
      if (updateElapsedTime() >= initialRemainingSeconds) {
        window.clearInterval(intervalId);
      }
    }, 1_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") updateElapsedTime();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [initialRemainingSeconds, sourceKey]);

  useEffect(() => {
    if (phase !== "expired") {
      expiredSourceRef.current = null;
      return;
    }
    if (expiredSourceRef.current === sourceKey) return;

    expiredSourceRef.current = sourceKey;
    onExpire?.();
  }, [onExpire, phase, sourceKey]);

  return (
    <section
      className={`trial-countdown w-full rounded-xl border px-4 py-3.5 transition-colors duration-200 motion-reduce:transition-none sm:px-5 ${content.shell} ${props.className ?? ""}`}
      data-state={phase}
      aria-labelledby={statusId}
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              id={statusId}
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${content.badge}`}
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${content.dot}`}
              />
              {content.label}
            </span>
          </div>
          <p className="mt-2 max-w-[38rem] text-sm leading-5 text-ink-muted">
            {content.description}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:flex-row sm:items-center">
          <div
            role="timer"
            aria-live="off"
            aria-label={timerLabel}
            className="grid w-full shrink-0 grid-cols-4 divide-x divide-border-steel overflow-hidden rounded-lg border border-border-steel bg-paper sm:w-auto"
          >
            <CountdownUnit value={parts.days} label="dias" />
            <CountdownUnit value={parts.hours} label="horas" />
            <CountdownUnit value={parts.minutes} label="min" />
            <CountdownUnit value={parts.seconds} label="seg" />
          </div>
          {props.actionHref ? (
            <Link
              href={props.actionHref}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-rail-strong px-4 text-xs font-semibold text-paper transition-colors hover:bg-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rail-strong"
            >
              {props.actionLabel ?? "Ver plano"}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
