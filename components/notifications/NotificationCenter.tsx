'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { setOutsideContentInert } from '@/components/overlays/OverlaySurface'
import { useI18n } from '@/components/i18n/LanguageProvider'

type NotificationItem = {
  id: string
  type: string
  title: string
  message: string
  href: string
  caseId: string | null
  followUpId: string | null
  calendarEventId: string | null
  readAt: string | null
  createdAt: string
}

type NotificationInbox = {
  notifications: NotificationItem[]
  unreadCount: number
}

const EMPTY_INBOX: NotificationInbox = { notifications: [], unreadCount: 0 }
const POLL_INTERVAL_MS = 60_000

function relativeTime(
  value: string,
  locale: string,
  copy: (pt: string, en: string, values?: Record<string, string | number>) => string,
) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return copy('Agora', 'Now')
  if (minutes < 60) return copy('Há {count} min', '{count} min ago', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return copy('Há {count}h', '{count}h ago', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return copy('Há {count}d', '{count}d ago', { count: days })
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit', month: 'short', timeZone: 'America/New_York',
  }).format(
    new Date(value),
  )
}

function BellIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[19px] w-[19px]">
      <path
        d="M18 9.5a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18c0-1.5-3-1.5-3-8.5ZM9.75 21h4.5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="h-4 w-4">
      <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function NotificationCenter({ inverse = false }: { inverse?: boolean }) {
  const { copy, locale, language } = useI18n()
  const [inbox, setInbox] = useState<NotificationInbox>(EMPTY_INBOX)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const overlayRoot = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const latestLoadRequest = useRef(0)
  const router = useRouter()
  const pathname = usePathname()
  const reducedMotion = useReducedMotion() ?? false

  const load = useCallback(async () => {
    const requestId = ++latestLoadRequest.current
    try {
      const response = await fetch('/api/agent/notifications?limit=20', {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return
      const body = (await response.json()) as Partial<NotificationInbox>
      if (requestId !== latestLoadRequest.current) return
      setInbox({
        notifications: Array.isArray(body.notifications) ? body.notifications : [],
        unreadCount:
          typeof body.unreadCount === 'number' ? Math.max(0, body.unreadCount) : 0,
      })
    } catch {
      // A transient inbox failure must not disrupt the rest of the shell.
    } finally {
      if (requestId === latestLoadRequest.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Defer the network synchronization out of the effect's synchronous
    // phase; the response callback is what updates React state.
    const initialLoad = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(initialLoad)
  }, [load, pathname])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_INTERVAL_MS)
    const refreshOnFocus = () => void load()
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const triggerElement = trigger.current
    document.body.style.overflow = 'hidden'
    const restoreOutsideContent = setOutsideContentInert(overlayRoot.current)
    const focusFrame = window.requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    })

    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (!focusable.length) {
        event.preventDefault()
        panel.current.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!panel.current.contains(document.activeElement)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel.current)
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel.current)
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    const closeOutside = (event: PointerEvent) => {
      if (overlayRoot.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('keydown', handleDialogKeys)
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleDialogKeys)
      document.removeEventListener('pointerdown', closeOutside)
      document.body.style.overflow = previousOverflow
      restoreOutsideContent()
      if (triggerElement?.isConnected) triggerElement.focus()
    }
  }, [open])

  async function markAllRead() {
    if (!inbox.unreadCount || markingAll) return
    setMarkingAll(true)
    try {
      const response = await fetch('/api/agent/notifications/read-all', {
        method: 'POST',
        cache: 'no-store',
      })
      if (!response.ok) return
      latestLoadRequest.current += 1
      const readAt = new Date().toISOString()
      setInbox((current) => ({
        unreadCount: 0,
        notifications: current.notifications.map((item) => ({
          ...item,
          readAt: item.readAt ?? readAt,
        })),
      }))
    } finally {
      setMarkingAll(false)
    }
  }

  async function openNotification(item: NotificationItem) {
    if (openingId) return
    setOpeningId(item.id)
    try {
      if (!item.readAt) {
        latestLoadRequest.current += 1
        const readAt = new Date().toISOString()
        setInbox((current) => ({
          unreadCount: Math.max(0, current.unreadCount - 1),
          notifications: current.notifications.map((candidate) =>
            candidate.id === item.id ? { ...candidate, readAt } : candidate,
          ),
        }))
        void fetch(`/api/agent/notifications/${encodeURIComponent(item.id)}`, {
            method: 'PATCH',
            cache: 'no-store',
          }).catch(() => undefined)
      }
      setOpen(false)
      router.push(item.href)
    } finally {
      setOpeningId(null)
    }
  }

  const badgeLabel = inbox.unreadCount > 99 ? '99+' : String(inbox.unreadCount)

  function notificationCopy(item: NotificationItem) {
    if (language === 'PT') return { title: item.title, message: item.message }

    const titleByType: Record<string, string> = {
      FOLLOW_UP_DUE: item.title === 'Follow-up de hoje' ? 'Today’s follow-up' : 'Pending follow-up',
      CALENDAR_EVENT_REMINDER: 'Meeting starting soon',
      CALENDAR_EVENT_CANCELLED: 'Meeting canceled in Google Calendar',
      CALENDAR_EVENT_CHANGED: item.title === 'Participante respondeu ao convite'
        ? 'Attendee responded to the invitation'
        : 'Meeting updated in Google Calendar',
      NATIONAL_LIFE_LOGIN_REQUIRED: 'Renew your National Life login',
    }
    let message = item.message
    const followUpMatch = /^Faça o follow-up com (.+)\.$/.exec(message)
    const reminderMatch = /^(.+) começa em (\d+) minutos\.$/.exec(message)
    const rescheduleMatch = /^(.+) · De (.+) para (.+)\.$/.exec(message)
    const attendeeMatch = /^(.+) (confirmou presença|recusou o convite|respondeu talvez|voltou a aguardar resposta)\.$/.exec(message)
    if (followUpMatch) message = `Follow up with ${followUpMatch[1]}.`
    else if (reminderMatch) message = `${reminderMatch[1]} starts in ${reminderMatch[2]} minutes.`
    else if (rescheduleMatch) message = `${rescheduleMatch[1]} · From ${rescheduleMatch[2]} to ${rescheduleMatch[3]}.`
    else if (attendeeMatch) {
      const response = {
        'confirmou presença': 'accepted',
        'recusou o convite': 'declined the invitation',
        'respondeu talvez': 'responded maybe',
        'voltou a aguardar resposta': 'is awaiting a response again',
      }[attendeeMatch[2]]
      message = `${attendeeMatch[1]} ${response}.`
    }
    else if (item.type === 'NATIONAL_LIFE_LOGIN_REQUIRED') {
      message = 'Your data remains secure. Sign in again so sync can continue where it stopped.'
    }
    return { title: titleByType[item.type] ?? item.title, message }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={
          inbox.unreadCount
            ? copy('Notificações, {count} não lidas', 'Notifications, {count} unread', { count: inbox.unreadCount })
            : copy('Notificações', 'Notifications')
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notification-center-panel"
        aria-hidden={open || undefined}
        disabled={open}
        onClick={() => setOpen((current) => !current)}
        className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-[0_8px_24px_rgba(15,29,19,0.05)] transition-[transform,background-color,border-color] duration-300 hover:-translate-y-0.5 focus-visible:outline-offset-2 ${
          inverse
            ? 'border-white/15 bg-white/[0.07] text-white hover:border-white/30 hover:bg-white/[0.12]'
            : 'border-border-steel bg-paper/85 text-ink hover:border-ink/20 hover:bg-paper'
        }`}
      >
        <BellIcon />
        {inbox.unreadCount > 0 && (
          <motion.span
            key={badgeLabel}
            initial={reducedMotion ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 bg-rail-strong px-1 font-mono text-[9px] font-semibold leading-none text-white ${inverse ? 'border-[#0a0a0a]' : 'border-canvas'}`}
          >
            {badgeLabel}
          </motion.span>
        )}
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={overlayRoot}
                className="pointer-events-none fixed inset-0 z-[100]"
                initial={false}
              >
            <motion.button
              type="button"
              aria-label={copy('Fechar notificações', 'Close notifications')}
              aria-hidden="true"
              tabIndex={-1}
              initial={reducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="pointer-events-auto absolute inset-0 bg-[#07100b]/35 backdrop-blur-[2px] md:bg-[#07100b]/10 md:backdrop-blur-[1px]"
            />
            <motion.section
              ref={panel}
              id="notification-center-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="notification-center-title"
              tabIndex={-1}
              initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.99 }}
              transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] top-[76px] z-[1] flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/75 bg-paper shadow-[0_28px_90px_rgba(3,18,9,0.3)] md:inset-x-auto md:bottom-auto md:right-8 md:top-[84px] md:h-auto md:max-h-[min(640px,calc(100vh-108px))] md:w-[400px] md:rounded-[22px] md:border-border-steel md:shadow-[var(--shadow-overlay)] lg:right-12"
            >
              <div className="flex items-start justify-between gap-4 border-b border-border-steel/75 px-5 py-4">
                <div>
                  <h2 id="notification-center-title" className="text-base font-semibold tracking-[-0.025em] text-ink">
                    {copy('Notificações', 'Notifications')}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {inbox.unreadCount
                      ? inbox.unreadCount === 1
                        ? copy('1 lembrete não lido', '1 unread reminder')
                        : copy('{count} lembretes não lidos', '{count} unread reminders', { count: inbox.unreadCount })
                      : copy('Você está em dia.', 'You’re all caught up.')}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {inbox.unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllRead}
                      disabled={markingAll}
                      className="min-h-9 rounded-full px-3 text-[11px] font-semibold text-teal transition-colors hover:bg-teal-pale disabled:cursor-wait disabled:opacity-50"
                    >
                      {markingAll ? copy('Atualizando…', 'Updating…') : copy('Marcar todas como lidas', 'Mark all as read')}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={copy('Fechar', 'Close')}
                    onClick={() => {
                      setOpen(false)
                      trigger.current?.focus()
                    }}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-panel hover:text-ink"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {loading ? (
                  <div className="space-y-3 px-5 py-5" aria-label={copy('Carregando notificações', 'Loading notifications')}>
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="h-[76px] animate-pulse rounded-2xl bg-panel" />
                    ))}
                  </div>
                ) : inbox.notifications.length ? (
                  <ul className="divide-y divide-border-steel/65">
                    {inbox.notifications.map((item, index) => {
                      const unread = !item.readAt
                      const translatedItem = notificationCopy(item)
                      return (
                        <motion.li
                          key={item.id}
                          initial={reducedMotion ? false : { opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: reducedMotion ? 0 : Math.min(index, 7) * 0.025 }}
                        >
                          <button
                            type="button"
                            disabled={openingId === item.id}
                            onClick={() => openNotification(item)}
                            className={`group relative flex w-full items-start gap-3 px-5 py-4 text-left transition-colors duration-300 hover:bg-panel/75 disabled:cursor-wait ${
                              unread ? 'bg-teal-pale/35' : 'bg-paper'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full transition-transform duration-500 group-hover:scale-125 ${
                                unread ? 'bg-teal shadow-[0_0_0_4px_rgba(58,199,116,0.1)]' : 'bg-border-steel'
                              }`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[13px] leading-5 text-ink ${unread ? 'font-semibold' : 'font-medium'}`}>
                                {translatedItem.title}
                              </span>
                              <span className="mt-0.5 block text-xs leading-[1.55] text-ink-muted">
                                {translatedItem.message}
                              </span>
                              <span className="mt-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-muted/75">
                                {relativeTime(item.createdAt, locale, copy)}
                                <span aria-hidden="true" className="h-0.5 w-0.5 rounded-full bg-border-steel" />
                                {copy('Abrir lead', 'Open lead')}
                              </span>
                            </span>
                            <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" className="mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-ink">
                              <path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </motion.li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="flex min-h-[260px] flex-col items-center justify-center px-8 py-12 text-center">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-border-steel bg-panel text-ink-muted">
                      <BellIcon />
                    </span>
                    <p className="mt-4 text-sm font-semibold text-ink">{copy('Nenhum lembrete por aqui', 'No reminders here')}</p>
                    <p className="mt-1 max-w-[240px] text-xs leading-5 text-ink-muted">
                      {copy('Seus follow-ups aparecem aqui quando chega a hora de agir.', 'Your follow-ups appear here when it is time to act.')}
                    </p>
                  </div>
                )}
              </div>
            </motion.section>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )
        : null}
    </div>
  )
}
