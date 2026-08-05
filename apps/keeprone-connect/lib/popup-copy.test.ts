import { describe, expect, it } from 'vitest'
import { popupCanRetry, popupStatusText } from './popup-copy'
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
})

describe('popupCanRetry', () => {
  it('offers a retry when retrying can work', () => {
    expect(popupCanRetry(ready, { status: 'AUTH_REQUIRED' })).toBe(true)
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
