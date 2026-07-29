'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionAttemptStatus } from '@/lib/national-life/interactive-connection-service'
import type { NationalLifeConnectionAttemptState } from '@/lib/national-life/connection-attempt-state'
import {
  cancelNationalLifeConnection,
  createNationalLifeViewerBootstrap,
} from './actions'

const POLL_INTERVAL_MS = 1_500
const ACTIVE_STATES = new Set<NationalLifeConnectionAttemptState>([
  'OPENING_PORTAL',
  'AWAITING_LOGIN',
  'AWAITING_MFA',
])
const VIEWER_STATES = new Set<NationalLifeConnectionAttemptState>([
  'AWAITING_LOGIN',
  'AWAITING_MFA',
])

export type ActiveNationalLifeAttempt = {
  attemptId: string
  initialState: string
  expiresAt: string
}

export type UseConnectionAttemptResult = {
  status: ConnectionAttemptStatus | null
  viewerUrl: string | null
  error: string | null
  close(): Promise<void>
}

type AttemptStatusPayload = {
  id: string
  state: NationalLifeConnectionAttemptState
  currentOrigin: string | null
  safeErrorCode: string | null
  expiresAt: string
}

function cancelUrl(attemptId: string) {
  return `/api/agent/integrations/national-life/attempt/${encodeURIComponent(attemptId)}/cancel`
}

function sendKeepaliveCancellation(attemptId: string) {
  void fetch(cancelUrl(attemptId), {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    keepalive: true,
  }).catch(() => undefined)
}

function toStatus(payload: AttemptStatusPayload): ConnectionAttemptStatus {
  return {
    ...payload,
    expiresAt: new Date(payload.expiresAt),
  }
}

function safeTerminalMessage(state: NationalLifeConnectionAttemptState) {
  switch (state) {
    case 'CANCELLED':
      return 'Conexão cancelada. Você pode tentar novamente.'
    case 'EXPIRED':
      return 'A sessão segura expirou. Conecte novamente para continuar.'
    default:
      return 'Não foi possível concluir a conexão. Feche esta janela e tente novamente.'
  }
}

export function useNationalLifeConnectionAttempt(
  attempt: ActiveNationalLifeAttempt,
  active = true,
): UseConnectionAttemptResult {
  const [status, setStatus] = useState<ConnectionAttemptStatus | null>(() => ({
    id: attempt.attemptId,
    state: attempt.initialState as NationalLifeConnectionAttemptState,
    currentOrigin: null,
    safeErrorCode: null,
    expiresAt: new Date(attempt.expiresAt),
  }))
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bootstrapRequested = useRef(false)
  const keepaliveSent = useRef(false)
  const shouldCancel = useRef(active)
  const latestState = useRef<NationalLifeConnectionAttemptState>(
    attempt.initialState as NationalLifeConnectionAttemptState,
  )

  const keepaliveCancel = useCallback(() => {
    if (!shouldCancel.current || keepaliveSent.current) {
      return
    }
    keepaliveSent.current = true
    shouldCancel.current = false
    sendKeepaliveCancellation(attempt.attemptId)
  }, [attempt.attemptId])

  const close = useCallback(async () => {
    if (!shouldCancel.current) {
      return
    }
    shouldCancel.current = false
    const result = await cancelNationalLifeConnection(attempt.attemptId)
    if (!result.ok) {
      setError(result.message)
    }
    setViewerUrl(null)
  }, [attempt.attemptId])

  useEffect(() => {
    if (!active) {
      return
    }

    shouldCancel.current = ACTIVE_STATES.has(latestState.current)
    const abortController = new AbortController()
    let stopped = false

    async function poll() {
      try {
        const response = await fetch(
          `/api/agent/integrations/national-life/attempt/${encodeURIComponent(attempt.attemptId)}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: abortController.signal,
          },
        )

        if (
          response.status === 404 &&
          (latestState.current === 'AWAITING_LOGIN' ||
            latestState.current === 'AWAITING_MFA')
        ) {
          const connectedStatus: ConnectionAttemptStatus = {
            id: attempt.attemptId,
            state: 'AUTHENTICATED',
            currentOrigin: null,
            safeErrorCode: null,
            expiresAt: new Date(attempt.expiresAt),
          }
          latestState.current = connectedStatus.state
          shouldCancel.current = false
          setStatus(connectedStatus)
          setViewerUrl(null)
          stopped = true
          return
        }

        if (!response.ok) {
          throw new Error('STATUS_UNAVAILABLE')
        }

        const next = toStatus((await response.json()) as AttemptStatusPayload)
        latestState.current = next.state
        shouldCancel.current = ACTIVE_STATES.has(next.state)
        setStatus(next)

        if (VIEWER_STATES.has(next.state) && !bootstrapRequested.current) {
          bootstrapRequested.current = true
          const bootstrap = await createNationalLifeViewerBootstrap(attempt.attemptId)
          if (!bootstrap.ok) {
            throw new Error(bootstrap.message)
          }
          setViewerUrl(bootstrap.bootstrapUrl)
        }

        if (!ACTIVE_STATES.has(next.state)) {
          stopped = true
          setViewerUrl(null)
          if (next.state !== 'AUTHENTICATED') {
            setError(safeTerminalMessage(next.state))
          }
        }
      } catch (pollError) {
        if (abortController.signal.aborted) {
          return
        }
        stopped = true
        setViewerUrl(null)
        setError(
          pollError instanceof Error && pollError.message !== 'STATUS_UNAVAILABLE'
            ? pollError.message
            : 'A sessão segura foi interrompida. Conecte novamente para continuar.',
        )
        keepaliveCancel()
      }
    }

    void poll()
    const interval = window.setInterval(() => {
      if (!stopped) {
        void poll()
      }
    }, POLL_INTERVAL_MS)

    const handleSignOut = () => {
      stopped = true
      abortController.abort()
      keepaliveCancel()
    }
    window.addEventListener('keepr-one:sign-out', handleSignOut)

    return () => {
      stopped = true
      abortController.abort()
      window.clearInterval(interval)
      window.removeEventListener('keepr-one:sign-out', handleSignOut)
      keepaliveCancel()
    }
  }, [active, attempt.attemptId, attempt.expiresAt, keepaliveCancel])

  return { status, viewerUrl, error, close }
}
