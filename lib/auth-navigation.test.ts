import { describe, expect, it } from 'vitest'
import {
  portalHomeForRole,
  sanitizeAdminRedirectPath,
  sanitizeUserRedirectPath,
} from './auth-navigation'

describe('authentication navigation', () => {
  it.each([
    [undefined, '/backoffice'],
    ['', '/backoffice'],
    ['/backoffice', '/backoffice'],
    ['/backoffice/users?page=2#directory', '/backoffice/users?page=2#directory'],
    ['/agent', '/backoffice'],
    ['/api/admin/users', '/backoffice'],
    ['/backoffice/login', '/backoffice'],
    ['/backoffice/login/help', '/backoffice'],
    ['/admin', '/backoffice'],
    ['https://evil.example/admin', '/backoffice'],
    ['//evil.example/admin', '/backoffice'],
    ['/admin\\@evil.example', '/backoffice'],
    ['/admin%2f%2fevil.example', '/backoffice'],
  ])('sanitizes the admin destination %s', (input, expected) => {
    expect(sanitizeAdminRedirectPath(input)).toBe(expected)
  })

  it.each([
    [undefined, '/'],
    ['/agent/calendar?view=week', '/agent/calendar?view=week'],
    ['/client#policies', '/client#policies'],
    ['/convites/agencia/token', '/convites/agencia/token'],
    ['/backoffice/users', '/'],
    ['/admin/users', '/'],
    ['/api/auth/get-session', '/'],
    ['/login?next=/agent', '/'],
    ['//evil.example', '/'],
  ])('keeps the user portal out of restricted namespaces for %s', (input, expected) => {
    expect(sanitizeUserRedirectPath(input)).toBe(expected)
  })

  it('maps each persisted role to its own portal', () => {
    expect(portalHomeForRole('ADMIN')).toBe('/backoffice')
    expect(portalHomeForRole('AGENT')).toBe('/agent')
    expect(portalHomeForRole('CLIENT')).toBe('/client')
  })
})
