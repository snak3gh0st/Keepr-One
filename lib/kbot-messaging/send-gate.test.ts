import { describe, expect, it } from 'vitest'
import { evaluateSendGate, RECENCY_WINDOW_MS } from './send-gate'

// 17:00Z is 13:00 in New York — inside the send window for a 305 number and
// inside the coast-to-coast fallback band too, so the hour never decides a
// test unless the test is about the hour.
const now = new Date('2026-07-15T17:00:00Z')
const phone = '+13055550142'

function gate(overrides: Partial<Parameters<typeof evaluateSendGate>[0]> = {}) {
  return evaluateSendGate({
    phone,
    preferences: [],
    recentJobs: [],
    now,
    enforceQuietHours: true,
    // Estes testes antigos não são sobre habilitação; mantêm o comportamento
    // anterior à mudança de padrão.
    requireEnabled: false,
    ...overrides,
  })
}

describe('evaluateSendGate', () => {
  it('allows a message to a reachable contact at a reasonable hour', () => {
    expect(gate()).toMatchObject({ allowed: true, reason: null })
  })

  it('refuses a contact who opted out, whichever key carries the preference', () => {
    expect(gate({ preferences: [{ optedOut: true }] })).toMatchObject({ reason: 'OPTED_OUT' })
    expect(gate({ preferences: [{}, { optedOut: true }] })).toMatchObject({ reason: 'OPTED_OUT' })
  })

  it('reports opt-out ahead of every other block', () => {
    // Someone who asked to stop is not "snoozed" or "recently contacted": the
    // reason the agent sees has to be the one that matters.
    const decision = gate({
      preferences: [{ optedOut: true, snoozedUntil: new Date(now.getTime() + 1000), lastManualAt: now }],
    })
    expect(decision.reason).toBe('OPTED_OUT')
  })

  it('respects a snooze until it expires', () => {
    expect(gate({ preferences: [{ snoozedUntil: new Date(now.getTime() + 1000) }] })).toMatchObject({ reason: 'SNOOZED' })
    expect(gate({ preferences: [{ snoozedUntil: new Date(now.getTime() - 1000) }] })).toMatchObject({ allowed: true })
  })

  it('counts a message of any category against the weekly window', () => {
    // The birthday greeting and the lapse warning are different features that
    // reach the same phone. This is the check that makes them see each other.
    const yesterday = new Date(now.getTime() - 86_400_000)
    expect(gate({ recentJobs: [{ sentAt: yesterday }] })).toMatchObject({ reason: 'RECENT_CONTACT' })
  })

  it('lets the window expire exactly once, not a moment early', () => {
    const justInside = new Date(now.getTime() - RECENCY_WINDOW_MS + 1000)
    const justOutside = new Date(now.getTime() - RECENCY_WINDOW_MS - 1000)
    expect(gate({ recentJobs: [{ sentAt: justInside }] })).toMatchObject({ reason: 'RECENT_CONTACT' })
    expect(gate({ recentJobs: [{ sentAt: justOutside }] })).toMatchObject({ allowed: true })
  })

  it('counts a conversation the agent had by hand', () => {
    expect(gate({ preferences: [{ lastManualAt: new Date(now.getTime() - 86_400_000) }] }))
      .toMatchObject({ reason: 'RECENT_CONTACT' })
  })

  it('refuses a scheduled send at the wrong hour where the recipient is', () => {
    // 07:00 in California, from a number whose area code says California.
    const decision = evaluateSendGate({
      phone: '+14155550142',
      preferences: [],
      recentJobs: [],
      now: new Date('2026-07-15T14:00:00Z'),
      enforceQuietHours: true,
      requireEnabled: false,
    })
    expect(decision).toMatchObject({ reason: 'QUIET_HOURS' })
    expect(decision.quietHours).toMatchObject({ timeZone: 'America/Los_Angeles', derived: true })
  })

  it('leaves the hour to the agent when a human is pressing send', () => {
    const decision = evaluateSendGate({
      phone: '+14155550142',
      preferences: [],
      recentJobs: [],
      now: new Date('2026-07-15T14:00:00Z'),
      enforceQuietHours: false,
      requireEnabled: false,
    })
    expect(decision).toMatchObject({ allowed: true, quietHours: null })
  })

  it('still refuses an opted-out contact when the hour is not enforced', () => {
    expect(gate({ preferences: [{ optedOut: true }], enforceQuietHours: false })).toMatchObject({ reason: 'OPTED_OUT' })
  })
})

describe('habilitação por contato', () => {
  const base = { phone: '+5511999990000', recentJobs: [], now: new Date('2026-09-12T15:00:00.000Z') }

  it('barra o envio automático de quem nunca foi ligado', () => {
    const decision = evaluateSendGate({ ...base, preferences: [], requireEnabled: true, enforceQuietHours: false })

    expect(decision).toMatchObject({ allowed: false, reason: 'NOT_ENABLED' })
  })

  it('libera quem o agente ligou', () => {
    const decision = evaluateSendGate({
      ...base,
      preferences: [{ kbotEnabledAt: new Date('2026-09-10T00:00:00.000Z') }],
      requireEnabled: true,
      enforceQuietHours: false,
    })

    expect(decision).toMatchObject({ allowed: true, reason: null })
  })

  it('o pedido do cliente vence a habilitação do agente', () => {
    const decision = evaluateSendGate({
      ...base,
      preferences: [{ optedOut: true, kbotEnabledAt: new Date('2026-09-10T00:00:00.000Z') }],
      requireEnabled: true,
      enforceQuietHours: false,
    })

    expect(decision).toMatchObject({ allowed: false, reason: 'OPTED_OUT' })
  })

  it('não barra o envio manual do agente por falta de habilitação', () => {
    const decision = evaluateSendGate({ ...base, preferences: [], requireEnabled: false, enforceQuietHours: false })

    expect(decision).toMatchObject({ allowed: true, reason: null })
  })
})
