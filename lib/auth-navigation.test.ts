import { describe, expect, it } from 'vitest'
import {
  portalHomeForRole,
  sanitizeAdminRedirectPath,
  sanitizeUserRedirectPath,
} from './auth-navigation'

describe('authentication navigation', () => {
  it.each([
    [undefined, '/admin'],
    ['', '/admin'],
    ['/admin', '/admin'],
    ['/admin/users?page=2#directory', '/admin/users?page=2#directory'],
    ['/agent', '/admin'],
    ['/api/admin/users', '/admin'],
    ['/admin/login', '/admin'],
    ['/admin/login/help', '/admin'],
    ['https://evil.example/admin', '/admin'],
    ['//evil.example/admin', '/admin'],
    ['/admin\\@evil.example', '/admin'],
    ['/admin%2f%2fevil.example', '/admin'],
  ])('sanitizes the admin destination %s', (input, expected) => {
    expect(sanitizeAdminRedirectPath(input)).toBe(expected)
  })

  it.each([
    [undefined, '/'],
    ['/agent/calendar?view=week', '/agent/calendar?view=week'],
    ['/client#policies', '/client#policies'],
    ['/convites/agencia/token', '/convites/agencia/token'],
    ['/admin/users', '/'],
    ['/api/auth/get-session', '/'],
    ['/login?next=/agent', '/'],
    ['//evil.example', '/'],
  ])('keeps the user portal out of restricted namespaces for %s', (input, expected) => {
    expect(sanitizeUserRedirectPath(input)).toBe(expected)
  })

  it('maps each persisted role to its own portal', () => {
    expect(portalHomeForRole('ADMIN')).toBe('/admin')
    expect(portalHomeForRole('AGENT')).toBe('/agent')
    expect(portalHomeForRole('CLIENT')).toBe('/client')
  })
})
