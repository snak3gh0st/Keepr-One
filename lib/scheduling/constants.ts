export const SCHEDULING_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SCHEDULING_MAX_PUBLIC_RANGE_DAYS = 31
export const SCHEDULING_DEFAULT_PUBLIC_RANGE_DAYS = 14
export const SCHEDULING_MANAGE_TOKEN_BYTES = 32
export const SCHEDULING_EMAIL_JOB_LEASE_MS = 2 * 60_000
export const SCHEDULING_EMAIL_MAX_JOB_ATTEMPTS = 8

export const SCHEDULING_RATE_LIMITS = {
  slotsByAddress: { max: 120, windowSeconds: 60 * 60 },
  bookingsByAddress: { max: 20, windowSeconds: 60 * 60 },
  bookingsByEmail: { max: 6, windowSeconds: 60 * 60 },
} as const
