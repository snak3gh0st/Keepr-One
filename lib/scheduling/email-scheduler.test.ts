import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  configured: vi.fn(),
  drain: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))
vi.mock('@/lib/email/client', () => ({
  isEmailDeliveryConfigured: mocks.configured,
}))
vi.mock('./email-outbox', () => ({
  drainSchedulingEmailOutbox: mocks.drain,
}))

import {
  startSchedulingEmailScheduler,
  stopSchedulingEmailScheduler,
} from './email-scheduler'

const ORIGINAL_INTERVAL = process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS

beforeEach(() => {
  mocks.captureException.mockReset()
  mocks.configured.mockReset().mockReturnValue(false)
  mocks.drain.mockReset().mockResolvedValue(undefined)
  delete process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS
})

afterEach(() => {
  stopSchedulingEmailScheduler()
  vi.useRealTimers()
  if (ORIGINAL_INTERVAL === undefined) delete process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS
  else process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS = ORIGINAL_INTERVAL
})

describe('scheduling confirmation email scheduler', () => {
  it('stays disabled when Resend has no API key', async () => {
    vi.useFakeTimers()

    const handle = startSchedulingEmailScheduler()

    expect(handle).toBeNull()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.drain).not.toHaveBeenCalled()
  })

  it('runs a delayed catch-up pass and repeats at the configured interval', async () => {
    vi.useFakeTimers()
    mocks.configured.mockReturnValue(true)
    process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS = '5'

    const handle = startSchedulingEmailScheduler()

    expect(handle).not.toBeNull()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(mocks.drain).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.drain).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.drain).toHaveBeenCalledTimes(2)
  })

  it('reports a failed pass and keeps processing on the next interval', async () => {
    vi.useFakeTimers()
    mocks.configured.mockReturnValue(true)
    process.env.SCHEDULING_EMAIL_INTERVAL_SECONDS = '5'
    const failure = new Error('Resend unavailable')
    mocks.drain.mockRejectedValueOnce(failure).mockResolvedValue(undefined)

    startSchedulingEmailScheduler()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(mocks.captureException).toHaveBeenCalledWith(failure)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.drain).toHaveBeenCalledTimes(2)
  })
})
