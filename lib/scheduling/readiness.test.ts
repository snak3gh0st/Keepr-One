import { describe, expect, it } from 'vitest'
import { evaluateSchedulingReadiness } from './readiness'

const connectedGoogle = {
  status: 'CONNECTED',
  grantedScopes: ['https://www.googleapis.com/auth/calendar.events.freebusy'],
  calendars: [{ visible: true, crmDefault: true, accessRole: 'owner' }],
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
})
