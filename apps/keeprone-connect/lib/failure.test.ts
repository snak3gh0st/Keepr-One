import { describe, expect, it } from 'vitest'
import { DEVICE_REVOKED, connectorFailure, revokesDevice } from './failure'

describe('revokesDevice', () => {
  it('only destroys the local key on an explicit revocation', () => {
    expect(revokesDevice(DEVICE_REVOKED)).toBe(true)
  })

  it('leaves the key alone for a 401 that is not a revocation', () => {
    // O mesmo 401 cobre relógio fora da janela da assinatura, que persiste
    // depois de reparear: apagar a chave aqui é recriar o laço infinito.
    expect(revokesDevice('DEVICE_REQUEST_REJECTED')).toBe(false)
    expect(revokesDevice('DEVICE_KEY_UNAVAILABLE')).toBe(false)
    expect(revokesDevice('DEVICE_REQUEST_FAILED')).toBe(false)
    expect(revokesDevice('BRIDGE_UNAVAILABLE')).toBe(false)
    expect(revokesDevice('PORTAL_REQUEST_FAILED')).toBe(false)
    expect(revokesDevice(undefined)).toBe(false)
  })
})

describe('connectorFailure', () => {
  it('tells a revoked device to reconnect', () => {
    const failure = connectorFailure('DEVICE_REVOKED')
    expect(failure.action).toBe('reconnect')
    expect(failure.message).toMatch(/reconnect/i)
  })

  it('tells an out-of-date extension to update', () => {
    for (const code of ['UNKNOWN_CAPABILITY', 'UNSAFE_NAVIGATE_PATH', 'INVALID_RUN_RESPONSE']) {
      const failure = connectorFailure(code)
      expect(failure.action).toBe('update')
      expect(failure.message).toMatch(/update/i)
    }
  })

  it('tells a portal hiccup that it usually clears up', () => {
    for (const code of ['PORTAL_REQUEST_FAILED', 'TEMPLATE_UNAVAILABLE', 'DEVICE_REQUEST_FAILED']) {
      const failure = connectorFailure(code)
      expect(failure.action).toBe('retry')
      expect(failure.message).toMatch(/National Life/)
    }
  })

  it('explains a run-start rate limit without blaming National Life', () => {
    const failure = connectorFailure('RUN_START_RATE_LIMITED')
    expect(failure.action).toBe('retry')
    expect(failure.message).toMatch(/wait a few minutes/i)
    expect(failure.message).toMatch(/connection is still intact/i)
  })

  it('falls back to a generic message only for codes it does not know', () => {
    const failure = connectorFailure('SOMETHING_NOBODY_MAPPED')
    expect(failure.action).toBe('support')
    expect(failure.message).toMatch(/try again/i)
  })

  it('never leaks the internal code into the message', () => {
    const codes = [
      'DEVICE_REVOKED',
      'DEVICE_REQUEST_REJECTED',
      'UNKNOWN_CAPABILITY',
      'PORTAL_REQUEST_FAILED',
      'SYNC_STATE_INVALID',
      'SOMETHING_NOBODY_MAPPED',
      undefined,
    ]
    for (const code of codes) {
      const { message } = connectorFailure(code)
      expect(message).not.toMatch(/[A-Z]{3,}_[A-Z]/)
      if (code) expect(message).not.toContain(code)
    }
  })
})
