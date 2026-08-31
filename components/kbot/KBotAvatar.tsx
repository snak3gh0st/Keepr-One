'use client'

import Link from 'next/link'
import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '@/components/i18n/LanguageProvider'

export type KBotState = 'idle' | 'working' | 'waiting' | 'success' | 'error'
export type KBotActivityMode = 'idle' | 'sync' | 'illustration' | 'application' | 'combined'
export type KBotTask = {
  id: string
  label: string
  detail: string
  state: 'working' | 'waiting' | 'done' | 'error'
  progress?: number | null
  estimate?: string | null
}

const sizeClass = {
  xs: 'h-6 w-6 rounded-[5px] p-1',
  sm: 'h-9 w-9 rounded-[7px] p-1.5',
  md: 'h-12 w-12 rounded-[9px] p-2',
  lg: 'h-16 w-16 rounded-[11px] p-2.5',
} as const

const stateClass: Record<KBotState, string> = {
  idle: 'text-ink-muted',
  working: 'text-mint',
  waiting: 'text-gold',
  success: 'text-success',
  error: 'text-danger',
}

const subscribeToBrowserMount = () => () => {}

/**
 * K-Bot is an operational indicator, not a chat persona. The 16 × 16 drawing
 * intentionally resembles a compact terminal/scanner and stays crisp at every
 * supported size. All meaning is repeated in adjacent text.
 */
export function KBotAvatar({
  state = 'idle',
  size = 'md',
}: {
  state?: KBotState
  size?: keyof typeof sizeClass
}) {
  return (
    <span
      aria-hidden="true"
      data-state={state}
      className={`kbot-avatar relative inline-grid shrink-0 place-items-center overflow-hidden bg-rail-strong shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09),0_10px_24px_rgba(11,24,17,0.12)] ${sizeClass[size]} ${stateClass[state]}`}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-full w-full"
        shapeRendering="crispEdges"
        focusable="false"
      >
        <rect className="fill-paper/32" x="7" y="0" width="2" height="2" />
        <rect className="fill-paper/18" x="6" y="2" width="4" height="2" />
        <rect className="fill-current" x="2" y="4" width="12" height="9" />
        <rect className="fill-rail-strong" x="3" y="5" width="10" height="6" />
        <rect className="kbot-eye fill-current" x="5" y="7" width="2" height="2" />
        <rect className="kbot-eye fill-current" x="9" y="7" width="2" height="2" />
        <rect className="fill-current opacity-55" x="5" y="11" width="6" height="1" />
        <rect className="fill-current opacity-70" x="0" y="6" width="2" height="4" />
        <rect className="fill-current opacity-70" x="14" y="6" width="2" height="4" />
        <rect className="fill-paper/24" x="4" y="13" width="3" height="2" />
        <rect className="fill-paper/24" x="9" y="13" width="3" height="2" />
      </svg>
      <span className="kbot-scan absolute left-2 right-2 top-2 h-px bg-paper/70 opacity-0" />
    </span>
  )
}

export function KBotActivity({
  state,
  title,
  detail,
  estimate,
  compact = false,
}: {
  state: KBotState
  title: string
  detail?: string | null
  estimate?: string | null
  compact?: boolean
}) {
  return (
    <div
      role="status"
      aria-live={state === 'working' || state === 'waiting' ? 'polite' : 'off'}
      aria-atomic="true"
      className="flex min-w-0 items-center gap-3"
    >
      <KBotAvatar state={state} size={compact ? 'sm' : 'md'} />
      <span className="min-w-0">
        <span className={`${compact ? 'text-xs' : 'text-sm'} block font-semibold leading-5 text-ink`}>
          {title}
        </span>
        {detail && (
          <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{detail}</span>
        )}
        {estimate && (
          <span className="mt-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-teal-deep">
            {estimate}
          </span>
        )}
      </span>
    </div>
  )
}

