export type PortalRole = 'ADMIN' | 'AGENT' | 'CLIENT'

const LOCAL_ORIGIN = 'https://keepr-one.local'
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

function parseLocalPath(value: string | null | undefined) {
  const candidate = value?.trim()
  if (
    !candidate
    || candidate.length > 2_048
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || ENCODED_PATH_SEPARATOR.test(candidate)
    || CONTROL_CHARACTER.test(candidate)
  ) {
    return null
  }

  try {
    const url = new URL(candidate, LOCAL_ORIGIN)
    if (url.origin !== LOCAL_ORIGIN) return null
    return {
      pathname: url.pathname,
      href: `${url.pathname}${url.search}${url.hash}`,
    }
  } catch {
    return null
  }
}

export function sanitizeAdminRedirectPath(value: string | null | undefined) {
  const parsed = parseLocalPath(value)
  if (!parsed) return '/admin'

  const isAdminPath = parsed.pathname === '/admin' || parsed.pathname.startsWith('/admin/')
  const isLoginPath = parsed.pathname === '/admin/login' || parsed.pathname.startsWith('/admin/login/')
  return isAdminPath && !isLoginPath ? parsed.href : '/admin'
}

export function sanitizeUserRedirectPath(value: string | null | undefined) {
  const parsed = parseLocalPath(value)
  if (!parsed) return '/'

  const isRestrictedNamespace = [
    '/admin',
    '/api',
    '/login',
  ].some((prefix) => parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`))

  return isRestrictedNamespace ? '/' : parsed.href
}

export function portalHomeForRole(role: PortalRole) {
  if (role === 'ADMIN') return '/admin'
  if (role === 'CLIENT') return '/client'
  return '/agent'
}
