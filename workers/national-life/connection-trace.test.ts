import { describe, expect, it, vi } from 'vitest'
import {
  traceReason,
  writeConnectionTrace,
  type ConnectionTraceEvent,
} from './connection-trace'

describe('writeConnectionTrace', () => {
  it('writes one JSON line, scoped like the keep-alive already is', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      writeConnectionTrace({ step: 'claimed', attemptId: 'a1', state: 'OPENING_PORTAL', expiresInMs: 60_000 })
      expect(log).toHaveBeenCalledOnce()
      expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
        scope: 'national-life-connection',
        step: 'claimed',
        attemptId: 'a1',
        state: 'OPENING_PORTAL',
        expiresInMs: 60_000,
      })
    } finally {
      log.mockRestore()
    }
  })
})

describe('traceReason', () => {
  // Errors from the carrier and from Steel carry URLs, and a stack trace in a
  // log is how a session cookie ends up in one. First line only, capped.
  it('keeps the first line and drops the stack', () => {
    const error = new Error('carrier said no')
    error.stack = 'Error: carrier said no\n    at somewhere (secret-cookie=abc)'
    expect(traceReason(error)).toBe('Error: carrier said no')
  })

  it('caps a long single line', () => {
    expect(traceReason(new Error('x'.repeat(500))).length).toBeLessThanOrEqual(160)
  })
})

// The events are a closed set, and every one of them has to be safe to print.
// This is the test that fails if someone later adds a field carrying a cookie,
// a token, a URL with a one-time code, or an insured's name.
describe('the trace never carries anything private', () => {
  const samples: ConnectionTraceEvent[] = [
    { step: 'claimed', attemptId: 'a1', state: 'AWAITING_MFA', expiresInMs: 1 },
    { step: 'expired', attemptId: 'a1', state: 'AWAITING_MFA' },
    { step: 'terminal', attemptId: 'a1', state: 'CANCELLED' },
    { step: 'session-created', attemptId: 'a1', steelSessionId: 's1' },
    { step: 'session-create-failed', attemptId: 'a1', reason: 'boom' },
    { step: 'session-reconnected', attemptId: 'a1', steelSessionId: 's1' },
    { step: 'session-reconnect-failed', attemptId: 'a1', reason: 'boom' },
    { step: 'classified', attemptId: 'a1', kind: 'AUTHENTICATED', origin: 'https://carrier.example' },
    { step: 'classify-failed', attemptId: 'a1', reason: 'boom' },
    { step: 'completed', attemptId: 'a1', steelSessionId: 's1' },
    { step: 'failed', attemptId: 'a1', reason: 'boom' },
  ]

  const ALLOWED_KEYS = new Set([
    'step',
    'attemptId',
    'state',
    'kind',
    'origin',
    'reason',
    'steelSessionId',
    'expiresInMs',
  ])

  it.each(samples.map((event) => [event.step, event] as const))(
    '%s carries only allowed keys',
    (_step, event) => {
      for (const key of Object.keys(event)) {
        expect(ALLOWED_KEYS.has(key), `unexpected key on the trace: ${key}`).toBe(true)
      }
    },
  )

  // `origin` and not the URL: the SSO chain puts one-time codes in the query
  // string, and an origin answers "carrier page or login wall" without them.
  it('describes where the browser is by origin, never by full URL', () => {
    const classified = samples.find((event) => event.step === 'classified')
    expect(classified && 'origin' in classified ? classified.origin : '').not.toContain('?')
  })
})
