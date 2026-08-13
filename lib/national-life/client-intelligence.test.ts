import { describe, expect, it } from 'vitest'
import {
  buildClientActionQueue,
  classifySignal,
  stripMarkup,
  toClientServiceEvent,
  toClientServiceEvents,
} from './client-intelligence'

describe('stripMarkup', () => {
  it('pulls the policy number out of the anchor the grid returns', () => {
    expect(
      stripMarkup('<a href="/agent/.../policy-details?id=abc" >766815100</a>'),
    ).toBe('766815100')
  })

  it('turns the line breaks in a call note into spaces', () => {
    expect(stripMarkup('Policy no: 1<br/><br/>Caller: X')).toBe('Policy no: 1 Caller: X')
  })

  it('reports an empty field as absent rather than as an empty string', () => {
    expect(stripMarkup('<div>  </div>')).toBeNull()
    expect(stripMarkup(null)).toBeNull()
  })
})

describe('classifySignal', () => {
  it('flags a client asking to surrender', () => {
    expect(classifySignal('Surrender Request', 'Client Service')).toBe('AT_RISK')
  })

  // The carrier files this under Payments, which is true and useless: a drafted
  // payment and a failed one are both payments.
  it('flags a failed payment even though the carrier calls it a payment', () => {
    expect(classifySignal('EftFailure', 'Payments')).toBe('AT_RISK')
  })

  it('trusts the carrier when it files something as conservation', () => {
    expect(classifySignal('Some reason we have never seen', 'Conservation')).toBe('AT_RISK')
  })

  it('marks a birthday as a reason to call, not a problem', () => {
    expect(classifySignal('Client Birthday Coming up in next 7 days', 'Life Event')).toBe(
      'OPPORTUNITY',
    )
  })

  it('leaves an ordinary payment alone', () => {
    expect(classifySignal('Customer EFT Payment Drafted', 'Payments')).toBe('ROUTINE')
  })
})

describe('toClientServiceEvent', () => {
  const raw = {
    PolicyNumber: '766815100',
    CustomerName: 'Barbara De Silva',
    EmailAddress: 'someone@example.com',
    PhoneNumber: '+12035450856',
    Category: '<div class="sub-cat-conservation"><span>Conservation</span></div>\r\n',
    CallReason: 'Surrender Inquiry',
    CaseDate: '2026-07-30T13:10:24.02',
    CreatedDate: '07/30/2026',
    AgentName: 'Milena Pires',
    Description: 'The customer called to confirm the cancellation.',
  }

  it('reads the contact the inforce book does not carry', () => {
    const event = toClientServiceEvent({ id: 'row-1', raw })
    expect(event.email).toBe('someone@example.com')
    expect(event.phone).toBe('+12035450856')
    expect(event.category).toBe('Conservation')
    expect(event.signal).toBe('AT_RISK')
  })

  it('does not treat a non-address as an email', () => {
    const event = toClientServiceEvent({ id: 'row-1', raw: { ...raw, EmailAddress: 'N/A' } })
    expect(event.email).toBeNull()
  })

  it('reads the date the carrier sends as MM/DD/YYYY', () => {
    const event = toClientServiceEvent({
      id: 'row-1',
      raw: { ...raw, CaseDate: null, CreatedDate: '07/30/2026' },
    })
    expect(event.occurredAt?.toISOString()).toBe('2026-07-30T00:00:00.000Z')
  })
})

describe('toClientServiceEvents', () => {
  const base = { CallReason: 'Payment Inquiry', Category: 'Payments' }

  it('puts the most recent contact first', () => {
    const events = toClientServiceEvents([
      { id: 'old', raw: { ...base, CreatedDate: '01/02/2026' } },
      { id: 'new', raw: { ...base, CreatedDate: '07/30/2026' } },
    ])
    expect(events.map((event) => event.id)).toEqual(['new', 'old'])
  })

  // An undated event sorting to 1970 would land at the top of a descending list
  // and read as the latest thing that happened to the client.
  it('sorts an undated contact last instead of oldest', () => {
    const events = toClientServiceEvents([
      { id: 'undated', raw: base },
      { id: 'dated', raw: { ...base, CreatedDate: '01/02/2026' } },
    ])
    expect(events.map((event) => event.id)).toEqual(['dated', 'undated'])
  })
})

describe('buildClientActionQueue', () => {
  const event = (
    id: string,
    policyNumber: string,
    signal: 'AT_RISK' | 'OPPORTUNITY' | 'ROUTINE',
    occurredAt: string,
    extra: Partial<ReturnType<typeof toClientServiceEvent>> = {},
  ) => ({
    id,
    policyNumber,
    customerName: 'Client',
    email: null,
    phone: null,
    category: 'Payments',
    reason: signal === 'AT_RISK' ? 'EftFailure' : 'Policy Anniversary',
    occurredAt: new Date(occurredAt),
    agentName: null,
    description: null,
    signal,
    ...extra,
  })

  it('returns one prioritized action per policy inside the requested window', () => {
    const queue = buildClientActionQueue(
      [
        event('opportunity', 'POL-1', 'OPPORTUNITY', '2026-08-12T12:00:00.000Z'),
        event('risk', 'POL-1', 'AT_RISK', '2026-08-10T12:00:00.000Z'),
        event('routine', 'POL-2', 'ROUTINE', '2026-08-12T12:00:00.000Z'),
        event('old', 'POL-3', 'AT_RISK', '2026-06-01T12:00:00.000Z'),
      ],
      { asOf: new Date('2026-08-13T15:00:00.000Z'), windowDays: 30 },
    )

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ policyNumber: 'POL-1', signal: 'AT_RISK', eventCount: 2 })
  })

  it('uses the newest available contact without weakening the selected signal', () => {
    const queue = buildClientActionQueue(
      [
        event('risk', 'POL-1', 'AT_RISK', '2026-08-10T12:00:00.000Z'),
        event('contact', 'POL-1', 'OPPORTUNITY', '2026-08-12T12:00:00.000Z', {
          email: 'client@example.com',
          phone: '+15551234567',
        }),
      ],
      { asOf: new Date('2026-08-13T15:00:00.000Z') },
    )

    expect(queue[0]).toMatchObject({
      signal: 'AT_RISK',
      email: 'client@example.com',
      phone: '+15551234567',
    })
  })

  it('does not include future-dated carrier events', () => {
    const queue = buildClientActionQueue(
      [event('future', 'POL-1', 'AT_RISK', '2026-08-14T12:00:00.000Z')],
      { asOf: new Date('2026-08-13T15:00:00.000Z') },
    )

    expect(queue).toEqual([])
  })
})
