/// What the connection path says about itself, one line per decision.
///
/// Written because a login completed on 2026-07-31 22:31 UTC leaving no Steel
/// session behind, and four separate explanations for that were each disproved
/// by the next measurement. The reason each guess survived long enough to be
/// worth making is that the worker logs a startup line and nothing else, so
/// what actually happened had to be reconstructed from database archaeology.
/// A login is expensive — it needs a human and an MFA code — and spending one
/// to produce a mystery is the waste this exists to stop.
///
/// Deliberately narrow: identifiers, states and decisions. Never a cookie,
/// never a token, never a person. The whole point of this integration's
/// redaction discipline is that diagnostics do not become the leak.
export type ConnectionTraceEvent =
  | { step: 'claimed'; attemptId: string; state: string; expiresInMs: number }
  | { step: 'expired'; attemptId: string; state: string }
  | { step: 'terminal'; attemptId: string; state: string }
  /// The answer to "did a browser get created at all", which is exactly what
  /// could not be answered after the fact.
  | { step: 'session-created'; attemptId: string; steelSessionId: string }
  | { step: 'session-create-failed'; attemptId: string; reason: string }
  | { step: 'session-reconnected'; attemptId: string; steelSessionId: string }
  | { step: 'session-reconnect-failed'; attemptId: string; reason: string }
  /// `origin` rather than the URL: the SSO chain carries one-time codes in the
  /// query string, and an origin is enough to tell a carrier page from a login
  /// wall.
  | { step: 'classified'; attemptId: string; kind: string; origin: string }
  | { step: 'classify-failed'; attemptId: string; reason: string }
  | { step: 'completed'; attemptId: string; steelSessionId: string | null }
  | { step: 'failed'; attemptId: string; reason: string }

export type ConnectionTrace = (event: ConnectionTraceEvent) => void

/// One JSON line per event, matching the shape the keep-alive script already
/// writes, so both are greppable the same way.
export function writeConnectionTrace(event: ConnectionTraceEvent): void {
  console.log(JSON.stringify({ scope: 'national-life-connection', ...event }))
}

/// The first line of an error, capped. Errors from the carrier and from Steel
/// both carry URLs and occasionally page fragments; a stack trace in a log is
/// how a session cookie ends up in one.
export function traceReason(error: unknown): string {
  return String(error).split('\n')[0].slice(0, 160)
}
