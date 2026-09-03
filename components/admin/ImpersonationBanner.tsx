'use client'

import { useEffect, useMemo, useState } from 'react'
import { useImpersonation } from './ImpersonationContext'
import { useI18n } from '@/components/i18n/LanguageProvider'

function remainingLabel(expiresAt: string, now: number, copy: (pt: string, en: string) => string) {
  const remaining = Math.max(0, new Date(expiresAt).getTime() - now)
  const minutes = Math.min(15, Math.max(1, Math.ceil(remaining / 60_000)))
  return copy(`${minutes} min restantes`, `${minutes} min remaining`)
}

export function ImpersonationBanner() {
  const impersonation = useImpersonation()
  const { copy } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  const [isLeaving, setIsLeaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!impersonation.active) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [impersonation.active])

  const time = useMemo(
    () => impersonation.active
      ? remainingLabel(impersonation.expiresAt, now, copy)
      : '',
    [copy, impersonation, now],
  )

  if (!impersonation.active) return null

  async function leavePreview() {
    setIsLeaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/user-preview/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      const payload = await response.json() as { redirectTo?: string; message?: string }
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.message ?? 'STOP_PREVIEW_FAILED')
      }
      window.location.assign(payload.redirectTo)
    } catch {
      setError(copy(
        'Não foi possível voltar agora. Atualize a página e tente novamente.',
        'We could not return right now. Refresh the page and try again.',
      ))
      setIsLeaving(false)
    }
  }

  return (
    <aside
      className="sticky top-0 z-[70] flex min-h-14 shrink-0 items-center border-b border-[#85e6b0]/30 bg-[#07130d] px-3 py-2 text-white shadow-[0_8px_28px_rgba(5,20,12,0.18)] sm:px-5"
      aria-label={copy('Modo de suporte Keepr One', 'Keepr One support mode')}
      data-user-preview-banner
    >
      <div className="mx-auto flex w-full max-w-[1800px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#8ef0b5]/15 text-[#8ef0b5]">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.7">
              <path d="M2.5 10s2.8-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.8 4.5-7.5 4.5S2.5 10 2.5 10Z" />
              <circle cx="10" cy="10" r="2.2" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold sm:text-sm">
              {copy('Visualizando como', 'Viewing as')} {impersonation.targetName}
            </p>
            <p className="truncate text-xs text-white/55">
              {copy('Modo de suporte · somente leitura', 'Support mode · read-only')} · {time}
              <span className="hidden md:inline"> · {impersonation.targetEmail}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {error ? <span className="hidden max-w-xs text-right text-xs text-[#ffaaa5] lg:block" role="alert">{error}</span> : null}
          <button
            type="button"
            onClick={() => void leavePreview()}
            disabled={isLeaving}
            className="inline-flex min-h-9 items-center rounded-full bg-[#8ef0b5] px-3.5 py-2 text-xs font-semibold text-[#07130d] transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60 sm:px-4"
          >
            {isLeaving
              ? copy('Voltando…', 'Returning…')
              : copy('Voltar ao painel Keepr One', 'Return to Keepr One admin')}
          </button>
        </div>
      </div>
    </aside>
  )
}
