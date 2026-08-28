'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'

type FetchState = 'idle' | 'fetching' | 'auth-required' | 'error'

function documentErrorMessage(code: string | undefined): string {
  if (code === 'AUTH_REQUIRED') {
    return 'Entre na National Life na aba que foi aberta e tente novamente.'
  }
  if (code === 'CONNECTOR_NOT_PAIRED') {
    return 'Conecte o K-Bot antes de buscar este documento.'
  }
  if (code === 'SYNC_IN_PROGRESS' || code === 'DOCUMENT_FETCH_IN_PROGRESS') {
    return 'O conector está ocupado. Aguarde a operação atual e tente novamente.'
  }
  if (code === 'CLIENT_TOO_OLD' || code === 'INVALID_MESSAGE') {
    return 'Atualize e recarregue o K-Bot para buscar documentos.'
  }
  if (code === 'CONNECTOR_PAUSED') {
    return 'A busca de documentos está pausada temporariamente.'
  }
  if (code === 'BRIDGE_UNAVAILABLE') {
    return 'Recarregue a aba da National Life e tente trazer o documento novamente.'
  }
  if (code === 'PORTAL_REQUEST_FAILED') {
    return 'A National Life não conseguiu entregar este documento agora. Tente novamente.'
  }
  if (code === 'INVALID_DOCUMENT_RESPONSE') {
    return 'A National Life devolveu um arquivo inesperado. Tente novamente mais tarde.'
  }
  return 'Não foi possível trazer o documento agora. Tente novamente.'
}

export function NationalLifeDocumentButton({
  extensionId,
  reportRowId,
}: {
  extensionId: string
  reportRowId: string
}) {
  const router = useRouter()
  const [state, setState] = useState<FetchState>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function fetchDocument() {
    setState('fetching')
    setMessage(null)
    try {
      const result = await sendConnectorMessage(
        extensionId,
        { type: 'FETCH_NATIONAL_LIFE_DOCUMENT', reportRowId },
        190_000,
      )
      if (!result.ok) {
        setState(result.error === 'AUTH_REQUIRED' ? 'auth-required' : 'error')
        setMessage(documentErrorMessage(result.error))
        return
      }
      setState('idle')
      router.refresh()
    } catch (error) {
      const code = error instanceof Error ? error.message : undefined
      setState('error')
      setMessage(documentErrorMessage(code))
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <Button
        type="button"
        className="min-h-9 px-3 py-1.5 text-xs"
        disabled={state === 'fetching'}
        onClick={() => void fetchDocument()}
      >
        {state === 'fetching' ? 'Trazendo…' : state === 'auth-required' ? 'Tentar após entrar' : 'Trazer para o Keepr One'}
      </Button>
      {message && (
        <p role="status" className="max-w-xs text-xs leading-5 text-ink-muted sm:text-right">
          {message}
        </p>
      )}
    </div>
  )
}
