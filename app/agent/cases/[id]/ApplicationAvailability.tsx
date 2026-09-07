'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '@/components/i18n/LanguageProvider'
import { sendConnectorMessage, type ConnectorResponse } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'

type Availability = { state: 'CHECKING' | 'PAUSED' | 'DISCONNECTED' | 'UNVERIFIED' | 'UNSUPPORTED' | 'READY'; version?: string }

export function applicationAvailability(response: ConnectorResponse): Availability {
  const version = response.extensionVersion
  if (!response.ok || response.device?.status !== 'READY') return { state: 'DISCONNECTED', version }
  if (!Array.isArray(response.commandCapabilities)) return { state: 'UNVERIFIED', version }
  return { state: response.commandCapabilities.includes('PREPARE_APPLICATION_DRAFT') ? 'READY' : 'UNSUPPORTED', version }
}

export function useApplicationAvailability(extensionTarget: string | null | undefined, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<Availability>({ state: 'CHECKING' })
  const sequence = useRef({ id: 0 })
  const refresh = useCallback((): Promise<void> => {
    const requests = sequence.current
    const request = ++requests.id
    if (!enabled || !extensionTarget) return Promise.resolve()
    return sendConnectorMessage(extensionTarget, { type: 'GET_CONNECTOR_STATUS' }).then(
      response => { if (request === requests.id) setSnapshot(applicationAvailability(response)) },
      () => { if (request === requests.id) setSnapshot({ state: 'DISCONNECTED' }) },
    )
  }, [enabled, extensionTarget])
  useEffect(() => {
    const requests = sequence.current
    void refresh()
    window.addEventListener('focus', refresh)
    return () => { requests.id++; window.removeEventListener('focus', refresh) }
  }, [refresh])
  return { ...(enabled && extensionTarget ? snapshot : { state: 'PAUSED' as const }), refresh }
}

export function ApplicationAvailability({ availability }: { availability: Availability & { refresh: () => Promise<void> } }) {
  const { copy } = useI18n()
  const labels: Record<Availability['state'], string> = {
    CHECKING: copy('Verificando este navegador…', 'Checking this browser…'),
    PAUSED: copy('Preparação indisponível no momento', 'Preparation currently unavailable'),
    DISCONNECTED: copy('Conecte a extensão neste navegador', 'Connect the extension in this browser'),
    UNVERIFIED: copy('Compatibilidade não confirmada. Atualize a extensão e verifique novamente.', 'Compatibility unconfirmed. Update the extension and check again.'),
    UNSUPPORTED: copy('Esta extensão não oferece preparação no iGO. Atualize e verifique novamente.', 'This extension does not support iGO preparation. Update it and check again.'),
    READY: copy('Extensão compatível · requer add-on, revisão e login no iGO', 'Compatible extension · requires add-on, review and iGO sign-in'),
  }
  return <section aria-label={copy('Disponibilidade das etapas', 'Stage availability')} className="rounded-xl border border-border-steel bg-panel/50 p-4 text-sm">
    <h4 className="font-semibold text-ink">{copy('O que você pode fazer agora', 'What you can do now')}</h4>
    <ul className="mt-2 space-y-2 text-ink-muted">
      <li>{copy('Organizar dados e documentos na KeeprOne: disponível.', 'Organize data and documents in KeeprOne: available.')}</li>
      <li role="status">{copy('Preparar rascunho no iGO:', 'Prepare draft in iGO:')} {labels[availability.state]}</li>
      <li>{copy('Anexar documentos no iGO: ainda não disponível.', 'Attach documents in iGO: not available yet.')}</li>
      <li>{copy('Submeter à National Life pelo K-Bot: ainda não disponível.', 'Submit to National Life through K-Bot: not available yet.')}</li>
    </ul>
    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
      {availability.version && <span>{copy('Extensão', 'Extension')} {availability.version}</span>}
      <Link className="underline" href="/agent/integrations/national-life">{copy('Ver conexão', 'View connection')}</Link>
      {availability.state !== 'PAUSED' && <button type="button" disabled={availability.state === 'CHECKING'} onClick={() => void availability.refresh()} className="min-h-11 underline disabled:opacity-50">{copy('Verificar novamente', 'Check again')}</button>}
    </div>
  </section>
}
