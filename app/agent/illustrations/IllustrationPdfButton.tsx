'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { requestIllustrationPdf } from './actions'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { ForesightActivityIndicator } from './ForesightActivityIndicator'
import { KBotTaskTrail } from '@/components/kbot/KBotAvatar'
import { useI18n } from '@/components/i18n/LanguageProvider'

const PHASE_COPY: Record<string, { pt: string; en: string }> = {
  OPENING_FORESIGHT: { pt: 'K-Bot está abrindo o Foresight…', en: 'K-Bot is opening Foresight…' },
  OPENING_CASE: { pt: 'K-Bot está abrindo um novo caso…', en: 'K-Bot is opening a new case…' },
  FILLING_CLIENT: { pt: 'K-Bot está preenchendo os dados do cliente…', en: 'K-Bot is entering the client data…' },
  CONFIGURING_PRODUCT: { pt: 'K-Bot está preenchendo o produto e os valores…', en: 'K-Bot is entering the product and amounts…' },
  CALCULATING: { pt: 'K-Bot está esperando o cálculo da National Life…', en: 'K-Bot is waiting for National Life’s calculation…' },
  VERIFYING_VALUES: { pt: 'K-Bot está conferindo os valores da National Life…', en: 'K-Bot is checking the National Life values…' },
  SAVING_CASE: { pt: 'K-Bot está salvando a ilustração…', en: 'K-Bot is saving the illustration…' },
  GENERATING_PDF: { pt: 'K-Bot está criando o PDF oficial…', en: 'K-Bot is creating the official PDF…' },
  UPLOADING_PDF: { pt: 'K-Bot está trazendo e conferindo o PDF…', en: 'K-Bot is retrieving and checking the PDF…' },
  COMPLETED: { pt: 'K-Bot concluiu a ilustração oficial.', en: 'K-Bot completed the official illustration.' },
}

function illustrationTrailIndex(phase: string | null): number {
  if (phase === 'OPENING_FORESIGHT' || phase === 'OPENING_CASE') return 0
  if (phase === 'FILLING_CLIENT' || phase === 'CONFIGURING_PRODUCT') return 1
  if (phase === 'CALCULATING' || phase === 'VERIFYING_VALUES') return 2
  if (phase === 'SAVING_CASE' || phase === 'GENERATING_PDF') return 3
  if (phase === 'UPLOADING_PDF') return 4
  if (phase === 'COMPLETED') return 5
  return -1
}

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
  const { copy } = useI18n()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [started, setStarted] = useState(false)
  const [connectorPhase, setConnectorPhase] = useState<string | null>(null)
  const generating = pending || disabled || started

  useEffect(() => {
    if (status !== 'WORKING') return
    const timer = window.setInterval(() => router.refresh(), 5_000)
    return () => window.clearInterval(timer)
  }, [router, status])

  useEffect(() => {
    if (!extensionId || !generating) return
    let alive = true
    const refreshPhase = async () => {
      try {
        const response = await sendConnectorMessage(extensionId, { type: 'GET_CONNECTOR_STATUS' }, 2_000)
        if (alive && response.command?.phase) setConnectorPhase(response.command.phase)
      } catch {
        // Server state remains the authority; a missed local progress tick is cosmetic.
      }
    }
    void refreshPhase()
    const timer = window.setInterval(refreshPhase, 1_500)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [extensionId, generating])

  const trailIndex = illustrationTrailIndex(connectorPhase)
  const generatingLabel = connectorPhase
    ? PHASE_COPY[connectorPhase]
      ? copy(PHASE_COPY[connectorPhase].pt, PHASE_COPY[connectorPhase].en)
      : copy('K-Bot está trabalhando no Foresight…', 'K-Bot is working in Foresight…')
    : pending
      ? copy('K-Bot está iniciando…', 'K-Bot is starting…')
      : copy('K-Bot está trabalhando no Foresight…', 'K-Bot is working in Foresight…')

  if (status === 'FAILED' && [
    'FORESIGHT_PREMIUM_WRITE_MISMATCH',
    'FORESIGHT_CALCULATION_UNAVAILABLE',
    'FORESIGHT_SOLVE_READBACK_TIMEOUT',
    'FORESIGHT_SOLVE_READBACK_MISMATCH',
    'FORESIGHT_RESPONSE_INVALID',
  ].includes(safeErrorCode ?? '')) {
    return (
      <Link
        href="/agent/illustrations/new"
        className="text-teal transition-colors hover:text-teal-deep"
      >
        {copy('Revisar e criar novo cenário', 'Review and create a new scenario')}
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
              setMessage(copy('A ilustração oficial já foi gerada na National Life.', 'The official illustration has already been generated at National Life.'))
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
              ? copy('Retomando a geração oficial já registrada.', 'Resuming the official generation already on record.')
              : copy('K-Bot iniciou a ilustração oficial. Você pode sair desta página; se a sessão expirar, avisaremos para entrar novamente.', 'K-Bot started the official illustration. You can leave this page; if the session expires, we will ask you to sign in again.'))
            router.refresh()
          })
        }
        className="text-teal transition-colors hover:text-teal-deep disabled:text-ink-muted"
      >
        {generating ? <ForesightActivityIndicator label={generatingLabel} /> :
          status === 'BLOCKED' ? copy('Continuar após login', 'Continue after signing in') :
            status === 'FAILED' ? copy('Tentar novamente', 'Try again') : copy('Gerar ilustração oficial', 'Generate official illustration')}
      </button>
      {generating && trailIndex >= 0 && (
        <div className="mt-3 max-w-2xl">
          <KBotTaskTrail
            label={copy('Etapas da ilustração pelo K-Bot', 'K-Bot illustration steps')}
            currentIndex={trailIndex}
            steps={[
              copy('Abrir Foresight', 'Open Foresight'),
              copy('Preencher ilustração', 'Complete illustration'),
              copy('Calcular e conferir', 'Calculate and check'),
              copy('Salvar e criar PDF', 'Save and create PDF'),
              copy('Trazer para a Keepr One', 'Bring into Keepr One'),
            ]}
          />
        </div>
      )}
      {message && (
        <p className="mt-1 text-xs text-ink-muted" role="status" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  )
}
