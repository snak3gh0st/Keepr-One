'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { refreshNationalLifePolicyDetail } from './actions'

type RefreshState = 'idle' | 'starting' | 'queued' | 'error'

export function NationalLifePolicyRefreshButton({
  policyId,
  extensionId,
}: {
  policyId: string
  extensionId: string
}) {
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
      setMessage('Atualização iniciada em segundo plano. Você pode sair desta página.')
    } catch {
      // The command is already durable on the server. Chrome's one-minute alarm
      // is the fallback when the direct wake-up channel is unavailable.
      setState('queued')
      setMessage('Atualização agendada. O KeeproneConnect continuará em segundo plano.')
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
        {state === 'starting' ? 'Iniciando…' : 'Atualizar da National Life'}
      </Button>
      {message && <p role="status" className="text-xs leading-5 text-ink-muted">{message}</p>}
    </div>
  )
}
