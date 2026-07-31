export const NATIONAL_LIFE_PROVIDER = 'NATIONAL_LIFE' as const
export const NATIONAL_LIFE_MAX_JOB_ATTEMPTS = 3
export const NATIONAL_LIFE_JOB_TIMEOUT_MS = 5 * 60_000
// Covers an SMS/e-mail MFA round-trip with headroom. This bounds how long the
// human has to finish logging in — no longer the browser's own lifetime, which
// is now NATIONAL_LIFE_CARRIER_BROWSER_TTL_MS.
export const NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS = 25 * 60_000
/// How long the browser the human logged in on is kept alive.
///
/// A workday, because that is the shape of the problem: the illustration tool's
/// token lives in the page's memory, so the browser has to outlive the login for
/// jobs to reuse it. Steel's `timeout` is a hard ceiling — its docs are explicit
/// that a live session's timeout cannot be extended — so this is chosen up
/// front and cannot be renewed. One login per day, which is what the agent
/// already does in their own browser.
///
/// Deliberately below Steel's 24 h maximum: a browser that outlives the day it
/// was opened in is a resource nobody is watching.
export const NATIONAL_LIFE_CARRIER_BROWSER_TTL_MS = 12 * 60 * 60_000
export const NATIONAL_LIFE_VIEWER_TOKEN_TTL_MS = 60_000
export const NATIONAL_LIFE_CONNECTION_RATE_LIMIT = 5
export const NATIONAL_LIFE_CONNECTION_RATE_WINDOW_MS = 15 * 60_000
