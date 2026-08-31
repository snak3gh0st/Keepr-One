'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'

type State = 'idle' | 'starting' | 'waiting' | 'connected' | 'failed'

/// The agent starts this. Nothing is provisioned before they ask, because a session
/// created on their behalf is a session with no screen to scan it — which is how
/// this went wrong the first time.
export function ConnectWhatsapp() {
  const { copy } = useI18n()
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
            <h2 className="text-lg font-semibold text-ink">{copy('Conectar meu WhatsApp', 'Connect my WhatsApp')}</h2>
            <p className="mt-1.5 text-sm leading-6 text-ink-muted">
              {copy('Suas conversas com clientes passam a aparecer aqui, no seu número de sempre. Você continua usando o WhatsApp normalmente no celular.', 'Your client conversations will appear here using your existing number. You can keep using WhatsApp normally on your phone.')}
            </p>
          </div>
        </div>

        {/* Draft copy — the wording of this risk belongs to the product owner. What it
            must not do is soften it: the number at stake is the agent's entire book of
            contacts, and they are the one who carries the loss. */}
        <p className="mt-6 rounded-xl border border-danger/20 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger">
          <strong className="font-semibold">{copy('Antes de conectar, leia.', 'Read this before connecting.')}</strong>{' '}
          {copy('Esta conexão usa o WhatsApp Web de um jeito que a Meta não autoriza oficialmente. Existe risco de o seu número ser bloqueado — e com ele, seus contatos e conversas. Só conecte se aceitar esse risco.', 'This connection uses WhatsApp Web in a way that Meta does not officially authorize. Your number may be blocked, along with access to your contacts and conversations. Connect only if you accept this risk.')}
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
            {copy('Gerar código para conectar', 'Generate connection code')}
          </Button>
        )}

        {state === 'starting' && (
          <p className="mt-6 flex items-center gap-2.5 text-sm text-ink-muted">
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-border-steel border-t-rail-strong"
            />
            {copy('Preparando a conexão…', 'Preparing connection…')}
          </p>
        )}

        {state === 'waiting' && qr && (
          <div className="mt-6">
            <ol className="space-y-1.5 text-sm leading-6 text-ink-muted">
              <li>{copy('1. Abra o WhatsApp no celular', '1. Open WhatsApp on your phone')}</li>
              <li>
                {copy('2. Toque em', '2. Tap')} <span className="font-medium text-ink">{copy('Aparelhos conectados', 'Linked devices')}</span>
              </li>
              <li>{copy('3. Aponte a câmera para o código abaixo', '3. Point the camera at the code below')}</li>
            </ol>
            <div className="mt-5 flex justify-center rounded-xl border border-border-steel bg-paper p-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={copy('Código para conectar o WhatsApp', 'Code to connect WhatsApp')} className="size-56" />
            </div>
            <p className="mt-3 text-center text-xs text-ink-muted">
              {copy('O código expira em pouco tempo e é trocado sozinho.', 'The code expires shortly and refreshes automatically.')}
            </p>
          </div>
        )}

        {state === 'failed' && (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-danger/20 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger"
          >
            {errorCode === 'PHONE_ALREADY_CONNECTED'
              ? copy('Este número já pertence a outra conta Keepr One. Desconecte-o da conta anterior antes de tentar novamente.', 'This number already belongs to another Keepr One account. Disconnect it from the previous account before trying again.')
              : errorCode === 'CHATWOOT_ACCOUNT_NOT_READY'
                ? copy('Sua caixa de mensagens ainda não ficou pronta. Tente novamente em alguns instantes.', 'Your inbox is not ready yet. Please try again in a moment.')
                : copy('Não consegui validar a conexão completa entre WhatsApp e caixa de mensagens. Tente novamente em alguns instantes.', 'I couldn’t validate the full connection between WhatsApp and the inbox. Please try again in a moment.')}
          </p>
        )}
      </div>
    </div>
  )
}
