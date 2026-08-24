import { describe, expect, it } from 'vitest'
import { attendeeResponseCopy, calendarRescheduleCopy, calendarScheduleChanged, formatCalendarScheduleForTimeline } from './timeline'

describe('calendar timeline copy', () => {
  it('describes a timed reschedule from the previous instant to the next in the event timezone', () => {
    expect(calendarRescheduleCopy(
      { allDay: false, startsAt: new Date('2026-08-15T18:00:00.000Z'), endsAt: new Date('2026-08-15T19:00:00.000Z'), startDate: null, endDate: null, timeZone: 'America/New_York' },
      { allDay: false, startsAt: new Date('2026-08-16T19:00:00.000Z'), endsAt: new Date('2026-08-16T20:00:00.000Z'), startDate: null, endDate: null, timeZone: 'America/New_York' },
    )).toBe('De 15/08/2026, 14:00 para 16/08/2026, 15:00.')
  })

  it('keeps an all-day range readable while respecting the exclusive end date', () => {
    expect(formatCalendarScheduleForTimeline({
      allDay: true, startsAt: null, endsAt: null,
      startDate: new Date('2026-08-15T00:00:00.000Z'), endDate: new Date('2026-08-17T00:00:00.000Z'), timeZone: null,
    })).toBe('2026-08-15 a 2026-08-16 · dia inteiro')
  })

  it('distinguishes a real reschedule from a title-only update', () => {
    const previous = {
      allDay: false,
      startsAt: new Date('2026-08-15T18:00:00.000Z'),
      endsAt: new Date('2026-08-15T19:00:00.000Z'),
      startDate: null,
      endDate: null,
      timeZone: 'America/New_York',
    }
    expect(calendarScheduleChanged(previous, { ...previous })).toBe(false)
    expect(calendarScheduleChanged(previous, {
      ...previous,
      startsAt: new Date('2026-08-16T19:00:00.000Z'),
      endsAt: new Date('2026-08-16T20:00:00.000Z'),
    })).toBe(true)
  })

  it.each([
    ['ACCEPTED', 'ana@example.com confirmou presença.'],
    ['DECLINED', 'ana@example.com recusou o convite.'],
    ['TENTATIVE', 'ana@example.com respondeu talvez.'],
    ['NEEDS_ACTION', 'ana@example.com voltou a aguardar resposta.'],
  ] as const)('normalizes attendee response %s in Portuguese', (status, expected) => {
    expect(attendeeResponseCopy('ana@example.com', status)).toBe(expected)
  })
})
