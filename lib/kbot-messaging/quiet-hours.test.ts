import { describe, expect, it } from 'vitest'
import {
  areaCodeFromPhone,
  timeZoneForPhone,
  withinSendWindow,
} from './quiet-hours'

describe('areaCodeFromPhone', () => {
  it('reads the area code from E.164 and from a bare national number', () => {
    expect(areaCodeFromPhone('+13055550142')).toBe('305')
    expect(areaCodeFromPhone('(305) 555-0142')).toBe('305')
  })

  it('refuses anything that is not a NANP number', () => {
    // A São Paulo mobile is 13 digits and must not be read as an area code.
    expect(areaCodeFromPhone('+5511987654321')).toBeNull()
    expect(areaCodeFromPhone('555-0142')).toBeNull()
    expect(areaCodeFromPhone(null)).toBeNull()
    // N9X and a leading 1 or 0 are not assignable area codes.
    expect(areaCodeFromPhone('+11955550142')).toBeNull()
    expect(areaCodeFromPhone('1155550142')).toBeNull()
  })
})

describe('timeZoneForPhone', () => {
  it('maps codes this table is sure of', () => {
    expect(timeZoneForPhone('+13055550142')).toBe('America/New_York')
    expect(timeZoneForPhone('+13125550142')).toBe('America/Chicago')
    expect(timeZoneForPhone('+16025550142')).toBe('America/Phoenix')
    expect(timeZoneForPhone('+14155550142')).toBe('America/Los_Angeles')
  })

  it('declines Alaska, where one area code covers two zones', () => {
    // 907 is all of Alaska, and Adak runs an hour behind Anchorage on
    // Hawaii-Aleutian time. Treating the code as Anchorage would call 08:00 in
    // Adak 09:00 and open the window an hour early there.
    expect(timeZoneForPhone('+19075550142')).toBeNull()
    expect(withinSendWindow('+19075550142', new Date('2026-01-15T18:00:00Z'))).toMatchObject({ derived: false })
  })

  it('declines codes that straddle a zone boundary', () => {
    // Florida's panhandle is Central while the rest of 850 is Eastern; Indiana,
    // the Dakotas and western Kansas split the same way. The fallback is the
    // honest answer, not a coin flip.
    expect(timeZoneForPhone('+18505550142')).toBeNull()
    expect(timeZoneForPhone('+13085550142')).toBeNull()
  })
})

describe('withinSendWindow', () => {
  // 2026-07-15T14:00:00Z is 10:00 EDT / 09:00 CDT / 07:00 PDT / 07:00 MST.
  const summerMorning = new Date('2026-07-15T14:00:00Z')

  it('allows a mid-morning message where the recipient actually is', () => {
    expect(withinSendWindow('+13055550142', summerMorning)).toMatchObject({ allowed: true, derived: true })
  })

  it('refuses the same instant for a recipient three hours behind', () => {
    // 07:00 in California is before the window opens, even though it is a
    // perfectly reasonable hour on the agent's own clock.
    expect(withinSendWindow('+14155550142', summerMorning)).toMatchObject({
      allowed: false,
      timeZone: 'America/Los_Angeles',
      derived: true,
    })
  })

  it('honours a zone that does not observe daylight saving', () => {
    // Phoenix stays on MST all year: 07:00 in July, when Denver is at 08:00.
    expect(withinSendWindow('+16025550142', summerMorning)).toMatchObject({ allowed: false })
    expect(withinSendWindow('+13035550142', summerMorning)).toMatchObject({ allowed: false })
    // 2026-01-15T16:00:00Z is 09:00 MST in Phoenix and 09:00 MST in Denver.
    const winterMorning = new Date('2026-01-15T16:00:00Z')
    expect(withinSendWindow('+16025550142', winterMorning)).toMatchObject({ allowed: true })
  })

  it('falls back to a band that is daytime coast to coast', () => {
    const unknown = '+18505550142'
    // 17:00Z is 13:00 EDT — inside the fallback band, and 10:00 in California.
    expect(withinSendWindow(unknown, new Date('2026-07-15T17:00:00Z'))).toMatchObject({
      allowed: true,
      timeZone: 'America/New_York',
      derived: false,
    })
    // 14:00Z is 10:00 EDT: fine on the East coast, 07:00 on the West, so the
    // fallback refuses it. The narrow band is the point.
    expect(withinSendWindow(unknown, summerMorning)).toMatchObject({ allowed: false, derived: false })
  })

  it('treats a non-US number as unknown rather than guessing', () => {
    expect(withinSendWindow('+5511987654321', summerMorning)).toMatchObject({ derived: false })
  })

  it('closes the window at the end hour, not after it', () => {
    // 23:00Z is 19:00 EDT (allowed) and 2026-07-16T00:00Z is 20:00 EDT (not).
    expect(withinSendWindow('+13055550142', new Date('2026-07-15T23:00:00Z'))).toMatchObject({ allowed: true })
    expect(withinSendWindow('+13055550142', new Date('2026-07-16T00:00:00Z'))).toMatchObject({ allowed: false })
  })
})
