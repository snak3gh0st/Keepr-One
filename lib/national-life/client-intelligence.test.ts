import { describe, expect, it } from 'vitest'
import {
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
