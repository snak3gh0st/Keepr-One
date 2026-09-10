import { describe, expect, it } from 'vitest'
import {
  clientNamesAgree,
  planClientContactBackfill,
  samePhoneNumber,
  type ContactBackfillClient,
} from './client-contact-backfill'
import type { ClientServiceEvent } from './client-intelligence'

function serviceEvent(input: Partial<ClientServiceEvent> = {}): ClientServiceEvent {
  return {
    id: 'row-1',
    policyNumber: '766815100',
    customerName: 'ELIZA YAMANAKA',
    email: 'eliza@example.com',
    phone: '(305) 555-0142',
    category: 'Client Service',
    reason: 'Client Birthday Coming up in next 7 days',
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
    agentName: 'Paulo',
    description: null,
    signal: 'OPPORTUNITY',
    ...input,
  }
}

function client(input: Partial<ContactBackfillClient> = {}): ContactBackfillClient {
  return { id: 'c1', name: 'Eliza Saeko Yamanaka', email: null, phone: null, ...input }
}

const policies = [{ policyNumber: '766815100', clientId: 'c1' }]

describe('clientNamesAgree', () => {
  it('accepts a dropped middle name and a suffix the CRM never recorded', () => {
    expect(clientNamesAgree('ELIZA YAMANAKA', 'Eliza Saeko Yamanaka')).toBe(true)
    expect(clientNamesAgree('ANTONIO FONTES BARROS JR', 'Antonio Fontes Barros')).toBe(true)
    expect(clientNamesAgree('  maria   silva ', 'Maria Silva')).toBe(true)
    expect(clientNamesAgree('MARIA SILVA', 'Maria Silva Santos')).toBe(true)
  })

  it('rejects names that share no surname, and a missing name', () => {
    expect(clientNamesAgree('JOHN SMITH', 'John Jones')).toBe(false)
    expect(clientNamesAgree('JOHN SMITH', 'Mary Smith')).toBe(false)
    expect(clientNamesAgree(null, 'Eliza Saeko Yamanaka')).toBe(false)
  })
})

describe('samePhoneNumber', () => {
  it('sees through the country code one side carries and the other omits', () => {
    expect(samePhoneNumber('+13055550142', '(305) 555-0142')).toBe(true)
    expect(samePhoneNumber('+5511987654321', '(11) 98765-4321')).toBe(true)
    expect(samePhoneNumber('+13055550142', '+13055550142')).toBe(true)
  })

  it('does not fuse two different lines, or anything without digits', () => {
    expect(samePhoneNumber('+13055550142', '(305) 555-9999')).toBe(false)
    // A short extension is not evidence: `0142` is a suffix of far too much.
    expect(samePhoneNumber('+13055550142', '0142')).toBe(false)
    expect(samePhoneNumber('+13055550142', '   ')).toBe(false)
    expect(samePhoneNumber(null, '(305) 555-0142')).toBe(false)
  })
})

describe('planClientContactBackfill', () => {
  it('fills both gaps for the client the policy number resolves to', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent()],
      policies,
      clients: [client()],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([
      { clientId: 'c1', email: 'eliza@example.com', phone: '(305) 555-0142' },
    ])
  })

  it('joins across the padding the carrier adds to a policy number', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent({ policyNumber: '00766815100' })],
      policies,
      clients: [client()],
      agentPhones: [],
    })

    expect(plan.contacts).toHaveLength(1)
  })

  it('never matches by name: an unknown policy number contributes nothing', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent({ policyNumber: 'LS0648595' })],
      policies,
      clients: [client()],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([])
    expect(plan.skipped.unmatchedPolicy).toBe(1)
  })

  it('drops a policy number that resolves to two different clients', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent()],
      policies: [...policies, { policyNumber: '766815100', clientId: 'c2' }],
      clients: [client(), client({ id: 'c2' })],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([])
  })

  it('discards the agent own line and keeps the email', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent()],
      policies,
      clients: [client()],
      // Stored E.164, logged by the grid in the carrier's own formatting.
      agentPhones: ['+13055550142'],
    })

    expect(plan.contacts).toEqual([
      { clientId: 'c1', email: 'eliza@example.com', phone: null },
    ])
    expect(plan.skipped.agentOwnPhone).toBe(1)
  })

  it('discards a row whose customer is plainly another person', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent({ customerName: 'ROBERTO ALMEIDA' })],
      policies,
      clients: [client()],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([])
    expect(plan.skipped.nameMismatch).toBe(1)
  })

  it('leaves a field the agent already filled alone', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent()],
      policies,
      clients: [client({ phone: '+13051112222' })],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([
      { clientId: 'c1', email: 'eliza@example.com', phone: null },
    ])
  })

  it('plans nothing when both fields are already filled', () => {
    const plan = planClientContactBackfill({
      events: [serviceEvent()],
      policies,
      clients: [client({ email: 'typed@example.com', phone: '+13051112222' })],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([])
  })

  it('writes once for a client with several service rows, newest value first', () => {
    const plan = planClientContactBackfill({
      events: [
        serviceEvent({ id: 'row-2', phone: '(305) 555-9999', email: null }),
        serviceEvent({ id: 'row-1' }),
      ],
      policies,
      clients: [client()],
      agentPhones: [],
    })

    expect(plan.contacts).toEqual([
      { clientId: 'c1', email: 'eliza@example.com', phone: '(305) 555-9999' },
    ])
  })
})
