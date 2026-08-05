import { describe, expect, it } from 'vitest'
import {
  connectorFailure,
  connectorFailureRequiresReconnect,
} from './connector-failure'

const EVERY_CODE = [
  'DEVICE_REVOKED',
  'DEVICE_REQUEST_REJECTED',
  'DISCONNECT_FAILED',
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
    const failure = connectorFailure('DEVICE_REVOKED')
    expect(failure.action).toBe('reconnect')
    expect(failure.actionLabel).toMatch(/reconnect/i)
    expect(connectorFailureRequiresReconnect('DEVICE_REVOKED')).toBe(true)
    expect(connectorFailureRequiresReconnect('PORTAL_REQUEST_FAILED')).toBe(false)
    expect(connectorFailureRequiresReconnect(null)).toBe(false)
  })

  it('does not call a plain rejected request a revoked device', () => {
    // 401 cobre relógio fora da janela e soluço de banco. Tratar isso como
    // pareamento morto manda o agente reconectar para cair no mesmo 401.
    expect(connectorFailureRequiresReconnect('DEVICE_REQUEST_REJECTED')).toBe(false)
  })

  it('gives a failed disconnect its own way out, not a button that syncs', () => {
    const failure = connectorFailure('DISCONNECT_FAILED')
    expect(failure.action).toBe('disconnect')
    expect(failure.actionLabel).toMatch(/disconnect/i)
    expect(failure.message).not.toMatch(/sync stopped/i)
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
        'DEVICE_REVOKED',
        'UNKNOWN_CAPABILITY',
        'PORTAL_REQUEST_FAILED',
        'WHATEVER_COMES_NEXT',
      ].map((code) => connectorFailure(code).message),
    )
    expect(distinct.size).toBe(4)
  })
})
