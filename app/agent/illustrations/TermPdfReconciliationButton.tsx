'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reconcileTermIllustrationPdf } from './actions'

/// Re-runs only the deterministic PDF read-back already stored in Keepr One.
/// It neither starts a new Foresight case nor writes to the carrier.
export function TermPdfReconciliationButton({ illustrationId }: { illustrationId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(async () => {
          const result = await reconcileTermIllustrationPdf(illustrationId)
          setMessage(result.message)
          if (result.ok) router.refresh()
        })}
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-teal px-5 py-2.5 text-sm font-semibold text-paper transition-colors hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Conferindo PDF Term…' : 'Conferir PDF Term'}
      </button>
      {message ? (
        <p role={message.startsWith('Prêmios') ? 'status' : 'alert'} className="mt-2 max-w-xs text-xs leading-5 text-ink-muted">
          {message}
        </p>
      ) : null}
    </div>
  )
}
