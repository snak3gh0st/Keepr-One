'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { requestIllustrationPdf } from './actions'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { ForesightActivityIndicator } from './ForesightActivityIndicator'

/// Starts the exact approved Foresight command and keeps the server-rendered
/// status fresh while the local extension works in its own background tab.
export function IllustrationPdfButton({
  illustrationId,
  extensionId,
  disabled = false,
  status,
  safeErrorCode,
}: {
  illustrationId: string
  extensionId?: string
  disabled?: boolean
  status?: 'WORKING' | 'BLOCKED' | 'FAILED'
  safeErrorCode?: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const generating = pending || disabled || started

  useEffect(() => {
    if (status !== 'WORKING') return
    const timer = window.setInterval(() => router.refresh(), 5_000)
    return () => window.clearInterval(timer)
  }, [router, status])

  if (status === 'FAILED' && safeErrorCode === 'FORESIGHT_PREMIUM_WRITE_MISMATCH') {
    return (
      <Link
        href="/agent/illustrations/new"
        className="text-teal transition-colors hover:text-teal-deep"
      >
        Revisar e criar novo cenário
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        disabled={generating}
        onClick={() =>
          startTransition(async () => {
            setStarted(true)
            const result = await requestIllustrationPdf(illustrationId)
            if (!result.ok) {
              setMessage(result.message)
              setStarted(false)
              return
            }
            if (result.completed) {
              setMessage('A ilustração oficial já foi gerada na National Life.')
              router.refresh()
              return
            }
            if (extensionId) {
              try {
                await sendConnectorMessage(extensionId, {
                  type: 'START_NATIONAL_LIFE_COMMAND',
                  commandId: result.commandId,
                })
              } catch {
                // The durable one-minute alarm wakes the same command if the
                // direct page-to-extension channel is temporarily unavailable.
              }
            }
            setMessage(result.duplicate
              ? 'Retomando a geração oficial já registrada.'
              : 'Ilustração oficial iniciada. Você pode sair desta página; se a sessão expirar, avisaremos para entrar novamente.')
            router.refresh()
          })
        }
        className="text-teal transition-colors hover:text-teal-deep disabled:text-ink-muted"
      >
        {generating ? <ForesightActivityIndicator label={pending ? 'Iniciando no Foresight…' : 'Gerando em segundo plano…'} /> :
          status === 'BLOCKED' ? 'Continuar após login' :
            status === 'FAILED' ? 'Tentar novamente' : 'Gerar ilustração oficial'}
      </button>
      {message && (
        <p className="mt-1 text-xs text-ink-muted" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  )
}
