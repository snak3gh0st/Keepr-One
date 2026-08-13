import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authorizeFollowUpNotificationRequest,
  parseFollowUpNotificationIntervalSeconds,
  startFollowUpNotificationScheduler,
  stopFollowUpNotificationScheduler,
} from './follow-up-notification-scheduler'

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

afterEach(() => {
  stopFollowUpNotificationScheduler()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('follow-up notification trigger authorization', () => {
  const secret = 'n'.repeat(48)

  it('is unavailable without a strong configured secret', () => {
    expect(authorizeFollowUpNotificationRequest(`Bearer ${secret}`, undefined)).toBe(
      'NOT_CONFIGURED',
    )
    expect(authorizeFollowUpNotificationRequest('Bearer short', 'short')).toBe(
      'NOT_CONFIGURED',
    )
  })

  it('accepts only the configured bearer without leaking its length', () => {
    expect(authorizeFollowUpNotificationRequest(`Bearer ${secret}`, secret)).toBe('OK')
    expect(authorizeFollowUpNotificationRequest(null, secret)).toBe('DENIED')
    expect(authorizeFollowUpNotificationRequest('Basic anything', secret)).toBe('DENIED')
    expect(() =>
      authorizeFollowUpNotificationRequest('Bearer x', secret),
    ).not.toThrow()
    expect(authorizeFollowUpNotificationRequest('Bearer x', secret)).toBe('DENIED')
  })
})

describe('follow-up notification schedule', () => {
  it('defaults to five minutes and validates operational bounds', () => {
    expect(parseFollowUpNotificationIntervalSeconds(undefined)).toBe(300)
    expect(parseFollowUpNotificationIntervalSeconds('60')).toBe(60)
    expect(parseFollowUpNotificationIntervalSeconds('86400')).toBe(86400)
    expect(() => parseFollowUpNotificationIntervalSeconds('59')).toThrow()
    expect(() => parseFollowUpNotificationIntervalSeconds('60.5')).toThrow()
  })

  it('runs a catch-up pass and then repeats without overlapping slow work', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const pass = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    startFollowUpNotificationScheduler({
      firstRunDelayMs: 10,
      intervalSeconds: 60,
      pass,
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(pass).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(180_000)
    expect(pass).toHaveBeenCalledTimes(1)

    release?.()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(2)
    release?.()
    await vi.advanceTimersByTimeAsync(0)
  })

  it('reports one failed pass and continues on the next interval', async () => {
    vi.useFakeTimers()
    const pass = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined)
    const Sentry = await import('@sentry/nextjs')

    startFollowUpNotificationScheduler({ firstRunDelayMs: 1, intervalSeconds: 60, pass })
    await vi.advanceTimersByTimeAsync(1)
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(pass).toHaveBeenCalledTimes(2)
  })

  it('does not stack timers across hot reload starts', async () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => {})
    startFollowUpNotificationScheduler({ firstRunDelayMs: 1, intervalSeconds: 60, pass })
    startFollowUpNotificationScheduler({ firstRunDelayMs: 1, intervalSeconds: 60, pass })
    await vi.advanceTimersByTimeAsync(60_001)
    expect(pass).toHaveBeenCalledTimes(2)
  })
})
