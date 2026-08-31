'use client'

import { useState } from 'react'
import type { ForesightReadStatus } from '@/lib/national-life/foresight-run-service'
import { useI18n } from '@/components/i18n/LanguageProvider'

export type ForesightCaseRow = {
  id: string
  displayName: string
  caseKind: string | null
  product: string | null
  status: string | null
  state: string | null
  observedAt: Date | string
  serviceCount: number
}

export function ForesightCaseTabs({
  cases,
  run,
}: {
  cases: ForesightCaseRow[]
  run: ForesightReadStatus | null
}) {
  const { copy, locale } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const action = async (caseId: string, kind: 'DETAIL' | 'PDF') => {
    setBusy(`${caseId}:${kind}`)
    setMessage(null)
    try {
      const response = await fetch(`/api/agent/integrations/national-life/foresight/${caseId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: kind }),
      })
      const body = (await response.json()) as { ok?: boolean; message?: string }
      setMessage(
        body.ok
          ? kind === 'PDF'
            ? copy('PDF solicitado. Ele ficará pronto em breve.', 'PDF requested. It will be ready shortly.')
            : copy('Leitura solicitada. Ela ficará pronta em breve.', 'Read requested. It will be ready shortly.')
          : body.message ?? copy('Não foi possível iniciar essa solicitação. Tente novamente em instantes.', 'We could not start that request. Try again in a moment.'),
      )
    } catch {
      setMessage(copy('Não foi possível iniciar essa solicitação agora. Tente novamente em instantes.', 'We could not start that request right now. Try again in a moment.'))
    } finally {
      setBusy(null)
    }
  }

  if (cases.length === 0) {
    return <p className="border border-border-steel px-4 py-6 text-sm text-ink-muted">{copy('Ainda não há casos do Foresight. A leitura é somente para consulta e nunca altera nada na seguradora.', 'No Foresight cases yet. Reading is view-only and never changes anything at the carrier.')}</p>
  }

  return (
    <div>
      {run?.shouldPoll && <p className="mb-4 text-sm text-ink-muted">{copy('O Foresight está atualizando seus casos.', 'Foresight is updating your cases.')}</p>}
      {message && <p role="status" className="mb-4 text-sm font-semibold text-teal">{message}</p>}
      <div className="space-y-3">
        {cases.map((item) => (
          <article key={item.id} className="rounded-xl border border-border-steel bg-panel/55 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-ink">{item.displayName}</h3>
                <p className="mt-1 text-sm text-ink-muted">{item.product ?? item.caseKind ?? copy('Produto não informado', 'Product not listed')}</p>
              </div>
              <span className="text-xs uppercase tracking-[0.08em] text-ink-muted">{item.status ?? item.state ?? copy('Visto', 'Seen')}</span>
            </div>
            <p className="mt-3 text-xs text-ink-muted">{item.serviceCount} {copy('registros de serviço', 'service records')} · {new Date(item.observedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void action(item.id, 'DETAIL')} className="border border-teal px-3 py-2 text-sm font-semibold text-teal hover:bg-teal/10 disabled:opacity-50">{busy === `${item.id}:DETAIL` ? copy('Iniciando…', 'Starting…') : copy('Ler dados', 'Read data')}</button>
              <button type="button" disabled={busy !== null} onClick={() => void action(item.id, 'PDF')} className="rounded-lg border border-border-steel px-3 py-2 text-sm font-semibold text-ink hover:bg-paper disabled:opacity-50">{busy === `${item.id}:PDF` ? copy('Iniciando…', 'Starting…') : copy('Criar PDF', 'Create PDF')}</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
