'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import {
  useNationalLifeConnectionAttempt,
  type ActiveNationalLifeAttempt,
} from './useNationalLifeConnectionAttempt'

function remainingTime(expiresAt: string) {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now())
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1_000)
  const minutesPart = Math.floor(seconds / 60)
  const secondsPart = seconds % 60
  return `${String(minutesPart).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}`
}

function stateLabel(state: string | undefined) {
  if (state === 'AWAITING_MFA') {
    return 'Confirme a verificação no portal'
  }
  if (state === 'AWAITING_LOGIN') {
    return 'Entre no portal oficial'
  }
  return 'Preparando o portal oficial'
}

const VIEWER_ASPECT_RATIO = 16 / 10
const MAX_VIEWER_WIDTH = 1_600

function useViewerStageSize(viewerUrl: string | null) {
  const viewerAreaRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>()

  useEffect(() => {
    if (!viewerUrl || !viewerAreaRef.current) {
      setStageSize(undefined)
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.min(
        entry.contentRect.width,
        entry.contentRect.height * VIEWER_ASPECT_RATIO,
        MAX_VIEWER_WIDTH,
      )
      const height = width / VIEWER_ASPECT_RATIO
      setStageSize((current) =>
        current?.width === width && current.height === height ? current : { width, height },
      )
    })

    observer.observe(viewerAreaRef.current)
    return () => observer.disconnect()
  }, [viewerUrl])

  return { viewerAreaRef, stageSize }
}

export function NationalLifeBrowserModal({
  attempt,
  onAuthenticated,
  onClosed,
}: {
  attempt: ActiveNationalLifeAttempt
  onAuthenticated(): void
  onClosed(message: string): void
}) {
  const { status, viewerUrl, error, close } =
    useNationalLifeConnectionAttempt(attempt)
  const [remaining, setRemaining] = useState(() => remainingTime(attempt.expiresAt))
  const completed = useRef(false)
  const { viewerAreaRef, stageSize } = useViewerStageSize(viewerUrl)

  const origin = useMemo(
    () => status?.currentOrigin ?? 'Aguardando o portal oficial da National Life',
    [status?.currentOrigin],
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = remainingTime(attempt.expiresAt)
      setRemaining(next)
      if (next === 0 && !completed.current) {
        completed.current = true
        void close().finally(() => {
          onClosed('A sessão segura expirou. Conecte novamente para continuar.')
        })
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [attempt.expiresAt, close, onClosed])

  useEffect(() => {
    if (completed.current) {
      return
    }
    if (status?.state === 'AUTHENTICATED') {
      completed.current = true
      onAuthenticated()
      return
    }
    if (error) {
      completed.current = true
      onClosed(error)
    }
  }, [error, onAuthenticated, onClosed, status?.state])

  async function handleCancel() {
    if (completed.current) {
      return
    }
    completed.current = true
    await close()
    onClosed('Conexão cancelada. Você pode tentar novamente.')
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-rail-strong/85 p-3 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="national-life-modal-title"
    >
      <section className="flex h-[calc(100vh-1.5rem)] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-paper shadow-[0_32px_100px_rgba(0,0,0,0.5)] sm:h-[calc(100vh-3rem)]">
        <header className="flex flex-col gap-4 border-b border-border-steel bg-paper px-5 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-mint-pale px-3 py-1 text-xs font-semibold text-teal-deep">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Sessão segura e isolada
              </span>
              <span className="font-mono text-xs tabular-nums text-ink-muted">
                {formatCountdown(remaining)}
              </span>
            </div>
            <h2
              id="national-life-modal-title"
              className="mt-3 text-xl font-semibold tracking-[-0.025em] text-ink"
            >
              Entrar na National Life
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Esta é a página real da National Life / Auth0, aberta em uma sessão protegida pelo Keepr One.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={handleCancel}>
            Cancelar conexão
          </Button>
        </header>

        <div className="flex items-center justify-between gap-4 border-b border-border-steel bg-panel px-5 py-3 text-xs lg:px-6">
          <div className="min-w-0">
            <p className="font-semibold text-ink">{stateLabel(status?.state)}</p>
            <p className="mt-0.5 truncate font-mono text-ink-muted" aria-label="Origem verificada">
              {origin}
            </p>
          </div>
          <span className="hidden shrink-0 rounded-full border border-border-steel bg-paper px-3 py-1.5 font-semibold text-success sm:inline-flex">
            Origem verificada pelo worker
          </span>
        </div>

        <div className="relative min-h-0 flex-1 bg-white">
          {viewerUrl ? (
            <div
              ref={viewerAreaRef}
              className="grid h-full w-full place-items-center overflow-hidden bg-[#101512] p-2 sm:p-4"
            >
              <div
                data-testid="national-life-viewer-stage"
                className="aspect-[16/10] max-h-[1000px] overflow-hidden bg-white shadow-2xl"
                style={stageSize ? stageSize : { visibility: 'hidden' }}
              >
                <iframe
                  title="Portal oficial da National Life"
                  src={viewerUrl}
                  className="h-full w-full border-0"
                  sandbox="allow-forms allow-scripts allow-same-origin"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-[600px] place-items-center bg-panel">
              <div className="text-center">
                <span className="mx-auto block h-8 w-8 animate-spin rounded-full border-2 border-border-steel border-t-teal" />
                <p className="mt-4 text-sm font-medium text-ink">Abrindo o portal oficial...</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Nenhuma senha da National Life passa pelo Keepr One.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
