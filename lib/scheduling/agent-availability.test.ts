import { describe, expect, it, vi } from 'vitest'
import { getNextSchedulingSlotsForAgent } from './agent-availability'
import { GOOGLE_CALENDAR_OPTIONAL_SCOPES } from '@/lib/calendar/constants'

const NOW = new Date('2026-08-16T12:00:00.000Z')

function pageRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'page-1',
    ownerUserId: 'owner-1',
    slug: 'maria-silva',
    enabled: true,
    title: 'Conversa inicial',
    description: 'Escolha o melhor horário.',
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 0,
    maximumAdvanceDays: 60,
    weeklyWindows: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
    ownerUser: {
      name: 'Maria Silva',
      language: 'PT',
      timeZone: 'America/New_York',
      agent: { status: 'ACTIVE' },
      calendarIntegrations: [{
        status: 'CONNECTED',
        grantedScopes: [GOOGLE_CALENDAR_OPTIONAL_SCOPES[0]],
        calendars: [{ visible: true, crmDefault: true, accessRole: 'owner', providerCalendarId: 'primary@example.com' }],
      }],
    },
    ...overrides,
  }
}

/**
 * The resolver and `getPublicSchedulingPage` both hit `schedulingPage.findUnique`
 * — one by ownerUserId, one by slug. The fake branches on `where` so each lookup
 * stays independently controllable.
 */
function dependencies(options: {
  agent?: unknown
  record?: unknown
} = {}) {
  const record = 'record' in options ? options.record : pageRecord()
  const agentRow = 'agent' in options
    ? options.agent
    : { user: { timeZone: 'America/New_York', schedulingPage: { slug: 'maria-silva' } } }
  const agentFindUnique = vi.fn(async () => agentRow)
  const pageFindUnique = vi.fn(async (args: { where: { slug?: string; ownerUserId?: string } }) =>
    args.where.slug ? record : null,
  )
  return {
    agentFindUnique,
    pageFindUnique,
    db: {
      agent: { findUnique: agentFindUnique },
      schedulingPage: { findUnique: pageFindUnique },
      schedulingBooking: { findMany: vi.fn(async () => []) },
    } as never,
    now: NOW,
    getEvents: vi.fn(async () => []),
    getFreeBusy: vi.fn(async () => ({ connected: true, intervals: [] })),
    getGoogleEnv: vi.fn(() => ({} as never)),
    confirmationEmailReady: true,
  }
}

