'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
export type KBotAction = {
  href: string
  label: string
  detail: string
  badge: string
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
  quickActions = [],
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
  quickActions?: KBotAction[]
  announcement?: string | null
}) {
  const { copy } = useI18n()
  const resolvedActionLabel = actionLabel ?? copy('Abrir K-Bot', 'Open K-Bot')
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const browserMounted = useSyncExternalStore(
    subscribeToBrowserMount,
    () => true,
    () => false,
  )
  const panelId = 'kbot-corner-activity'
  const trimmedTitle = title.trim()
  const trimmedDetail = detail?.trim()
  const spokenCopy = trimmedDetail
    ? `${trimmedTitle}${/[.!?…]$/.test(trimmedTitle) ? ' ' : '. '}${trimmedDetail}`
    : trimmedTitle
  const showQuickActions = quickActions.length > 0 && tasks.length === 0 &&
    (state === 'idle' || state === 'success')

  useEffect(() => {
    if (!open) return

    const firstAction = panelRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')
    ;(firstAction ?? panelRef.current)?.focus()

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !panelRef.current?.parentElement?.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open])

  if (!browserMounted) return null

  return createPortal(
    <aside
      aria-label={copy('Status do K-Bot', 'K-Bot status')}
      aria-live={state === 'working' || state === 'waiting' ? 'polite' : 'off'}
      aria-atomic="true"
      data-state={state}
      className="kbot-corner-presence pointer-events-none fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] left-3 right-3 z-[60] md:bottom-4 md:left-auto md:right-5 md:w-auto"
    >
      <span className="sr-only">{spokenCopy}</span>
      <div className="relative ml-auto h-[102px] w-[78px]">
        {announcement ? (
          <div
            role="status"
            aria-label={copy('Atualização do K-Bot', 'K-Bot update')}
            className="kbot-announcement pointer-events-auto absolute bottom-[112px] right-0 w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-border-steel bg-paper px-4 py-3.5 text-sm leading-5 text-ink shadow-[0_8px_24px_rgba(16,41,29,0.14)]"
          >
            <span className="block font-semibold">{announcement}</span>
            {actionHref ? (
              <Link
                href={actionHref}
                className="mt-2 inline-flex min-h-11 items-center rounded-md border border-border-steel bg-paper px-3 py-2 text-sm font-semibold text-teal-deep transition-colors duration-150 hover:border-teal hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                {resolvedActionLabel}
              </Link>
            ) : null}
            <span aria-hidden="true" className="absolute -bottom-[7px] right-8 h-3.5 w-3.5 rotate-45 border-b border-r border-border-steel bg-paper" />
          </div>
        ) : null}
        {open ? (
          <div
            ref={panelRef}
            id={panelId}
            tabIndex={-1}
            aria-label={copy('Painel de atividades do K-Bot', 'K-Bot activity panel')}
            className="kbot-activity-panel pointer-events-auto absolute bottom-[112px] right-0 w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-border-steel bg-paper px-4 py-4 shadow-[0_8px_24px_rgba(16,41,29,0.14)]"
          >
            <span className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-teal-deep">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  state === 'working'
                    ? 'animate-pulse bg-teal'
                    : state === 'waiting'
                      ? 'bg-gold'
                      : state === 'success'
                        ? 'bg-success'
                        : state === 'error'
                          ? 'bg-danger'
                          : 'bg-ink-muted/45'
                }`}
              />
              {copy('O que estou fazendo', 'What I am doing')}
            </span>
            <span className="block text-sm font-semibold leading-5 text-ink">{title}</span>
            {detail ? (
              <span className="mt-1.5 block text-sm leading-5 text-ink-muted">{detail}</span>
            ) : null}
            {tasks.length > 0 ? (
              <ul className="mt-4 space-y-2 border-t border-border-steel pt-3" aria-label={copy('Atividades do K-Bot', 'K-Bot activities')}>
                {tasks.map((task) => {
                  const safeTaskProgress = task.progress == null
                    ? null
                    : Math.min(1, Math.max(0, task.progress))
                  return (
                    <li key={task.id} className="rounded-lg border border-border-steel bg-panel px-3 py-3">
                      <span className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                            task.state === 'working'
                              ? 'animate-pulse bg-teal'
                              : task.state === 'waiting'
                                ? 'bg-gold'
                                : task.state === 'done'
                                  ? 'bg-success'
                                  : 'bg-danger'
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-5 text-ink">{task.label}</span>
                          <span className="mt-0.5 block text-sm leading-5 text-ink-muted">{task.detail}</span>
                          {task.estimate ? (
                            <span className="mt-1.5 block font-mono text-xs font-semibold uppercase tracking-[0.06em] text-teal-deep">
                              {task.estimate}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      {safeTaskProgress != null ? (
                        <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-border-steel/60">
                          <span
                            className="block h-full rounded-full bg-teal transition-[width] duration-500"
                            style={{ width: `${Math.round(safeTaskProgress * 100)}%` }}
                          />
                        </span>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {showQuickActions ? (
              <nav className="mt-4 border-t border-border-steel pt-3" aria-label={copy('Ações do K-Bot', 'K-Bot actions')}>
                <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {copy('Iniciar uma tarefa', 'Start a task')}
                </span>
                <div className="mt-2 grid gap-2">
                  {quickActions.map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      className="group flex min-h-14 items-center gap-3 rounded-lg border border-border-steel bg-paper px-3 py-2.5 transition-colors duration-150 hover:border-teal hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
                    >
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-steel bg-panel font-mono text-[11px] font-semibold text-teal-deep group-hover:border-teal/35 group-hover:bg-paper"
                      >
                        {action.badge}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-5 text-ink">{action.label}</span>
                        <span className="block text-sm leading-5 text-ink-muted">{action.detail}</span>
                      </span>
                      <span aria-hidden="true" className="text-sm text-ink-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-teal-deep">→</span>
                    </Link>
                  ))}
                </div>
              </nav>
            ) : null}
            {actionHref && !showQuickActions ? (
              <Link
                href={actionHref}
                className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border-steel bg-paper px-3 py-2 text-sm font-semibold text-teal-deep transition-colors duration-150 hover:border-teal hover:bg-teal-pale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
              >
                {resolvedActionLabel}
              </Link>
            ) : null}
            <span
              aria-hidden="true"
              className="absolute -bottom-[7px] right-8 h-3.5 w-3.5 rotate-45 border-b border-r border-border-steel bg-paper"
            />
          </div>
        ) : null}

        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={open ? copy('Ocultar atividade do K-Bot', 'Hide K-Bot activity') : copy('Ver atividade do K-Bot', 'View K-Bot activity')}
          onClick={() => setOpen((current) => !current)}
          className="kbot-character-stage pointer-events-auto relative grid h-[102px] w-[78px] place-items-end justify-items-center rounded-xl outline-none transition-transform duration-150 hover:-translate-y-px active:translate-y-0 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
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
