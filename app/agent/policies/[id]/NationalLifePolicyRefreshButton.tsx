'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { refreshNationalLifePolicyDetail } from './actions'
import { useI18n } from '@/components/i18n/LanguageProvider'

type RefreshState = 'idle' | 'starting' | 'queued' | 'error'

export function NationalLifePolicyRefreshButton({
  policyId,
  extensionId,
}: {
  policyId: string
  extensionId: string
}) {
  const { copy } = useI18n()
  const [state, setState] = useState<RefreshState>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function refresh() {
    setState('starting')
    setMessage(null)
    const issued = await refreshNationalLifePolicyDetail(policyId)
    if (!issued.ok) {
      setState('error')
      setMessage(issued.message)
      return
    }
    try {
      const wake = await sendConnectorMessage(extensionId, {
        type: 'START_NATIONAL_LIFE_COMMAND',
        commandId: issued.commandId,
      })
      if (!wake.ok) throw new Error(wake.error ?? 'COMMAND_UNAVAILABLE')
      setState('queued')
      setMessage(copy('Atualização iniciada em segundo plano. Você pode sair desta página.', 'Update started in the background. You can leave this page.'))
    } catch {
      // The command is already durable on the server. Chrome's one-minute alarm
      // is the fallback when the direct wake-up channel is unavailable.
      setState('queued')
      setMessage(copy('Atualização agendada. O K-Bot continuará em segundo plano.', 'Update scheduled. K-Bot will continue in the background.'))
    }
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <Button
        type="button"
        className="min-h-9 px-3 py-1.5 text-xs"
        disabled={state === 'starting'}
        onClick={() => void refresh()}
      >
        {state === 'starting' ? copy('Iniciando…', 'Starting…') : copy('Atualizar pela National Life', 'Refresh from National Life')}
      </Button>
      {message && <p role="status" className="text-xs leading-5 text-ink-muted">{message}</p>}
    </div>
  )
}
