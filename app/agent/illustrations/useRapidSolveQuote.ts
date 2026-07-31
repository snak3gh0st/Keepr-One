"use client";

import { useEffect, useState } from 'react'

/// Mirrors `RapidSolveQuoteStatus` on the server. The three cases are kept
/// apart here for the same reason they are kept apart there: a carrier refusal
/// is an answer with a sentence in it, and "no answer arrived" is not a quote
/// of zero.
export type QuoteStatus =
  | { state: 'PENDING' }
  | {
      state: 'ANSWERED'
      quote:
        | {
            ok: true
            faceAmount: number
            annualPremium: number
            monthlyPremium: number
            /// Mirrors `LapseYear` in `lib/national-life/rapid-solve.ts`: a
            /// number is a real projected year, 'NEVER' is the carrier's
            /// confirmed "does not lapse", and null is "not known" — the
            /// three must never collapse into each other on this screen
            /// either.
            lapseYear: number | 'NEVER' | null
          }
        | { ok: false; message: string }
    }
  | { state: 'UNAVAILABLE'; safeErrorCode: string }

const POLL_INTERVAL_MS = 2_000

// A quote waits on a browser that may be held by a sync, and the lock waits up
// to five minutes before giving the job back to the queue. Stopping earlier
// than that would report a timeout for work still on its way.
const GIVE_UP_AFTER_MS = 6 * 60_000

export function useRapidSolveQuote(jobId: string | null) {
  const [status, setStatus] = useState<QuoteStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [polledJobId, setPolledJobId] = useState(jobId)

  // Adjusted during render rather than in an effect, so a new quote never shows
  // the previous quote's numbers for the frame before the first poll returns.
  if (jobId !== polledJobId) {
    setPolledJobId(jobId)
    setStatus(null)
    setError(null)
  }

  useEffect(() => {
    if (!jobId) {
      return
    }

    const abortController = new AbortController()
    const startedAt = Date.now()
    let stopped = false

    async function poll() {
      try {
        const response = await fetch(
          `/api/agent/integrations/national-life/quote/${encodeURIComponent(jobId!)}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: abortController.signal,
          },
        )

        if (!response.ok) {
          throw new Error('QUOTE_STATUS_UNAVAILABLE')
        }

        const next = (await response.json()) as QuoteStatus
        setStatus(next)

        if (next.state !== 'PENDING') {
          stopped = true
          return
        }

        if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
          stopped = true
          // Deliberately not phrased as a failed quote. The job may still be
          // queued behind another carrier browser; what ran out is this
          // screen's patience, not the request.
          setError(
            'A seguradora ainda não respondeu. A cotação continua na fila — recarregue em alguns minutos.',
          )
        }
      } catch (pollError) {
        if (abortController.signal.aborted) {
          return
        }
        stopped = true
        setError(
          pollError instanceof Error && pollError.message !== 'QUOTE_STATUS_UNAVAILABLE'
            ? pollError.message
            : 'Não foi possível acompanhar esta cotação.',
        )
      }
    }

    void poll()
    const interval = window.setInterval(() => {
      if (!stopped) {
        void poll()
      }
    }, POLL_INTERVAL_MS)

    return () => {
      stopped = true
      abortController.abort()
      window.clearInterval(interval)
    }
  }, [jobId])

  return { status, error }
}
