import { describe, expect, it } from 'vitest'
import { hasCurrentKBotApplicationEntitlement } from './entitlement'

const now = new Date('2026-08-30T12:00:00.000Z')

describe('K-Bot Application entitlement', () => {
  it('grants only an active or trialing subscription inside its paid period', () => {
    expect(hasCurrentKBotApplicationEntitlement({
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
    }, now)).toBe(true)
    expect(hasCurrentKBotApplicationEntitlement({
      status: 'TRIALING',
      currentPeriodStart: null,
      currentPeriodEnd: null,
    }, now)).toBe(true)
  })

  it.each(['PAST_DUE', 'CANCELED', 'EXPIRED'] as const)('denies %s', (status) => {
    expect(hasCurrentKBotApplicationEntitlement({
      status,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    }, now)).toBe(false)
  })

  it('denies a subscription before or after its paid period', () => {
    expect(hasCurrentKBotApplicationEntitlement({
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: null,
    }, now)).toBe(false)
    expect(hasCurrentKBotApplicationEntitlement({
      status: 'ACTIVE',
      currentPeriodStart: null,
      currentPeriodEnd: now,
    }, now)).toBe(false)
  })

  it('fails closed when there is no add-on subscription', () => {
    expect(hasCurrentKBotApplicationEntitlement(null, now)).toBe(false)
  })
})
