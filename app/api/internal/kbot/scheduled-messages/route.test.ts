import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  run: vi.fn(),
  captureException: vi.fn(),
}))

vi.mock('@/lib/kbot-messaging/scheduled-auth', () => ({ authorizeScheduledMessageRequest: mocks.authorize }))
vi.mock('@/lib/kbot-messaging/scheduled-queue', () => ({ runScheduledMessagePass: mocks.run }))
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authorize.mockReturnValue('OK')
  mocks.run.mockResolvedValue({ agents: 2, queued: 3, sent: 3, skipped: [] })
})

describe('KBOT scheduled message trigger', () => {
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

  it('runs the pass and reports what was queued and what was blocked', async () => {
    // The blocked list is the point of the report: a day with no messages has
    // to be explainable without reading logs.
    mocks.run.mockResolvedValue({ agents: 1, queued: 1, sent: 1, skipped: [
      { candidateId: 'birthday:c2', category: 'BIRTHDAY', reason: 'QUIET_HOURS', timeZone: 'America/Los_Angeles' },
    ] })
    const response = await POST(new Request('https://app.keepr.one/api/internal', {
      method: 'POST', headers: { authorization: 'Bearer configured' },
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ agents: 1, queued: 1, sent: 1, skipped: [
      { candidateId: 'birthday:c2', category: 'BIRTHDAY', reason: 'QUIET_HOURS', timeZone: 'America/Los_Angeles' },
    ] })
    expect(mocks.authorize).toHaveBeenCalledWith('Bearer configured')
  })

  it('reports failures without exposing database details', async () => {
    const failure = new Error('database credentials leaked here')
    mocks.run.mockRejectedValue(failure)
    const response = await POST(new Request('https://app.keepr.one/api/internal'))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'SCHEDULED_PASS_FAILED' })
    expect(mocks.captureException).toHaveBeenCalledWith(failure)
  })
})
