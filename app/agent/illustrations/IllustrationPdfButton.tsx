'use client'

import { useState, useTransition } from 'react'
import { requestIllustrationPdf } from './actions'

/// Asks for the PDF and says what happened.
///
/// The render runs on the carrier's own tool through a queued browser job, so
/// it is not instant and the button must not pretend otherwise. It also depends
/// on a carrier session that expires — the message says so plainly rather than
/// leaving the agent to wonder why nothing arrived.
export function IllustrationPdfButton({ illustrationId }: { illustrationId: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestIllustrationPdf(illustrationId)
            setMessage(
              result.ok
                ? result.duplicate
                  ? 'Já em andamento.'
                  : 'Pedido enviado. O PDF aparece aqui quando a seguradora terminar.'
                : result.message,
            )
          })
        }
        className="text-teal transition-colors hover:text-teal-deep disabled:text-ink-muted"
      >
        {pending ? 'Pedindo…' : 'Gerar PDF'}
      </button>
      {message && <p className="mt-1 text-xs text-ink-muted">{message}</p>}
    </div>
  )
}
