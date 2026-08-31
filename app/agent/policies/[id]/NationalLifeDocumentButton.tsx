'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { sendConnectorMessage } from '@/app/agent/integrations/national-life/NationalLifeConnectorClient'
import { useI18n } from '@/components/i18n/LanguageProvider'

type FetchState = 'idle' | 'fetching' | 'auth-required' | 'error'

function documentErrorMessage(code: string | undefined, copy: (pt: string, en: string) => string): string {
  if (code === 'AUTH_REQUIRED') {
    return copy('Entre na National Life na aba que foi aberta e tente novamente.', 'Sign in to National Life in the tab that opened, then try again.')
  }
  if (code === 'CONNECTOR_NOT_PAIRED') {
    return copy('Conecte o K-Bot antes de buscar este documento.', 'Connect K-Bot before retrieving this document.')
  }
  if (code === 'SYNC_IN_PROGRESS' || code === 'DOCUMENT_FETCH_IN_PROGRESS') {
    return copy('O conector está ocupado. Aguarde a operação atual e tente novamente.', 'The connector is busy. Wait for the current operation and try again.')
  }
  if (code === 'CLIENT_TOO_OLD' || code === 'INVALID_MESSAGE') {
    return copy('Atualize e recarregue o K-Bot para buscar documentos.', 'Update and reload K-Bot to retrieve documents.')
  }
  if (code === 'CONNECTOR_PAUSED') {
    return copy('A busca de documentos está pausada temporariamente.', 'Document retrieval is temporarily paused.')
  }
  if (code === 'BRIDGE_UNAVAILABLE') {
    return copy('Recarregue a aba da National Life e tente trazer o documento novamente.', 'Reload the National Life tab and try retrieving the document again.')
  }
  if (code === 'PORTAL_REQUEST_FAILED') {
    return copy('A National Life não conseguiu entregar este documento agora. Tente novamente.', 'National Life could not provide this document right now. Try again.')
  }
  if (code === 'INVALID_DOCUMENT_RESPONSE') {
    return copy('A National Life devolveu um arquivo inesperado. Tente novamente mais tarde.', 'National Life returned an unexpected file. Try again later.')
  }
  return copy('Não foi possível trazer o documento agora. Tente novamente.', 'Could not retrieve the document right now. Try again.')
}

export function NationalLifeDocumentButton({
  extensionId,
  reportRowId,
}: {
  extensionId: string
  reportRowId: string
}) {
  const { copy } = useI18n()
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
        setMessage(documentErrorMessage(result.error, copy))
        return
      }
      setState('idle')
      router.refresh()
    } catch (error) {
      const code = error instanceof Error ? error.message : undefined
      setState('error')
      setMessage(documentErrorMessage(code, copy))
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
        {state === 'fetching'
          ? copy('Trazendo…', 'Retrieving…')
          : state === 'auth-required'
            ? copy('Tentar após entrar', 'Try after signing in')
            : copy('Trazer para a Keepr One', 'Bring into Keepr One')}
      </Button>
      {message && (
        <p role="status" className="max-w-xs text-xs leading-5 text-ink-muted sm:text-right">
          {message}
        </p>
      )}
    </div>
  )
}
