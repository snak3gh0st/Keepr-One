import { describe, expect, it } from 'vitest'
import {
  connectorFailure,
  connectorFailureRequiresReconnect,
} from './connector-failure'

const EVERY_CODE = [
  'DEVICE_REQUEST_REJECTED',
  'DEVICE_KEY_UNAVAILABLE',
  'PAIRING_REJECTED',
  'UNKNOWN_CAPABILITY',
  'UNSAFE_NAVIGATE_PATH',
  'INVALID_RUN_RESPONSE',
  'PORTAL_REQUEST_FAILED',
  'BRIDGE_UNAVAILABLE',
  'DEVICE_REQUEST_FAILED',
  'SYNC_STATE_INVALID',
  'WHATEVER_COMES_NEXT',
  null,
  undefined,
]

describe('connectorFailure', () => {
  it('gives every failure a way out, never a dead end', () => {
    for (const code of EVERY_CODE) {
      const failure = connectorFailure(code)
      expect(failure.actionLabel.length).toBeGreaterThan(0)
      expect(failure.message.length).toBeGreaterThan(20)
    }
  })

  it('never shows an internal code to the agent', () => {
    for (const code of EVERY_CODE) {
      const failure = connectorFailure(code)
      for (const text of [failure.message, failure.actionLabel]) {
        expect(text).not.toMatch(/[A-Z]{3,}_[A-Z]/)
        if (code) expect(text).not.toContain(code)
      }
    }
  })

  it('is written in English', () => {
    for (const code of EVERY_CODE) {
      expect(connectorFailure(code).message).not.toMatch(/[áàâãéêíóôõúç]/i)
    }
  })

  it('sends a revoked device to reconnect rather than to a retry that cannot work', () => {
    const failure = connectorFailure('DEVICE_REQUEST_REJECTED')
    expect(failure.action).toBe('reconnect')
    expect(failure.actionLabel).toMatch(/reconnect/i)
    expect(connectorFailureRequiresReconnect('DEVICE_REQUEST_REJECTED')).toBe(true)
    expect(connectorFailureRequiresReconnect('PORTAL_REQUEST_FAILED')).toBe(false)
    expect(connectorFailureRequiresReconnect(null)).toBe(false)
  })

  it('tells an out-of-date extension to update, and says so plainly', () => {
    const failure = connectorFailure('UNKNOWN_CAPABILITY')
    expect(failure.action).toBe('update')
    expect(failure.message).toMatch(/update the extension/i)
  })

  it('reassures on a portal hiccup instead of blaming the agent', () => {
    const failure = connectorFailure('BRIDGE_UNAVAILABLE')
    expect(failure.action).toBe('retry')
    expect(failure.message).toMatch(/clears up/i)
  })

  it('keeps the generic message as a true fallback, not the common case', () => {
    expect(connectorFailure('WHATEVER_COMES_NEXT').action).toBe('support')
    const distinct = new Set(
      [
        'DEVICE_REQUEST_REJECTED',
        'UNKNOWN_CAPABILITY',
        'PORTAL_REQUEST_FAILED',
        'WHATEVER_COMES_NEXT',
      ].map((code) => connectorFailure(code).message),
    )
    expect(distinct.size).toBe(4)
  })
})
