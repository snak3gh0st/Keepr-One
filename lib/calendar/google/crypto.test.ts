import { describe, expect, it } from 'vitest'
import type { GoogleCalendarEnv } from './env'
import { decryptGoogleSecret, encryptGoogleSecret } from './crypto'

const env: GoogleCalendarEnv = {
  clientId: 'client', clientSecret: 'secret',
  redirectUri: 'https://app.example.com/callback', webhookUrl: 'https://app.example.com/webhook',
  tokenKeyVersion: 'v1', tokenKeys: { v1: Buffer.alloc(32, 11).toString('base64') },
  workerId: 'worker', workerIntervalSeconds: 15, reconcileIntervalSeconds: 300,
  schedulerDisabled: false,
}

describe('Google credential encryption', () => {
  it('round-trips AES-GCM only with the same ownership binding', () => {
    const encrypted = encryptGoogleSecret(
      'refresh-token',
      { purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a' },
      env,
    )
    expect(decryptGoogleSecret(
      encrypted,
      { purpose: 'google-calendar-token', userId: 'user-a', providerAccountId: 'google-a' },
      env,
    )).toBe('refresh-token')
    expect(() => decryptGoogleSecret(
      encrypted,
      { purpose: 'google-calendar-token', userId: 'user-b', providerAccountId: 'google-a' },
      env,
    )).toThrow('Google Calendar secret decryption failed')
  })
})
