'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { useI18n } from '@/components/i18n/LanguageProvider'

export function ConnectOfficialWhatsapp() {
  const { copy } = useI18n()
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
        <h2 className="text-lg font-semibold text-ink">{copy('Conectar meu WhatsApp Business', 'Connect my WhatsApp Business')}</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          {copy('A conexão oficial é feita pela Meta dentro da sua conta exclusiva do Chatwoot. Seu número e suas conversas não são compartilhados com nenhum outro agente.', 'The official connection is handled by Meta inside your dedicated Chatwoot account. Your number and conversations are never shared with another agent.')}
        </p>

        <ol className="mt-5 space-y-1.5 text-sm leading-6 text-ink-muted">
          <li>{copy('1. Abra a configuração segura dentro do Keepr One', '1. Open secure setup inside Keepr One')}</li>
          <li>{copy('2. Vá em Configurações → Caixas de entrada → Adicionar caixa', '2. Go to Settings → Inboxes → Add inbox')}</li>
          <li>{copy('3. Escolha WhatsApp Cloud e conclua o acesso com a Meta', '3. Choose WhatsApp Cloud and complete access with Meta')}</li>
          <li>{copy('4. Feche a configuração e valide a conexão', '4. Close setup and validate the connection')}</li>
        </ol>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            variant="primary"
            onClick={() => void toggleSetup()}
            disabled={loadingSetup}
          >
            {loadingSetup ? copy('Abrindo…', 'Opening…') : showSetup ? copy('Fechar configuração', 'Close setup') : copy('Abrir configuração oficial', 'Open official setup')}
          </Button>
          <Button variant="secondary" onClick={() => void verify()} disabled={checking}>
            {checking ? copy('Validando…', 'Validating…') : copy('Já conectei, validar', 'I connected it, validate')}
          </Button>
        </div>

        {errorCode && (
          <p role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger-pale px-4 py-3 text-sm leading-6 text-danger">
            {errorCode === 'WHATSAPP_INBOX_NOT_CONNECTED'
              ? copy('Ainda não encontrei uma caixa WhatsApp Cloud nesta conta.', 'I still couldn’t find a WhatsApp Cloud inbox in this account.')
              : errorCode === 'MULTIPLE_WHATSAPP_INBOXES'
                ? copy('Esta conta tem mais de um número. Remova a caixa adicional para manter um único número por agente.', 'This account has more than one number. Remove the extra inbox to keep one number per agent.')
                : errorCode === 'PHONE_ALREADY_CONNECTED'
                  ? copy('Este número já pertence a outro agente no Keepr One.', 'This number already belongs to another Keepr One agent.')
                  : errorCode === 'WHATSAPP_PHONE_NOT_VERIFIED'
                    ? copy('A Meta ainda não devolveu um telefone verificado para esta caixa.', 'Meta has not returned a verified phone number for this inbox yet.')
                    : copy('Não consegui validar a caixa oficial agora. Tente novamente em alguns instantes.', 'I couldn’t validate the official inbox right now. Please try again in a moment.')}
          </p>
        )}

        {showSetup && setupUrl && (
          <div className="mt-6 overflow-hidden rounded-2xl border border-border-steel bg-paper">
            <div className="border-b border-border-steel bg-panel px-4 py-3 text-xs font-medium text-ink-muted">
              {copy('Ambiente seguro de conexão · exibido dentro do Keepr One', 'Secure connection environment · displayed inside Keepr One')}
            </div>
            <iframe
              src={setupUrl}
              title={copy('Configuração oficial do WhatsApp', 'Official WhatsApp setup')}
              className="h-[min(68vh,720px)] w-full border-0"
              allow="clipboard-write; camera; microphone"
            />
          </div>
        )}
      </div>
    </div>
  )
}
