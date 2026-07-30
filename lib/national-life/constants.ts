export const NATIONAL_LIFE_PROVIDER = 'NATIONAL_LIFE' as const
export const NATIONAL_LIFE_MAX_JOB_ATTEMPTS = 3
export const NATIONAL_LIFE_JOB_TIMEOUT_MS = 5 * 60_000
// Covers an SMS/e-mail MFA round-trip with headroom. Also bounds the Steel
// session timeout for the interactive login, so both expire together.
export const NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS = 25 * 60_000
export const NATIONAL_LIFE_VIEWER_TOKEN_TTL_MS = 60_000
export const NATIONAL_LIFE_CONNECTION_RATE_LIMIT = 5
export const NATIONAL_LIFE_CONNECTION_RATE_WINDOW_MS = 15 * 60_000
