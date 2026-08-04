export const NLG_ORIGIN = 'https://www.nationallife.com'
export const LOGIN_PATH = '/agent/auth/login'
export const GRID_PATHS = {
  NEW_BUSINESS: '/agent/book-of-business/new-business/all-new-business-cases',
  INFORCE_CLIENTS: '/agent/book-of-business/inforce-book/all-clients',
} as const

export const GRID_KEYS = ['NEW_BUSINESS', 'INFORCE_CLIENTS'] as const
export type GridKey = (typeof GRID_KEYS)[number]

export const PRODUCTION_KEEPR_ORIGIN = 'https://app.keeprone.com'
const LOCAL_KEEPR_ORIGIN = 'http://localhost:3000'

export function allowedKeeprOrigins(): readonly string[] {
  if (__KEEPR_ORIGIN__ === PRODUCTION_KEEPR_ORIGIN) return [PRODUCTION_KEEPR_ORIGIN]
  return [PRODUCTION_KEEPR_ORIGIN, LOCAL_KEEPR_ORIGIN]
}

export function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('INVALID_BASE_URL')
  }
  return url.origin
}

export function requireAllowedBaseUrl(value: string): string {
  const origin = normalizeOrigin(value)
  if (!allowedKeeprOrigins().includes(origin)) throw new Error('BASE_URL_NOT_ALLOWED')
  return origin
}

export function isAuthPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname.startsWith('/agent/auth/') ||
    pathname.includes('/login') ||
    pathname.includes('/signin') ||
    pathname.includes('/mfa') ||
    pathname.includes('/challenge')
  )
}
