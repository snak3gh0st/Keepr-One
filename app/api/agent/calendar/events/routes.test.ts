import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireCalendarUser: vi.fn(),
  userFindUnique: vi.fn(),
  conflictPolicy: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  cancelEvent: vi.fn(),
  sameOrigin: vi.fn(),
}))

vi.mock('@/lib/calendar/google/route-auth', () => ({
  requireCalendarUser: mocks.requireCalendarUser,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}))
vi.mock('@/lib/calendar/conflicts', () => ({
  checkCalendarConflictPolicy: mocks.conflictPolicy,
}))
vi.mock('@/lib/calendar/repository', () => ({
  createCalendarEvent: mocks.createEvent,
  updateCalendarEvent: mocks.updateEvent,
  cancelCalendarEvent: mocks.cancelEvent,
  getCalendarEventsForRange: vi.fn(),
}))
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.sameOrigin,
}))

import { POST } from './route'
import { DELETE, PATCH } from './[id]/route'

const conflict = {
  ok: false as const,
  code: 'SCHEDULE_CONFLICT' as const,
  message: 'Já existe um compromisso nesse horário.',
  conflicts: [{ id: 'busy-1', title: 'Ocupado', startsAt: '2026-08-12T14:00:00.000Z', endsAt: '2026-08-12T14:30:00.000Z' }],
  conflictOverrideToken: 'signed-proof',
}

describe('calendar REST conflict guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireCalendarUser.mockResolvedValue({ userId: 'owner-1', sessionId: 'session-1' })
    mocks.userFindUnique.mockResolvedValue({ timeZone: 'America/New_York' })
    mocks.conflictPolicy.mockResolvedValue(conflict)
    mocks.cancelEvent.mockResolvedValue({ id: 'event-1', status: 'CANCELLED' })
  })

  it('guards POST server-side and returns the conflict proof without creating', async () => {
    const response = await POST(new Request('http://localhost/api/agent/calendar/events', {
      method: 'POST',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({
        title: 'Reunião',
        schedule: {
          allDay: false,
          startsAt: '2026-08-12T14:00:00.000Z',
          endsAt: '2026-08-12T14:30:00.000Z',
          timeZone: 'America/New_York',
        },
        allowConflict: true,
        conflictOverrideToken: 'client-token',
      }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual(conflict)
    expect(mocks.conflictPolicy).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', allowConflict: true, conflictOverrideToken: 'client-token',
    }))
    expect(mocks.createEvent).not.toHaveBeenCalled()
  })

  it('guards PATCH with the URL event id and owner before updating', async () => {
    const response = await PATCH(new Request('http://localhost/api/agent/calendar/events/event-1', {
      method: 'PATCH',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({
        baseRevision: 2,
        title: 'Novo título',
        schedule: {
          allDay: false,
          startsAt: '2026-08-12T14:00:00.000Z',
          endsAt: '2026-08-12T14:30:00.000Z',
          timeZone: 'America/New_York',
        },
      }),
    }), { params: Promise.resolve({ id: 'event-1' }) })

    expect(response.status).toBe(409)
    expect(mocks.conflictPolicy).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', eventId: 'event-1',
      schedule: expect.objectContaining({ allDay: false }),
      userTimeZone: 'America/New_York',
    }))
    expect(mocks.updateEvent).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', () => POST(new Request('http://localhost/api/agent/calendar/events', { method: 'POST' }))],
    ['PATCH', () => PATCH(new Request('http://localhost/api/agent/calendar/events/event-1', { method: 'PATCH' }), { params: Promise.resolve({ id: 'event-1' }) })],
    ['DELETE', () => DELETE(new Request('http://localhost/api/agent/calendar/events/event-1', { method: 'DELETE' }), { params: Promise.resolve({ id: 'event-1' }) })],
  ])('rejects cross-origin %s before authentication or mutation', async (_method, invoke) => {
    mocks.sameOrigin.mockImplementationOnce(() => { throw new Error('bad origin') })

    const response = await invoke()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'FORBIDDEN' })
    expect(mocks.requireCalendarUser).not.toHaveBeenCalled()
    expect(mocks.createEvent).not.toHaveBeenCalled()
    expect(mocks.updateEvent).not.toHaveBeenCalled()
    expect(mocks.cancelEvent).not.toHaveBeenCalled()
  })

  it('allows same-origin DELETE to reach the authenticated mutation', async () => {
    const response = await DELETE(new Request('http://localhost/api/agent/calendar/events/event-1', {
      method: 'DELETE',
      headers: { origin: 'http://localhost', host: 'localhost' },
      body: JSON.stringify({ baseRevision: 2, sendInvites: true }),
    }), { params: Promise.resolve({ id: 'event-1' }) })

    expect(response.status).toBe(200)
    expect(mocks.sameOrigin).toHaveBeenCalledOnce()
    expect(mocks.requireCalendarUser).toHaveBeenCalledOnce()
    expect(mocks.cancelEvent).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', eventId: 'event-1', baseRevision: 2, sendInvites: true,
    }))
  })
})
