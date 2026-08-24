import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  run: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/lib/crm/follow-up-notification-scheduler', () => ({
  authorizeFollowUpNotificationRequest: mocks.authorize,
  runFollowUpNotificationPass: mocks.run,
}))
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockReturnValue('OK')
  mocks.run.mockResolvedValue({ examined: 4, created: 2 })
})

describe('CRM follow-up notification trigger', () => {
  it('conceals an unconfigured trigger and denies a wrong secret', async () => {
    mocks.authorize.mockReturnValueOnce('NOT_CONFIGURED')
    const unavailable = await POST(new Request('https://app.keepr.one/api/internal'))
    expect(unavailable.status).toBe(404)
    expect(unavailable.headers.get('cache-control')).toBe('no-store')

    mocks.authorize.mockReturnValueOnce('DENIED')
    const denied = await POST(new Request('https://app.keepr.one/api/internal'))
    expect(denied.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('runs the same idempotent catch-up pass used by the in-process scheduler', async () => {
    const response = await POST(
      new Request('https://app.keepr.one/api/internal', {
        method: 'POST',
        headers: { authorization: 'Bearer configured' },
      }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ examined: 4, created: 2 })
    expect(mocks.authorize).toHaveBeenCalledWith('Bearer configured')
  })

  it('reports failures without exposing database details', async () => {
    const failure = new Error('database credentials leaked here')
    mocks.run.mockRejectedValue(failure)
    const response = await POST(new Request('https://app.keepr.one/api/internal'))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'NOTIFICATION_PASS_FAILED' })
    expect(mocks.captureException).toHaveBeenCalledWith(failure)
  })
})
