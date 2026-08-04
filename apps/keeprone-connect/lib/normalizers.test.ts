import { describe, expect, it } from 'vitest'
import { normalizeInforceClient, normalizeNewBusiness, normalizeRows, stripMarkup } from './normalizers'

describe('browser-safe normalizers', () => {
  it('strips markup and maps new-business aliases without raw data', () => {
    const record = normalizeNewBusiness({
      PolicyNo: '<a>P-123</a>',
      InsuredOrAnnuitantName: '<strong>Ana&nbsp;Silva</strong>',
      AnticipatedAnnualPremiumDollarValue: '$1,200 &amp; bonus',
      AgentName: 'João',
    })

    expect(record).toMatchObject({
      policyNo: 'P-123',
      insuredName: 'Ana Silva',
      anticipatedAnnualPremium: '$1,200 & bonus',
      writingAgentName: 'João',
    })
    expect(record).not.toHaveProperty('raw')
    expect(JSON.stringify(record)).not.toMatch(/[<>]/)
  })

  it('maps inforce aliases and drops malformed emails', () => {
    const record = normalizeInforceClient({
      PolicyNo: 'I-9',
      PolStatus: '<span>Active</span>',
      AAP: '900',
      InsuredEmail: '<b>not-an-email</b>',
      OwnerEmail: 'owner@example.com',
    })

    expect(record).toMatchObject({
      policyNumber: 'I-9',
      policyStatus: 'Active',
      anticipatedAnnualPremium: '900',
      insuredEmail: null,
      ownerEmail: 'owner@example.com',
    })
  })

  it('deduplicates by policy key and rejects rows without one', () => {
    const records = normalizeRows('NEW_BUSINESS', [
      { PolicyNo: 'A', Status: 'one' },
      { PolicyNo: 'A', Status: 'two' },
      { Status: 'missing' },
    ])
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ policyNo: 'A', carrierStatus: 'one' })
  })

  it('removes tags, entities, null bytes, and angle brackets', () => {
    expect(stripMarkup('<p>A&amp;B &#60;tag&#62;\u0000</p>')).toBe('A&B tag')
  })
})
