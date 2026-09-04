import { describe, expect, it } from 'vitest'
import { evaluateSchedulingReadiness } from './readiness'

const connectedGoogle = {
  status: 'CONNECTED',
  grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
  calendars: [{ visible: true, crmDefault: true, accessRole: 'owner', providerCalendarId: 'primary@example.com' }],
}

describe('scheduling publication readiness', () => {
  it('fails closed when callers do not provide the e-mail state', () => {
    expect(evaluateSchedulingReadiness(connectedGoogle).canEnable).toBe(false)
  })

  it('requires confirmation e-mail delivery in addition to Google Calendar', () => {
    expect(evaluateSchedulingReadiness(connectedGoogle, false)).toEqual({
      googleConnected: true,
      freeBusyGranted: true,
      writableDefaultCalendar: true,
      confirmationEmailReady: false,
      canEnable: false,
    })
    expect(evaluateSchedulingReadiness(connectedGoogle, true).canEnable).toBe(true)
  })

  it('rejects a writable Google system calendar as the scheduling default', () => {
    expect(evaluateSchedulingReadiness({
      ...connectedGoogle,
      calendars: [{
        visible: true,
        crmDefault: true,
        accessRole: 'owner',
        providerCalendarId: 'en.usa#holiday@group.v.calendar.google.com',
      }],
    }, true)).toMatchObject({
      writableDefaultCalendar: false,
      canEnable: false,
    })
  })

  it('accepts a writable normal calendar as the scheduling default', () => {
    expect(evaluateSchedulingReadiness({
      ...connectedGoogle,
      calendars: [{
        visible: true,
        crmDefault: true,
        accessRole: 'writer',
        providerCalendarId: 'primary@example.com',
      }],
    }, true)).toMatchObject({
      writableDefaultCalendar: true,
      canEnable: true,
    })
  })
})
