import { describe, expect, it } from 'vitest'
import { availableCredits, normalizePhone, reasonFromStatus } from './domain'
import { formatCredits } from './credit-display'
import { composeMessage } from './generation'
import { providerOutcome, requestedOptOut } from './transport'

describe('follow-up contract', () => {
  it('never guesses a country code or accepts extensions', () => {
    expect(normalizePhone('(407) 555-0100')).toBeNull()
    expect(normalizePhone('+1 (407) 555-0100')).toBe('+14075550100')
    expect(normalizePhone('+14075550100 ext 9')).toBeNull()
    expect(normalizePhone('+000000000')).toBeNull()
  })
  it('preserves carrier pending lapse even when mapped in force', () => {
    expect(reasonFromStatus('INFORCE', 'Pending Lapse')).toBe('LAPSE_WARNING')
    expect(reasonFromStatus('INFORCE', 'In Force')).toBeNull()
    expect(reasonFromStatus('LAPSED', null)).toBe('LAPSED')
  })
  it('rounds only display and never understates the maximum reservation', () => {
    expect(formatCredits(671, 'pt-BR')).toBe('7')
    expect(formatCredits(1, 'en-US')).toBe('0')
    expect(formatCredits(1344, 'pt-BR', true)).toBe('14')
    expect(formatCredits(1344, 'pt-BR')).toBe('13')
    expect(availableCredits([{ allowance: 1000, reserved: 192, spent: 134 }])).toBe(674)
  })
  it('never claims provider delivery merely from gateway acceptance', () => {
    expect(providerOutcome({ id: 1, status: 'sent' })).toBeNull()
    expect(providerOutcome({ source_id: 'provider-1', status: 'sent' })).toBe('SENT')
    expect(providerOutcome({ status: 'failed' })).toBe('FAILED')
  })
  it('recognizes explicit opt-out only from incoming messages', () => {
    expect(requestedOptOut([{ message_type: 0, content: 'STOP' }])).toBe(true)
    expect(requestedOptOut([{ message_type: 1, content: 'STOP' }])).toBe(false)
  })
  it('keeps factual content controlled and avoids raw document details', () => {
    const text = composeMessage({ customerName: 'Ana <system>', agentName: 'Paulo', reason: 'REQUIREMENT', language: 'PT' }, { greeting: 'neutral', closing: 'talk' })
    expect(text).toContain('Ana!')
    expect(text).toContain('pendência')
    expect(text).not.toMatch(/system|\d|https|reativada/)
  })
})