function KBotCharacter({
  state,
  activity = 'idle',
}: {
  state: KBotState
  activity?: KBotActivityMode
}) {
  const carriesPaper = activity === 'illustration' || activity === 'application' || activity === 'combined'

  return (
    <span
      aria-hidden="true"
      data-kbot-character="true"
      data-state={state}
      data-activity={activity}
      data-expression={state === 'error' ? 'sad' : state === 'success' ? 'happy' : 'focused'}
      className={`kbot-character relative block h-[88px] w-[70px] shrink-0 ${stateClass[state]}`}
    >
      <svg
        viewBox="0 0 32 40"
        className="h-full w-full overflow-visible"
        shapeRendering="crispEdges"
        focusable="false"
      >
        <g className="kbot-character-antenna">
          <rect className="fill-mint" x="15" y="1" width="2" height="5" />
          <rect className="fill-current" x="14" y="0" width="4" height="3" />
        </g>

        <rect className="fill-mint/55" x="4" y="7" width="24" height="15" />
        <rect className="fill-mint" x="6" y="5" width="20" height="17" />
        <rect className="fill-rail-strong" x="8" y="8" width="16" height="10" />
        <rect className="fill-mint/70" x="2" y="10" width="4" height="8" />
        <rect className="fill-mint/70" x="26" y="10" width="4" height="8" />

        <g className="kbot-character-eyes">
          {state === 'error' ? (
            <>
              <rect className="fill-paper" x="10" y="12" width="4" height="3" />
              <rect className="fill-paper" x="18" y="12" width="4" height="3" />
              <rect className="fill-mint" x="11" y="13" width="2" height="2" />
              <rect className="fill-mint" x="19" y="13" width="2" height="2" />
              <rect className="fill-mint/65" x="10" y="10" width="3" height="1" />
              <rect className="fill-mint/65" x="13" y="11" width="1" height="1" />
              <rect className="fill-mint/65" x="19" y="11" width="1" height="1" />
              <rect className="fill-mint/65" x="20" y="10" width="3" height="1" />
            </>
          ) : (
            <>
              <rect className="fill-paper" x="10" y="11" width="4" height="4" />
              <rect className="fill-paper" x="18" y="11" width="4" height="4" />
              <rect className="fill-mint" x="11" y="12" width="2" height="2" />
              <rect className="fill-mint" x="19" y="12" width="2" height="2" />
            </>
          )}
        </g>
        {state === 'error' ? (
          <g className="kbot-character-sad-face">
            <rect className="fill-mint/65" x="12" y="17" width="2" height="1" />
            <rect className="fill-mint/65" x="14" y="16" width="4" height="1" />
            <rect className="fill-mint/65" x="18" y="17" width="2" height="1" />
            <rect className="fill-sky-300" x="23" y="14" width="1" height="2" />
            <rect className="fill-sky-300" x="24" y="16" width="1" height="2" />
          </g>
        ) : state === 'success' ? (
          <g className="kbot-character-happy-face">
            <rect className="fill-mint/65" x="12" y="16" width="2" height="1" />
            <rect className="fill-mint/65" x="14" y="17" width="4" height="1" />
            <rect className="fill-mint/65" x="18" y="16" width="2" height="1" />
          </g>
        ) : (
          <rect className="fill-mint/65" x="13" y="17" width="6" height="1" />
        )}
        <rect className="kbot-character-scan fill-paper/70" x="8" y="8" width="16" height="1" />

        <rect className="fill-mint/75" x="13" y="22" width="6" height="3" />
        <rect className="fill-mint" x="8" y="25" width="16" height="10" />
        <rect className="fill-rail-strong" x="12" y="28" width="8" height="4" />
        <rect className="fill-current" x="14" y="29" width="4" height="2" />

        <g className="kbot-character-arm kbot-character-arm-left">
          <rect className="fill-mint/80" x="4" y="26" width="4" height="8" />
          <rect className="fill-mint" x="3" y="32" width="5" height="3" />
        </g>
        <g className="kbot-character-arm kbot-character-arm-right">
          <rect className="fill-mint/80" x="24" y="26" width="4" height="8" />
          <rect className="fill-mint" x="24" y="32" width="5" height="3" />
        </g>
        {carriesPaper ? (
          <g className="kbot-character-paper" data-kbot-paper="true">
            <rect className="fill-paper" x="25" y="27" width="7" height="9" />
            <rect className="fill-teal/55" x="27" y="29" width="3" height="1" />
            <rect className="fill-teal/35" x="27" y="32" width="4" height="1" />
          </g>
        ) : null}

        <g className="kbot-character-leg kbot-character-leg-left">
          <rect className="fill-mint/80" x="10" y="35" width="5" height="4" />
          <rect className="fill-mint" x="8" y="38" width="7" height="2" />
        </g>
        <g className="kbot-character-leg kbot-character-leg-right">
          <rect className="fill-mint/80" x="18" y="35" width="5" height="4" />
          <rect className="fill-mint" x="18" y="38" width="7" height="2" />
        </g>
      </svg>
    </span>
  )
}

