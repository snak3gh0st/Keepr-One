import { describe, expect, it } from 'vitest'
import { isAnniversaryToday, scheduledCandidatesForDay, triggerZoneForPhone } from './scheduled-triggers'

// A 305 number is Eastern; a 415 number is Pacific. Both are unambiguous in the
// area-code table, so a test that cares about the zone gets the zone it asked
// for rather than the fallback band.
const eastern = '+13055550142'
const pacific = '+14155550142'

const client = (overrides: Partial<Parameters<typeof scheduledCandidatesForDay>[0]['clients'][number]> = {}) => ({
  id: 'c1', name: 'Ana', phone: eastern, dateOfBirth: new Date('1980-03-11T00:00:00Z'), ...overrides,
})

function run(overrides: Partial<Parameters<typeof scheduledCandidatesForDay>[0]> = {}) {
  return scheduledCandidatesForDay({
    clients: [client()], policies: [], now: new Date('2026-03-11T17:00:00Z'), ...overrides,
  })
}

describe('scheduledCandidatesForDay', () => {
  it('finds a birthday on the day and names the job for the year', () => {
    expect(run()).toEqual([expect.objectContaining({
      category: 'BIRTHDAY', clientId: 'c1', customerName: 'Ana', phone: eastern,
      requestKey: 'birthday:c1:2026', candidateId: 'birthday:c1', subjectKey: 'client:c1',
      localYear: 2026, timeZone: 'America/New_York',
    })])
  })

  it('stays silent on every other day of the year', () => {
    expect(run({ now: new Date('2026-03-10T17:00:00Z') })).toEqual([])
    expect(run({ now: new Date('2026-03-12T17:00:00Z') })).toEqual([])
  })

  it('produces the identical key twice on the same day, and a new one next year', () => {
    // This is the whole of idempotency: the key is a function of the client and
    // the local year, so a second pass writes the same row rather than a second
    // message. Nothing here depends on the hour the pass happened to run at.
    const morning = run({ now: new Date('2026-03-11T14:00:00Z') })
    const evening = run({ now: new Date('2026-03-11T23:00:00Z') })
    expect(morning[0].requestKey).toBe(evening[0].requestKey)
    expect(run({ now: new Date('2027-03-11T17:00:00Z') })[0].requestKey).toBe('birthday:c1:2027')
  })

  it('reads the date in the recipient zone, not in UTC', () => {
    // 05:00Z on the 12th is still 22:00 on the 11th in California. Judging this
    // in UTC would send Ana's greeting a day late — the failure that would hit
    // every western client in the book.
    const lateNightUtc = new Date('2026-03-12T05:00:00Z')
    expect(run({ clients: [client({ phone: pacific })], now: lateNightUtc })).toHaveLength(1)
    // The same instant is already 01:00 on the 12th in New York, so an Eastern
    // client whose birthday is the 11th has had their day pass.
    expect(run({ now: lateNightUtc })).toEqual([])
  })

  it('falls back to a single known zone when the area code says nothing', () => {
    expect(triggerZoneForPhone('+5511999990000')).toBe('America/New_York')
    expect(triggerZoneForPhone(null)).toBe('America/New_York')
  })

  it('observes a 29 February birthday on 28 February in a common year', () => {
    const leapling = [client({ dateOfBirth: new Date('1980-02-29T00:00:00Z') })]
    // 2026 is not a leap year: the greeting goes out on the 28th...
    expect(run({ clients: leapling, now: new Date('2026-02-28T17:00:00Z') })).toHaveLength(1)
    // ...and not on 1 March, which would arrive after their month was over.
    expect(run({ clients: leapling, now: new Date('2026-03-01T17:00:00Z') })).toEqual([])
    // 2028 is a leap year: the real day exists, so it is used and the 28th is
    // left alone.
    expect(run({ clients: leapling, now: new Date('2028-02-29T17:00:00Z') })).toHaveLength(1)
    expect(run({ clients: leapling, now: new Date('2028-02-28T17:00:00Z') })).toEqual([])
  })

  it('does not move a real 28 February birthday, in either kind of year', () => {
    const born28 = [client({ dateOfBirth: new Date('1980-02-28T00:00:00Z') })]
    expect(run({ clients: born28, now: new Date('2026-02-28T17:00:00Z') })).toHaveLength(1)
    expect(run({ clients: born28, now: new Date('2028-02-28T17:00:00Z') })).toHaveLength(1)
    expect(run({ clients: born28, now: new Date('2028-02-29T17:00:00Z') })).toEqual([])
  })

  it('treats a century year by the real rule, not by divisibility by four', () => {
    // 2100 is divisible by 4 and is still not a leap year.
    expect(isAnniversaryToday(new Date('1980-02-29T00:00:00Z'), { year: 2100, month: 2, day: 28 })).toBe(true)
    expect(isAnniversaryToday(new Date('1980-02-29T00:00:00Z'), { year: 2000, month: 2, day: 29 })).toBe(true)
    expect(isAnniversaryToday(new Date('1980-02-29T00:00:00Z'), { year: 2000, month: 2, day: 28 })).toBe(false)
  })

  it('raises an annual review on the policy issue date, from its own year', () => {
    const rows = scheduledCandidatesForDay({
      clients: [client({ dateOfBirth: null })],
      policies: [{ id: 'p1', clientId: 'c1', effectiveDate: new Date('2021-03-11T00:00:00Z') }],
      now: new Date('2026-03-11T17:00:00Z'),
    })
    expect(rows).toEqual([expect.objectContaining({
      category: 'ANNUAL_REVIEW', requestKey: 'annual-review:p1:2026',
      candidateId: 'annual-review:p1', sourceHref: '/agent/policies/p1',
    })])
  })

  it('does not call a policy due for review in the year it was issued', () => {
    expect(scheduledCandidatesForDay({
      clients: [client({ dateOfBirth: null })],
      policies: [{ id: 'p1', clientId: 'c1', effectiveDate: new Date('2026-03-11T00:00:00Z') }],
      now: new Date('2026-03-11T17:00:00Z'),
    })).toEqual([])
  })

  it('skips what it cannot reach or does not know', () => {
    expect(run({ clients: [client({ phone: null })] })).toEqual([])
    expect(run({ clients: [client({ dateOfBirth: null })] })).toEqual([])
    // A policy whose client is not in the book cannot be greeted.
    expect(scheduledCandidatesForDay({
      clients: [], policies: [{ id: 'p1', clientId: 'ghost', effectiveDate: new Date('2021-03-11T00:00:00Z') }],
      now: new Date('2026-03-11T17:00:00Z'),
    })).toEqual([])
  })

  it('can raise both categories for one client on a shared date', () => {
    // Same day, two reasons. The engine reports both; the send gate is what
    // decides that only one of them actually goes out.
    const rows = scheduledCandidatesForDay({
      clients: [client()],
      policies: [{ id: 'p1', clientId: 'c1', effectiveDate: new Date('2021-03-11T00:00:00Z') }],
      now: new Date('2026-03-11T17:00:00Z'),
    })
    expect(rows.map((row) => row.category)).toEqual(['ANNUAL_REVIEW', 'BIRTHDAY'])
  })
})
