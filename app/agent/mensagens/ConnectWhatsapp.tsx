'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button'

type State = 'idle' | 'starting' | 'waiting' | 'connected' | 'failed'

/// The agent starts this. Nothing is provisioned before they ask, because a session
/// created on their behalf is a session with no screen to scan it — which is how
/// this went wrong the first time.
export function ConnectWhatsapp() {
  const [state, setState] = useState<State>('idle')
  const [qr, setQr] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    const response = await fetch('/api/agent/messaging/whatsapp', { method: 'POST' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string }
      setErrorCode(body.error ?? 'CONNECT_FAILED')
      setState('failed')
      return
    }
    const body = (await response.json()) as {
      qr: string | null
      state: string
      status: string
    }
    if (body.state === 'open' && body.status === 'CONNECTED') {
      setState('connected')
      window.location.reload()
      return
    }
    setQr(body.qr)
    // The provider answers without a code while the session is still starting, so
    // an absent QR means "not yet", never "broken".
    setState(body.qr ? 'waiting' : 'starting')
  }, [])

  useEffect(() => {
    if (state === 'idle' || state === 'connected' || state === 'failed') return
    timer.current = setInterval(poll, 4000)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [state, poll])

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="keepr-card rounded-2xl p-8">
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-rail-strong text-paper"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-5">
              <path d="M20 12a7 7 0 0 1-7 7H8l-4 3v-5.2A7 7 0 0 1 4 12a7 7 0 0 1 7-7h2a7 7 0 0 1 7 7Z" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">Conectar meu WhatsApp</h2>
            <p className="mt-1.5 text-sm leading-6 text-ink-muted">
              Suas conversas com clientes passam a aparecer aqui, no seu número de sempre.
              Você continua usando o WhatsApp normalmente no celular.
            </p>
          </div>
        </div>

        {/* Draft copy — the wording of this risk belongs to the product owner. What it
            must not do is soften it: the number at stake is the agent's entire book of
            contacts, and they are the one who carries the loss. */}
        <p className="mt-6 rounded-xl border border-danger/20 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger">
          <strong className="font-semibold">Antes de conectar, leia.</strong> Esta conexão usa
          o WhatsApp Web de um jeito que a Meta não autoriza oficialmente. Existe risco de o
          seu número ser bloqueado — e com ele, seus contatos e conversas. Só conecte se
          aceitar esse risco.
        </p>

        {state === 'idle' && (
          <Button
            variant="primary"
            className="mt-6 w-full sm:w-auto"
            onClick={() => {
              setState('starting')
              setErrorCode(null)
              void poll()
            }}
          >
            Gerar código para conectar
          </Button>
        )}

        {state === 'starting' && (
          <p className="mt-6 flex items-center gap-2.5 text-sm text-ink-muted">
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-border-steel border-t-rail-strong"
            />
            Preparando a conexão…
          </p>
        )}

        {state === 'waiting' && qr && (
          <div className="mt-6">
            <ol className="space-y-1.5 text-sm leading-6 text-ink-muted">
              <li>1. Abra o WhatsApp no celular</li>
              <li>
                2. Toque em <span className="font-medium text-ink">Aparelhos conectados</span>
              </li>
              <li>3. Aponte a câmera para o código abaixo</li>
            </ol>
            <div className="mt-5 flex justify-center rounded-xl border border-border-steel bg-paper p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="Código para conectar o WhatsApp" className="size-56" />
            </div>
            <p className="mt-3 text-center text-xs text-ink-muted">
              O código expira em pouco tempo e é trocado sozinho.
            </p>
          </div>
        )}

        {state === 'failed' && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-danger/20 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger"
          >
            {errorCode === 'PHONE_ALREADY_CONNECTED'
              ? 'Este número já pertence a outra conta Keepr One. Desconecte-o da conta anterior antes de tentar novamente.'
              : errorCode === 'CHATWOOT_ACCOUNT_NOT_READY'
                ? 'Sua caixa de mensagens ainda não ficou pronta. Tente novamente em alguns instantes.'
                : 'Não consegui validar a conexão completa entre WhatsApp e caixa de mensagens. Tente novamente em alguns instantes.'}
          </p>
        )}
      </div>
    </div>
  )
}
