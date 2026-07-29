import { describe, expect, it } from 'vitest'
import { assertConnectionAttemptTransition } from './connection-attempt-state'

describe('National Life interactive connection state', () => {
  it.each([
    ['OPENING_PORTAL', 'AWAITING_LOGIN'],
    ['AWAITING_LOGIN', 'AWAITING_MFA'],
    ['AWAITING_LOGIN', 'AUTHENTICATED'],
    ['AWAITING_MFA', 'AUTHENTICATED'],
    ['OPENING_PORTAL', 'CANCELLED'],
    ['AWAITING_LOGIN', 'EXPIRED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertConnectionAttemptTransition(from, to)).not.toThrow()
  })

  it.each([
    ['AUTHENTICATED', 'AWAITING_LOGIN'],
    ['CANCELLED', 'AUTHENTICATED'],
    ['FAILED', 'AWAITING_MFA'],
    ['EXPIRED', 'OPENING_PORTAL'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertConnectionAttemptTransition(from, to)).toThrow('Invalid National Life connection transition')
  })
})
