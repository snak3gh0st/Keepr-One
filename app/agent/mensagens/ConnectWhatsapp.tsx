'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type State = 'idle' | 'starting' | 'waiting' | 'connected' | 'failed'

/// The agent starts this. Nothing is provisioned before they ask, because a session
/// created on their behalf is a session with no screen to scan it — which is how
/// this went wrong the first time.
export function ConnectWhatsapp() {
  const [state, setState] = useState<State>('idle')
  const [qr, setQr] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    const response = await fetch('/api/agent/messaging/whatsapp', { method: 'POST' })
    if (!response.ok) {
      setState('failed')
      return
    }
    const body = (await response.json()) as { qr: string | null; state: string }
    if (body.state === 'open') {
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
    <div className="module-panel" style={{ maxWidth: 620 }}>
      <h2 style={{ marginTop: 0 }}>Conectar meu WhatsApp</h2>
      <p>
        Suas conversas com clientes passam a aparecer aqui, no seu número de sempre.
        Você continua usando o WhatsApp normalmente no celular.
      </p>

      {/* Draft copy — the wording of this risk belongs to the product owner. What it
          must not do is soften it: the number at stake is the agent's entire book of
          contacts, and they are the one who carries the loss. */}
      <div
        style={{
          border: '1px solid rgba(255,180,80,.35)',
          background: 'rgba(255,180,80,.08)',
          borderRadius: 10,
          padding: '12px 14px',
          margin: '16px 0',
          fontSize: 14,
        }}
      >
        <strong>Antes de conectar, leia.</strong> Esta conexão usa o WhatsApp Web de
        um jeito que a Meta não autoriza oficialmente. Existe risco de o seu número
        ser bloqueado — e com ele, seus contatos e conversas. Só conecte se aceitar
        esse risco.
      </div>

      {state === 'idle' && (
        <button type="button" className="button-primary" onClick={() => { setState('starting'); void poll() }}>
          Gerar código para conectar
        </button>
      )}

      {state === 'starting' && <p>Preparando a conexão…</p>}

      {state === 'waiting' && qr && (
        <div>
          <p>
            No celular, abra o WhatsApp, toque em <strong>Aparelhos conectados</strong>{' '}
            e aponte a câmera para o código:
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="Código para conectar o WhatsApp" style={{ width: 260, height: 260 }} />
          <p style={{ fontSize: 13, opacity: 0.75 }}>O código expira em pouco tempo e é trocado sozinho.</p>
        </div>
      )}

      {state === 'failed' && (
        <p>
          Não consegui preparar a conexão agora. Tente de novo em alguns instantes.
        </p>
      )}
    </div>
  )
}
