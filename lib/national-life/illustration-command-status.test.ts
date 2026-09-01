import { describe, expect, it } from 'vitest'
import { latestIllustrationCommandStatus } from './illustration-command-status'

const now = new Date('2026-08-26T18:00:00.000Z')
const future = new Date('2026-08-26T19:00:00.000Z')

describe('illustration connector command status', () => {
  it('maps current background and login states without exposing command internals', () => {
    const status = latestIllustrationCommandStatus([
      { state: 'RUNNING', target: { kind: 'ILLUSTRATION', id: 'ill_running' }, safeErrorCode: null, expiresAt: future },
      { state: 'AUTH_REQUIRED', target: { kind: 'ILLUSTRATION', id: 'ill_login' }, safeErrorCode: null, expiresAt: future },
      { state: 'FAILED', target: { kind: 'ILLUSTRATION', id: 'ill_failed' }, safeErrorCode: 'FORESIGHT_REPORT_TIMEOUT', expiresAt: future },
    ], now)
    expect(status.get('ill_running')).toEqual({ state: 'WORKING' })
    expect(status.get('ill_login')).toEqual({ state: 'BLOCKED', safeErrorCode: null })
    expect(status.get('ill_failed')).toEqual({ state: 'FAILED', safeErrorCode: 'FORESIGHT_REPORT_TIMEOUT' })
  })

  it('uses only the newest command and makes expired work retryable', () => {
    const status = latestIllustrationCommandStatus([
      { state: 'RUNNING', target: { kind: 'ILLUSTRATION', id: 'ill_1' }, safeErrorCode: null, expiresAt: new Date('2026-08-26T17:00:00.000Z') },
      { state: 'COMPLETED', target: { kind: 'ILLUSTRATION', id: 'ill_1' }, safeErrorCode: null, expiresAt: future },
    ], now)
    expect(status.get('ill_1')).toEqual({ state: 'FAILED', safeErrorCode: 'COMMAND_EXPIRED' })
  })

  it('waits for K-Bot when a queued illustration has not been claimed by a browser', () => {
    const unclaimed = {
      state: 'QUEUED',
      deviceId: null,
      target: { kind: 'ILLUSTRATION', id: 'ill_unclaimed' },
      safeErrorCode: null,
      expiresAt: future,
    }

    expect(latestIllustrationCommandStatus([unclaimed], now).get('ill_unclaimed')).toEqual({
      state: 'WAITING_FOR_KBOT',
    })
  })
})
