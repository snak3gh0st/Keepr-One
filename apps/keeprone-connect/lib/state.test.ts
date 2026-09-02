import { describe, expect, it } from 'vitest'
import { parseCommandState, parseCredentialAttempt, parseSyncState } from './state'

describe('parseCommandState', () => {
  it('keeps valid durable coordination metadata across extension restarts', () => {
    expect(parseCommandState({
      status: 'RUNNING', commandId: 'command_1', runId: 'run_1', carrierTabId: 12,
      nextEventSequence: 3, phase: 'VERIFYING_VALUES', termInputHash: 'a'.repeat(64),
      updatedAt: '2026-08-31T20:00:00.000Z',
    })).toEqual({
      status: 'RUNNING', commandId: 'command_1', runId: 'run_1', carrierTabId: 12,
      nextEventSequence: 3, phase: 'VERIFYING_VALUES', termInputHash: 'a'.repeat(64),
      updatedAt: '2026-08-31T20:00:00.000Z',
    })
  })

  it('degrades an unknown stored shape to idle instead of executing it', () => {
    expect(parseCommandState({ status: 'STEAL_PASSWORD', carrierTabId: 12 })).toEqual({ status: 'IDLE' })
    expect(parseCommandState('RUNNING')).toEqual({ status: 'IDLE' })
  })

  it('drops malformed optional fields without discarding a valid status', () => {
    expect(parseCommandState({
      status: 'AUTH_REQUIRED', commandId: '', runId: 'run_1', carrierTabId: -1,
      nextEventSequence: -2, phase: 'UNKNOWN_PHASE', termInputHash: 'not-a-hash',
      errorCode: '<html>', updatedAt: 'yesterday',
    })).toEqual({ status: 'AUTH_REQUIRED', runId: 'run_1' })
  })

  it('keeps only bounded non-secret credential-attempt metadata', () => {
    const credentialAttempt = {
      operationKind: 'CONNECTOR_COMMAND',
      operationId: 'command_1',
      authEpoch: 4,
      leaseId: 'lease_1',
      attemptedAt: '2026-09-01T20:00:00.000Z',
    }
    expect(parseCommandState({ status: 'AUTH_REQUIRED', credentialAttempt }))
      .toEqual({ status: 'AUTH_REQUIRED', credentialAttempt })
  })

  it.each(['username', 'password', 'wrappedKey', 'ciphertext', 'iv'])(
    'rejects %s at every nested storage level',
    (secretKey) => {
      const malicious = {
        operationKind: 'SYNC_RUN',
        operationId: 'run_1',
        authEpoch: 1,
        attemptedAt: '2026-09-01T20:00:00.000Z',
        nested: { deeper: { [secretKey]: 'must-not-land' } },
      }
      expect(parseCredentialAttempt(malicious)).toBeUndefined()
      expect(parseCommandState({ status: 'AUTH_REQUIRED', credentialAttempt: malicious }))
        .toEqual({ status: 'IDLE' })
      expect(parseSyncState({ status: 'AUTH_REQUIRED', credentialAttempt: malicious }))
        .toEqual({ status: 'IDLE' })
    },
  )
})
