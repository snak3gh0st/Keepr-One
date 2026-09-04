import { describe, expect, it } from 'vitest'
import { popupCanRetry, popupCommandStatusText, popupStatusText, popupSyncStatusText } from './popup-copy'
import type { DeviceState, SyncState } from './state'

const ready: DeviceState = { deviceId: 'dev_1', baseUrl: 'https://keepr.test', status: 'READY' }
const unpaired: DeviceState = { status: 'UNPAIRED' }

describe('popupStatusText', () => {
  it('is written in English for every sync state', () => {
    const statuses: SyncState['status'][] = [
      'IDLE',
      'STARTING',
      'NAVIGATING',
      'EXTRACTING',
      'UPLOADING',
      'AUTH_REQUIRED',
      'COMPLETED',
      'PARTIAL',
      'CANCELLED',
      'ERROR',
    ]
    for (const status of statuses) {
      const text = popupStatusText(ready, { status })
      expect(text).not.toMatch(/[áàâãéêíóôõúç]/i)
      expect(text.length).toBeGreaterThan(10)
    }
  })

  it('explains a revoked device instead of asking for a plain reconnect', () => {
    const text = popupStatusText(unpaired, {
      status: 'ERROR',
      errorCode: 'DEVICE_REVOKED',
    })
    expect(text).toMatch(/no longer linked/i)
  })

  it('asks an unpaired device with no failure to connect from Keepr One', () => {
    expect(popupStatusText(unpaired, { status: 'IDLE' })).toMatch(/Connect this computer/i)
  })

  it('distinguishes an out-of-date extension from a portal hiccup', () => {
    const outdated = popupStatusText(ready, { status: 'ERROR', errorCode: 'UNKNOWN_CAPABILITY' })
    const portal = popupStatusText(ready, { status: 'ERROR', errorCode: 'PORTAL_REQUEST_FAILED' })
    expect(outdated).not.toBe(portal)
    expect(outdated).toMatch(/update/i)
  })

  it('shows resumable command authentication independently from daily sync', () => {
    expect(popupStatusText(ready, { status: 'IDLE' }, {
      commandId: 'cmd_1', status: 'MFA_REQUIRED',
    })).toMatch(/verification.*continue automatically/i)
    expect(popupStatusText(ready, { status: 'COMPLETED' }, {
      commandId: 'cmd_1', status: 'RUNNING',
    })).toMatch(/requested work/i)
  })

  it('keeps sync and carrier command copy available as separate K-Bot jobs', () => {
    expect(popupSyncStatusText(ready, { status: 'EXTRACTING' })).toMatch(/K-Bot.*reading/i)
    expect(popupCommandStatusText({ commandId: 'cmd_1', status: 'RUNNING' })).toMatch(/requested work/i)
  })

  it('explains a skipped sync without presenting it as an error', () => {
    expect(popupSyncStatusText(ready, { status: 'CANCELLED' })).toMatch(/skipped.*ready/i)
  })

  it('describes the exact Foresight step when the executor reports it', () => {
    expect(popupCommandStatusText({ status: 'RUNNING', phase: 'GENERATING_PDF' })).toMatch(/official PDF/i)
  })

  it('describes the iGO draft step without implying submission', () => {
    const text = popupCommandStatusText({ status: 'RUNNING', phase: 'WRITING_IGO_DRAFT' })
    expect(text).toMatch(/iGO.*draft/i)
    expect(text).not.toMatch(/submit|submitted/i)
  })

  it('describes the official iGO button handoff', () => {
    expect(popupCommandStatusText({ status: 'NAVIGATING', phase: 'WAITING_IGO_HANDOFF' }))
      .toMatch(/selected iGO e-App.*secure handoff/i)
  })

  it('asks for login instead of showing a stale work step', () => {
    expect(popupCommandStatusText({ status: 'AUTH_REQUIRED', phase: 'OPENING_FORESIGHT' })).toMatch(/Sign in/i)
  })

  it('distinguishes automatic login, MFA, rejection and broker fallback', () => {
    const attempt = {
      operationKind: 'SYNC_RUN' as const,
      operationId: 'run_1',
      authEpoch: 1,
      leaseId: 'lease_1',
      attemptedAt: '2026-09-01T20:00:00.000Z',
    }
    expect(popupSyncStatusText(ready, {
      status: 'AUTH_REQUIRED', credentialAttempt: attempt,
      errorCode: 'CREDENTIAL_AUTO_LOGIN_IN_PROGRESS',
    })).toMatch(/saved credential/i)
    expect(popupSyncStatusText(ready, {
      status: 'AUTH_REQUIRED', credentialAttempt: attempt, errorCode: 'MFA_REQUIRED',
    })).toMatch(/entered.*saved credential.*verification/i)
    expect(popupSyncStatusText(ready, {
      status: 'AUTH_REQUIRED', credentialAttempt: attempt, errorCode: 'CREDENTIAL_REJECTED',
    })).toMatch(/rejected.*disabled/i)
    expect(popupSyncStatusText(ready, {
      status: 'AUTH_REQUIRED', errorCode: 'CREDENTIAL_BROKER_UNAVAILABLE',
    })).toMatch(/unavailable.*manually/i)
    expect(popupSyncStatusText(ready, {
      status: 'AUTH_REQUIRED', errorCode: 'CREDENTIAL_NOT_CONFIGURED',
    })).toMatch(/No saved credential.*manually/i)
  })
})

describe('popupCanRetry', () => {
  it('offers a retry when retrying can work', () => {
    expect(popupCanRetry(ready, { status: 'AUTH_REQUIRED' })).toBe(true)
    expect(popupCanRetry(ready, { status: 'CANCELLED' })).toBe(true)
    expect(popupCanRetry(ready, { status: 'ERROR', errorCode: 'PORTAL_REQUEST_FAILED' })).toBe(true)
    expect(popupCanRetry(ready, { status: 'ERROR', errorCode: 'MYSTERY' })).toBe(true)
  })

  it('hides the retry when retrying cannot possibly work', () => {
    expect(popupCanRetry(unpaired, { status: 'ERROR', errorCode: 'DEVICE_REVOKED' })).toBe(
      false,
    )
    expect(popupCanRetry(ready, { status: 'ERROR', errorCode: 'UNKNOWN_CAPABILITY' })).toBe(false)
    expect(popupCanRetry(ready, { status: 'UPLOADING' })).toBe(false)
  })
})
