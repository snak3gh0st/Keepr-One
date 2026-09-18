'use client'

import { useState, useTransition } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { inviteLeadAccessAction } from './actions'
import styles from './marketing.module.css'

export function LeadAccessInvite({ leadId }: { leadId: string }) {
  const { copy } = useI18n()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  function invite() {
    const formData = new FormData()
    formData.set('leadId', leadId)
    setMessage(null)
    startTransition(async () => {
      try {
        const result = await inviteLeadAccessAction(formData)
        if (!result.ok) {
          setMessage({ ok: false, text: result.message })
          return
        }
        setMessage({
          ok: result.delivery === 'SENT',
          text: result.delivery === 'SENT'
            ? result.accountCreated
              ? copy('Acesso criado e convite enviado por e-mail.', 'Access created and invitation emailed.')
              : copy('Convite reenviado por e-mail.', 'Invitation resent by email.')
            : copy('Acesso preparado, mas o e-mail não pôde ser enviado. Reenvie quando o serviço estiver disponível.', 'Access is ready, but the email could not be sent. Resend when the service is available.'),
        })
      } catch {
        setMessage({ ok: false, text: copy('Não foi possível enviar o convite agora.', 'We could not send the invitation right now.') })
      }
    })
  }

  return (
    <div className="mt-6 rounded-xl border border-teal/25 bg-teal-pale/35 p-4">
      <div>
        <p className="text-sm font-semibold text-ink">{copy('Acesso à Keepr One', 'Keepr One access')}</p>
        <p className="mt-1 text-sm leading-5 text-ink-muted">
          {copy('Cria ou localiza o acesso de agente e envia o convite para definir a senha.', 'Create or find the agent access and send an invitation to set a password.')}
        </p>
      </div>
      <button
        type="button"
        onClick={invite}
        disabled={pending}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-teal px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-deep disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-teal-pale"
      >
        {pending ? copy('Enviando…', 'Sending…') : copy('Enviar convite de acesso', 'Send access invitation')}
      </button>
      {message && <p className={message.ok ? `${styles.success} mt-3` : `${styles.error} mt-3`} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    </div>
  )
}
