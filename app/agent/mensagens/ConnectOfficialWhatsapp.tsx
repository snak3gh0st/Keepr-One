'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'

export function ConnectOfficialWhatsapp() {
  const [checking, setChecking] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [setupUrl, setSetupUrl] = useState<string | null>(null)
  const [loadingSetup, setLoadingSetup] = useState(false)
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

  async function toggleSetup() {
    if (showSetup) {
      setShowSetup(false)
      return
    }
    if (!setupUrl) {
      setLoadingSetup(true)
      const response = await fetch('/api/agent/messaging/setup-session', { method: 'POST' })
      const body = await response.json().catch(() => ({})) as { url?: string }
      setLoadingSetup(false)
      if (!response.ok || !body.url) {
        setErrorCode('SETUP_SESSION_FAILED')
        return
      }
      setSetupUrl(body.url)
    }
    setShowSetup(true)
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
          <li>1. Abra a configuração segura dentro do Keepr One</li>
          <li>2. Vá em Configurações → Caixas de entrada → Adicionar caixa</li>
          <li>3. Escolha WhatsApp Cloud e conclua o acesso com a Meta</li>
          <li>4. Feche a configuração e valide a conexão</li>
        </ol>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            onClick={() => void toggleSetup()}
            disabled={loadingSetup}
          >
            {loadingSetup ? 'Abrindo…' : showSetup ? 'Fechar configuração' : 'Abrir configuração oficial'}
          </Button>
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

        {showSetup && setupUrl && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border-steel bg-paper">
            <div className="border-b border-border-steel bg-panel px-4 py-3 text-xs font-medium text-ink-muted">
              Ambiente seguro de conexão · exibido dentro do Keepr One
            </div>
            <iframe
              src={setupUrl}
              title="Configuração oficial do WhatsApp"
              className="h-[min(68vh,720px)] w-full border-0"
              allow="clipboard-write; camera; microphone"
            />
          </div>
        )}
      </div>
    </div>
  )
}
