'use client'

import { useState } from 'react'
import type { ForesightReadStatus } from '@/lib/national-life/foresight-run-service'

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
            ? 'PDF requested. It will be ready shortly.'
            : 'Read requested. It will be ready shortly.'
          : body.message ?? 'We could not start that request. Try again in a moment.',
      )
    } catch {
      setMessage('We could not start that request right now. Try again in a moment.')
    } finally {
      setBusy(null)
    }
  }

  if (cases.length === 0) {
    return <p className="border border-white/10 px-4 py-6 text-sm text-paper/60">No Foresight cases yet. Reading is view-only and never changes anything at the carrier.</p>
  }

  return (
    <div>
      {run?.shouldPoll && <p className="mb-4 text-sm text-paper/60">Foresight is updating your cases.</p>}
      {message && <p role="status" className="mb-4 text-sm font-semibold text-teal">{message}</p>}
      <div className="space-y-3">
        {cases.map((item) => (
          <article key={item.id} className="border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-paper">{item.displayName}</h3>
                <p className="mt-1 text-sm text-paper/60">{item.product ?? item.caseKind ?? 'Product not listed'}</p>
              </div>
              <span className="text-xs uppercase tracking-[0.08em] text-paper/45">{item.status ?? item.state ?? 'Seen'}</span>
            </div>
            <p className="mt-3 text-xs text-paper/50">{item.serviceCount} service records · {new Date(item.observedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void action(item.id, 'DETAIL')} className="border border-teal px-3 py-2 text-sm font-semibold text-teal hover:bg-teal/10 disabled:opacity-50">{busy === `${item.id}:DETAIL` ? 'Starting…' : 'Read data'}</button>
              <button type="button" disabled={busy !== null} onClick={() => void action(item.id, 'PDF')} className="border border-white/15 px-3 py-2 text-sm font-semibold text-paper hover:bg-white/[0.06] disabled:opacity-50">{busy === `${item.id}:PDF` ? 'Starting…' : 'Create PDF'}</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
