'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'

export function ConnectOfficialWhatsapp({ setupUrl }: { setupUrl: string }) {
  const [checking, setChecking] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  async function verify() {
    setChecking(true)
    setErrorCode(null)
    const response = await fetch('/api/agent/messaging/whatsapp-cloud', { method: 'POST' })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (response.ok) {
      window.location.reload()
      return
    }
    setErrorCode(body.error ?? 'VERIFY_FAILED')
    setChecking(false)
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="keepr-card rounded-2xl p-8">
        <h2 className="text-lg font-semibold text-ink">Conectar meu WhatsApp Business</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          A conexão oficial é feita pela Meta dentro da sua conta exclusiva do Chatwoot.
          Seu número e suas conversas não são compartilhados com nenhum outro agente.
        </p>

        <ol className="mt-5 space-y-1.5 text-sm leading-6 text-ink-muted">
          <li>1. Abra a configuração segura em uma nova aba</li>
          <li>2. Vá em Configurações → Caixas de entrada → Adicionar caixa</li>
          <li>3. Escolha WhatsApp Cloud e conclua o acesso com a Meta</li>
          <li>4. Volte aqui e valide a conexão</li>
        </ol>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href={setupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-rail-strong px-4 py-2 text-sm font-medium text-paper"
          >
            Abrir configuração oficial
          </a>
          <Button variant="secondary" onClick={() => void verify()} disabled={checking}>
            {checking ? 'Validando…' : 'Já conectei, validar'}
          </Button>
        </div>

        {errorCode && (
          <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger">
            {errorCode === 'WHATSAPP_INBOX_NOT_CONNECTED'
              ? 'Ainda não encontrei uma caixa WhatsApp Cloud nesta conta.'
              : errorCode === 'MULTIPLE_WHATSAPP_INBOXES'
                ? 'Esta conta tem mais de um número. Remova a caixa adicional para manter um único número por agente.'
                : errorCode === 'PHONE_ALREADY_CONNECTED'
                  ? 'Este número já pertence a outro agente no Keepr One.'
                  : errorCode === 'WHATSAPP_PHONE_NOT_VERIFIED'
                    ? 'A Meta ainda não devolveu um telefone verificado para esta caixa.'
                    : 'Não consegui validar a caixa oficial agora. Tente novamente em alguns instantes.'}
          </p>
        )}
      </div>
    </div>
  )
}
