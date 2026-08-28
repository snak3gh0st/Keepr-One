export type KBotState = 'idle' | 'working' | 'waiting' | 'success' | 'error'

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