function KBotProgressRings({
  progress,
  secondaryState,
}: {
  progress?: number | null
  secondaryState?: 'working' | 'waiting' | null
}) {
  const { copy } = useI18n()
  const safeProgress = progress == null ? null : Math.min(1, Math.max(0, progress))
  const percentage = safeProgress == null ? null : Math.round(safeProgress * 100)
  const circumference = 2 * Math.PI * 34

  if (safeProgress == null && !secondaryState) return null

  return (
    <span className="pointer-events-none absolute inset-0" data-kbot-progress="true">
      {safeProgress != null ? (
        <span role="img" aria-label={copy('Progresso da sincronização: {percentage}%', 'Sync progress: {percentage}%', { percentage: percentage ?? 0 })} className="absolute inset-0">
          <svg aria-hidden="true" viewBox="0 0 78 102" className="h-full w-full overflow-visible">
            <circle cx="39" cy="50" r="34" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1.5" />
            <circle
              cx="39"
              cy="50"
              r="34"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${safeProgress * circumference} ${circumference}`}
              className="text-teal transition-[stroke-dasharray] duration-500"
              transform="rotate(-90 39 50)"
            />
          </svg>
        </span>
      ) : null}
      {secondaryState ? (
        <span
          role="img"
          aria-label={secondaryState === 'working'
            ? copy('Ilustração em andamento', 'Illustration in progress')
            : copy('Ilustração aguardando login', 'Illustration waiting for login')}
          className="absolute inset-0"
        >
          <svg aria-hidden="true" viewBox="0 0 78 102" className="h-full w-full overflow-visible">
            <circle
              cx="39"
              cy="50"
              r="38"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="16 223"
              className={`${secondaryState === 'working' ? 'kbot-secondary-progress' : ''} text-gold`}
              transform="rotate(-90 39 50)"
            />
          </svg>
        </span>
      ) : null}
    </span>
  )
}

/**
 * Persistent operational presence for pages where K-Bot can work. Clicking the
 * character reveals its current activity; this is a status panel, not a chat.
 */
export function KBotCornerPresence({
  state,
  title,
  detail,
  actionHref,
  actionLabel,
  activity = 'idle',
  progress,
  secondaryState = null,
  tasks = [],
  announcement,
}: {
  state: KBotState
  title: string
  detail?: string | null
  actionHref?: string | null
  actionLabel?: string
  activity?: KBotActivityMode
  progress?: number | null
  secondaryState?: 'working' | 'waiting' | null
  tasks?: KBotTask[]
  announcement?: string | null
}) {
  const { copy } = useI18n()
  const resolvedActionLabel = actionLabel ?? copy('Abrir K-Bot', 'Open K-Bot')
  const [open, setOpen] = useState(false)
  const browserMounted = useSyncExternalStore(
    subscribeToBrowserMount,
    () => true,
    () => false,
  )
  const panelId = 'kbot-corner-activity'

  if (!browserMounted) return null

  return createPortal(
    <aside
      aria-label={copy('Status do K-Bot', 'K-Bot status')}
      aria-live={state === 'working' || state === 'waiting' ? 'polite' : 'off'}
      aria-atomic="true"
      data-state={state}
      className="kbot-corner-presence pointer-events-none fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 right-3 z-[60] md:bottom-4 md:left-auto md:right-5 md:w-auto"
    >
      <span className="sr-only">{title}. {detail}</span>
      <div className="relative ml-auto h-[102px] w-[78px]">
        {announcement ? (
          <div
            role="status"
            aria-label={copy('Atualização do K-Bot', 'K-Bot update')}
            className="pointer-events-auto absolute bottom-[104px] right-0 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-paper/10 bg-rail-strong/95 px-4 py-3 text-[11px] leading-4 text-white shadow-[0_18px_48px_rgba(7,22,13,0.26)] backdrop-blur-xl"
          >
            <span className="font-medium">{announcement}</span>
            {actionHref ? (
              <Link href={actionHref} className="ml-2 font-semibold text-mint underline decoration-mint/40 underline-offset-2">
                {resolvedActionLabel}
              </Link>
            ) : null}
            <span aria-hidden="true" className="absolute -bottom-[7px] right-8 h-3.5 w-3.5 rotate-45 border-b border-r border-paper/10 bg-rail-strong/95" />
          </div>
        ) : null}
        {open ? (
          <div
            id={panelId}
            className="kbot-activity-panel pointer-events-auto absolute bottom-[104px] right-0 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-paper/10 bg-rail-strong/95 px-4 py-3.5 shadow-[0_18px_48px_rgba(7,22,13,0.26)] backdrop-blur-xl"
          >
            <span className="mb-2 flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-white/70">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  state === 'working'
                    ? 'animate-pulse bg-mint'
                    : state === 'waiting'
                      ? 'bg-gold'
                      : state === 'success'
                        ? 'bg-success'
                        : state === 'error'
                          ? 'bg-danger'
                          : 'bg-paper/35'
                }`}
              />
              {copy('O que estou fazendo', 'What I am doing')}
            </span>
            <span className="block text-xs font-semibold leading-4 text-white">{title}</span>
            {detail ? (
              <span className="mt-1 block text-[11px] leading-4 text-white/85">{detail}</span>
            ) : null}
            {tasks.length > 0 ? (
              <ul className="mt-3 space-y-2 border-t border-white/10 pt-3" aria-label={copy('Atividades do K-Bot', 'K-Bot activities')}>
                {tasks.map((task) => {
                  const safeTaskProgress = task.progress == null
                    ? null
                    : Math.min(1, Math.max(0, task.progress))
                  return (
                    <li key={task.id} className="rounded-xl bg-white/[0.055] px-3 py-2.5">
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            task.state === 'working'
                              ? 'animate-pulse bg-mint'
                              : task.state === 'waiting'
                                ? 'bg-gold'
                                : task.state === 'done'
                                  ? 'bg-success'
                                  : 'bg-danger'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-semibold leading-4 text-white">{task.label}</span>
                          <span className="mt-0.5 block text-[10px] leading-4 text-white/75">{task.detail}</span>
                          {task.estimate ? (
                            <span className="mt-1 block font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-mint">
                              {task.estimate}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {safeTaskProgress != null ? (
                        <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/10">
                          <span
                            className="block h-full rounded-full bg-mint transition-[width] duration-500"
                            style={{ width: `${Math.round(safeTaskProgress * 100)}%` }}
                          />
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {actionHref ? (
              <Link
                href={actionHref}
                className="mt-3 inline-flex rounded-full border border-white/20 px-3 py-1.5 text-[10px] font-semibold text-white transition-colors hover:border-mint/45 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
              >
                {resolvedActionLabel}
              </Link>
            ) : null}
            <span
              aria-hidden="true"
              className="absolute -bottom-[7px] right-8 h-3.5 w-3.5 rotate-45 border-b border-r border-paper/10 bg-rail-strong/95"
            />
          </div>
        ) : null}

        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? copy('Ocultar atividade do K-Bot', 'Hide K-Bot activity') : copy('Ver atividade do K-Bot', 'View K-Bot activity')}
          onClick={() => setOpen((current) => !current)}
          className="kbot-character-stage pointer-events-auto relative grid h-[102px] w-[78px] place-items-end justify-items-center rounded-2xl outline-none transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-px active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
        >
          <span
            aria-hidden="true"
            className="absolute bottom-0 h-2.5 w-14 rounded-[50%] bg-rail-strong/20 blur-[1px]"
          />
          <KBotProgressRings progress={progress} secondaryState={secondaryState} />
          <KBotCharacter state={state} activity={activity} />
        </button>
      </div>
    </aside>,
    document.body,
  )
}

export function KBotTaskTrail({
  steps,
  currentIndex,
  label,
}: {
  steps: readonly string[]
  currentIndex: number
  label: string
}) {
  return (
    <ol aria-label={label} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
      {steps.map((step, index) => {
        const complete = index < currentIndex
        const current = index === currentIndex
        return (
          <li
            key={step}
            aria-current={current ? 'step' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
              complete
                ? 'border-teal/20 bg-teal-pale/60 text-teal-deep'
                : current
                  ? 'border-gold/40 bg-gold-pale text-gold-ink'
                  : 'border-border-steel bg-paper text-ink-muted/65'
            }`}
          >
            <span aria-hidden="true" className="font-mono tabular-nums">
              {complete ? '✓' : String(index + 1).padStart(2, '0')}
            </span>
            {step}
          </li>
        )
      })}
    </ol>
  )
}
