'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { requestIllustrationPdf } from './actions'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { ForesightActivityIndicator } from './ForesightActivityIndicator'
import { KBotTaskTrail } from '@/components/kbot/KBotAvatar'

const PHASE_COPY: Record<string, string> = {
  OPENING_FORESIGHT: 'K-Bot está abrindo o Foresight…',
  OPENING_CASE: 'K-Bot está abrindo um novo caso…',
  FILLING_CLIENT: 'K-Bot está preenchendo os dados do cliente…',
  CONFIGURING_PRODUCT: 'K-Bot está preenchendo o produto e os valores…',
  CALCULATING: 'K-Bot está esperando o cálculo da National Life…',
  VERIFYING_VALUES: 'K-Bot está conferindo os valores da National Life…',
  SAVING_CASE: 'K-Bot está salvando a ilustração…',
  GENERATING_PDF: 'K-Bot está criando o PDF oficial…',
  UPLOADING_PDF: 'K-Bot está trazendo e conferindo o PDF…',
  COMPLETED: 'K-Bot concluiu a ilustração oficial.',
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
  status?: 'WORKING' | 'WAITING_FOR_KBOT' | 'BLOCKED' | 'FAILED'
  safeErrorCode?: string | null
}) {
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
    ? PHASE_COPY[connectorPhase] ?? 'K-Bot está trabalhando no Foresight…'
    : pending
      ? 'K-Bot está iniciando…'
      : 'K-Bot está trabalhando no Foresight…'

  if (status === 'WAITING_FOR_KBOT') {
    return (
      <Link
        href="/agent/integrations/national-life"
        className="text-teal transition-colors hover:text-teal-deep"
      >
        Conectar K-Bot para continuar
      </Link>
    )
  }

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
            setMessage(result.retryingLogin
              ? 'K-Bot vai tentar a credencial protegida uma vez. Se a National Life pedir MFA, conclua a verificação para continuar.'
              : result.duplicate
                ? 'Retomando a geração oficial já registrada.'
                : 'K-Bot iniciou a ilustração oficial. Você pode sair desta página; se a sessão expirar, avisaremos para entrar novamente.')
            router.refresh()
          })
        }
        className="text-teal transition-colors hover:text-teal-deep disabled:text-ink-muted"
      >
        {generating ? <ForesightActivityIndicator label={generatingLabel} /> :
          status === 'BLOCKED' ? 'Tentar login novamente' :
            status === 'FAILED' ? 'Tentar novamente' : 'Gerar ilustração oficial'}
      </button>
      {generating && trailIndex >= 0 && (
        <div className="mt-3 max-w-2xl">
          <KBotTaskTrail
            label="Etapas da ilustração pelo K-Bot"
            currentIndex={trailIndex}
            steps={['Abrir Foresight', 'Preencher ilustração', 'Calcular e conferir', 'Salvar e criar PDF', 'Trazer para o Keepr One']}
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
