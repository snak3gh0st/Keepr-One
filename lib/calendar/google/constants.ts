import {
  GOOGLE_CALENDAR_OPTIONAL_SCOPES,
  GOOGLE_CALENDAR_REQUIRED_SCOPES,
} from '../constants'

export const GOOGLE_CALENDAR_PROVIDER = 'GOOGLE' as const

export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
export const GOOGLE_OIDC_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
export const GOOGLE_CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3'

/**
 * The product needs event CRUD, CalendarList discovery and FreeBusy only.
 * Keep this list intentionally narrower than the broad `calendar` scope.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  ...GOOGLE_CALENDAR_REQUIRED_SCOPES,
  ...GOOGLE_CALENDAR_OPTIONAL_SCOPES,
] as const

export const GOOGLE_CALENDAR_ENCRYPTION_ALGORITHM = 'aes-256-gcm' as const
export const GOOGLE_CALENDAR_OAUTH_STATE_TTL_MS = 10 * 60_000
export const GOOGLE_CALENDAR_TOKEN_REFRESH_SKEW_MS = 60_000
export const GOOGLE_CALENDAR_WATCH_LIFETIME_MS = 6 * 24 * 60 * 60_000
export const GOOGLE_CALENDAR_WATCH_RENEW_WINDOW_MS = 24 * 60 * 60_000
export const GOOGLE_CALENDAR_JOB_LEASE_MS = 2 * 60_000
export const GOOGLE_CALENDAR_MAX_JOB_ATTEMPTS = 8
export const GOOGLE_CALENDAR_RECONCILE_BUCKET_MS = 15 * 60_000
export const GOOGLE_CALENDAR_ROLLING_FULL_SYNC_BUCKET_MS = 24 * 60 * 60_000
export const GOOGLE_CALENDAR_EVENT_RETENTION_PAST_DAYS = 180
export const GOOGLE_CALENDAR_EVENT_RETENTION_FUTURE_DAYS = 730
