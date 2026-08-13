import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCalendarUser: vi.fn(),
  setCalendarPreferences: vi.fn(),
  sameOrigin: vi.fn(),
}))

vi.mock('@/lib/calendar/google/route-auth', () => ({ requireCalendarUser: mocks.requireCalendarUser }))
vi.mock('@/lib/calendar/repository', () => ({
  getCalendarConnectionForUser: vi.fn(),
  setCalendarPreferences: mocks.setCalendarPreferences,
}))
vi.mock('@/lib/security/same-origin-action', () => ({ assertSameOriginAction: mocks.sameOrigin }))

import { PATCH } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCalendarUser.mockResolvedValue({ userId: 'owner-1' })
  mocks.setCalendarPreferences.mockResolvedValue({ id: 'integration-1' })
})

describe('calendar preferences same-origin boundary', () => {
  it('rejects cross-origin before authentication or storage', async () => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('bad origin') })
    const response = await PATCH(new Request('https://app.keepr.one/api/agent/calendar/calendars', { method: 'PATCH' }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'FORBIDDEN' })
    expect(mocks.requireCalendarUser).not.toHaveBeenCalled()
    expect(mocks.setCalendarPreferences).not.toHaveBeenCalled()
  })

  it('allows same-origin preferences update', async () => {
    const response = await PATCH(new Request('https://app.keepr.one/api/agent/calendar/calendars', {
      method: 'PATCH',
      headers: { origin: 'https://app.keepr.one', host: 'app.keepr.one' },
      body: JSON.stringify({ visibleCalendarIds: ['calendar-1'], crmDefaultCalendarId: 'calendar-1' }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.setCalendarPreferences).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', visibleCalendarIds: ['calendar-1'], crmDefaultCalendarId: 'calendar-1',
    })
  })
})