describe('agent scheduling availability', () => {
  it('resolves the slug from the agent and returns the next free slots', async () => {
    const deps = dependencies()

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1', limit: 3 }, deps)

    expect(result.available).toBe(true)
    if (!result.available) throw new Error('esperava disponibilidade')
    expect(deps.agentFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'agent-1' },
    }))
    expect(deps.pageFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: 'maria-silva' },
    }))
    expect(result.slug).toBe('maria-silva')
    expect(result.page.ownerName).toBe('Maria Silva')
    expect(result.slots).toHaveLength(3)
    expect(result.slots[0]).toEqual({
      startsAt: '2026-08-17T13:00:00.000Z',
      endsAt: '2026-08-17T13:30:00.000Z',
    })
  })

  it('caps the returned slots at the requested limit', async () => {
    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1', limit: 1 }, dependencies())

    expect(result).toMatchObject({ available: true })
    if (!result.available) throw new Error('esperava disponibilidade')
    expect(result.slots).toHaveLength(1)
  })

  it('reports an unknown agent instead of guessing an agenda', async () => {
    const deps = dependencies({ agent: null })

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'ghost' }, deps)

    expect(result).toEqual({ available: false, reason: 'AGENT_NOT_FOUND' })
    expect(deps.getFreeBusy).not.toHaveBeenCalled()
  })

  it('tells the caller apart when the agent never configured a scheduling page', async () => {
    const deps = dependencies({
      agent: { user: { timeZone: 'America/New_York', schedulingPage: null } },
    })

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1' }, deps)

    expect(result).toEqual({ available: false, reason: 'NO_SCHEDULING_PAGE' })
    expect(deps.pageFindUnique).not.toHaveBeenCalled()
    expect(deps.getFreeBusy).not.toHaveBeenCalled()
  })

  it('offers nothing while the scheduling page is disabled', async () => {
    const result = await getNextSchedulingSlotsForAgent(
      { agentId: 'agent-1' },
      dependencies({ record: pageRecord({ enabled: false }) }),
    )

    expect(result).toEqual({ available: false, reason: 'SCHEDULING_PAGE_DISABLED' })
    expect(result).not.toHaveProperty('slots')
  })

  it('offers nothing while the agent account is not ACTIVE', async () => {
    const result = await getNextSchedulingSlotsForAgent(
      { agentId: 'agent-1' },
      dependencies({
        record: pageRecord({
          ownerUser: { ...pageRecord().ownerUser, agent: { status: 'SUSPENDED' } },
        }),
      }),
    )

    expect(result).toEqual({ available: false, reason: 'SCHEDULING_PAGE_DISABLED' })
    expect(result).not.toHaveProperty('slots')
  })

  it('never falls back to the weekly windows when the Google connection needs a reconnect', async () => {
    const deps = dependencies({
      record: pageRecord({
        ownerUser: {
          ...pageRecord().ownerUser,
          calendarIntegrations: [{
            ...pageRecord().ownerUser.calendarIntegrations[0],
            status: 'RECONNECT_REQUIRED',
          }],
        },
      }),
    })

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1' }, deps)

    expect(result).toEqual({ available: false, reason: 'SCHEDULING_UNAVAILABLE' })
    expect(result).not.toHaveProperty('slots')
    expect(deps.getFreeBusy).not.toHaveBeenCalled()
  })

  it('never falls back to the weekly windows when free/busy reports a broken connection', async () => {
    const deps = dependencies()
    deps.getFreeBusy.mockResolvedValueOnce({ connected: false, intervals: [] })

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1' }, deps)

    expect(result).toEqual({ available: false, reason: 'SCHEDULING_UNAVAILABLE' })
    expect(result).not.toHaveProperty('slots')
  })

  it('never falls back to the weekly windows when the Google call fails', async () => {
    const deps = dependencies()
    deps.getFreeBusy.mockRejectedValueOnce(new Error('google offline'))

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1' }, deps)

    expect(result).toEqual({ available: false, reason: 'SCHEDULING_UNAVAILABLE' })
    expect(result).not.toHaveProperty('slots')
  })

  it('propagates an invalid range instead of blaming the calendar integration', async () => {
    await expect(getNextSchedulingSlotsForAgent(
      { agentId: 'agent-1', days: 400 },
      dependencies(),
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('keeps the default ceiling when the limit is not a finite number', async () => {
    const result = await getNextSchedulingSlotsForAgent(
      { agentId: 'agent-1', limit: Number.NaN },
      dependencies(),
    )

    expect(result).toMatchObject({ available: true })
    if (!result.available) throw new Error('esperava disponibilidade')
    // Two Mondays fall inside the default 14-day range, four slots each.
    expect(result.slots).toHaveLength(8)
  })

  it('propagates unexpected failures instead of flattening them into "no times"', async () => {
    const deps = dependencies()
    deps.agentFindUnique.mockRejectedValueOnce(new Error('database offline'))

    await expect(getNextSchedulingSlotsForAgent({ agentId: 'agent-1' }, deps))
      .rejects.toThrow('database offline')
  })

  it('returns an empty agenda as availability, not as a missing page', async () => {
    const deps = dependencies()
    deps.getFreeBusy.mockResolvedValueOnce({
      connected: true,
      intervals: [{
        calendarSourceId: 'calendar-1',
        providerCalendarId: 'primary',
        start: new Date('2026-08-17T00:00:00.000Z'),
        end: new Date('2026-09-30T00:00:00.000Z'),
      }],
    } as never)

    const result = await getNextSchedulingSlotsForAgent({ agentId: 'agent-1' }, deps)

    expect(result).toMatchObject({ available: true })
    if (!result.available) throw new Error('esperava disponibilidade')
    expect(result.slots).toEqual([])
  })
})
