import { createHash, randomBytes } from 'node:crypto'
import type { UserLanguage } from '@/lib/i18n/config'

export const ADMIN_EMAIL_CHANGE_TOKEN_BYTES = 32
export const ADMIN_EMAIL_CHANGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const ADMIN_EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000

export function normalizeLoginEmail(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

export function hashAdminEmailChangeToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createAdminEmailChangeToken(): {
  rawToken: string
  tokenHash: string
} {
  const rawToken = randomBytes(ADMIN_EMAIL_CHANGE_TOKEN_BYTES).toString('base64url')
  return { rawToken, tokenHash: hashAdminEmailChangeToken(rawToken) }
}

export function isValidAdminEmailChangeToken(token: string): boolean {
  return ADMIN_EMAIL_CHANGE_TOKEN_PATTERN.test(token)
}

export function adminEmailChangeConfirmationUrl(
  token: string,
  language: UserLanguage,
): string {
  if (!isValidAdminEmailChangeToken(token)) {
    throw new TypeError('Invalid admin email change token')
  }

  const fallbackOrigin = process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000'
    : 'https://app.keeprone.com'
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL
    ?? process.env.BETTER_AUTH_URL
    ?? fallbackOrigin
  const origin = new URL(configuredOrigin).origin
  const url = new URL('/confirm-email-change', origin)
  url.searchParams.set('token', token)
  url.searchParams.set('lang', language)
  return url.toString()
}
