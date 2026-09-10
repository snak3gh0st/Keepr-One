import { describe, expect, it } from 'vitest'
import { authorizeScheduledMessageRequest } from './scheduled-auth'

const secret = 'a'.repeat(32)

describe('authorizeScheduledMessageRequest', () => {
  it('behaves as unavailable until a strong secret is configured', () => {
    // Not DENIED: a 401 would announce that the door exists.
    expect(authorizeScheduledMessageRequest('Bearer x', undefined)).toBe('NOT_CONFIGURED')
    expect(authorizeScheduledMessageRequest('Bearer x', '   ')).toBe('NOT_CONFIGURED')
    expect(authorizeScheduledMessageRequest('Bearer x', 'a'.repeat(31))).toBe('NOT_CONFIGURED')
  })

  it('accepts only the configured secret, presented as a bearer token', () => {
    expect(authorizeScheduledMessageRequest(`Bearer ${secret}`, secret)).toBe('OK')
    expect(authorizeScheduledMessageRequest(`Bearer ${'b'.repeat(32)}`, secret)).toBe('DENIED')
    // A wrong-length guess must not throw its way to a different answer.
    expect(authorizeScheduledMessageRequest('Bearer short', secret)).toBe('DENIED')
    expect(authorizeScheduledMessageRequest(secret, secret)).toBe('DENIED')
    expect(authorizeScheduledMessageRequest('Bearer ', secret)).toBe('DENIED')
    expect(authorizeScheduledMessageRequest(null, secret)).toBe('DENIED')
  })
})
