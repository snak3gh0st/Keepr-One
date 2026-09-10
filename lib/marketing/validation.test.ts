import { describe, expect, it } from 'vitest'
import { bulkLeadSchema, campaignSchema, leadUpdateSchema, noteSchema } from './validation'
import { readLeadAttribution } from './attribution'

const campaign = { id: '', name: 'Founders Fall', description: '', channel: 'META_ADS', status: 'DRAFT', budget: '1500.50', startsAt: '2026-10-01', endsAt: '2026-10-31' }
describe('marketing validation', () => {
  it('normalizes campaign budget to integer cents and dates to UTC', () => {
    expect(campaignSchema.parse(campaign)).toMatchObject({ id: null, description: null, budget: 150050, startsAt: new Date('2026-10-01T00:00:00Z') })
    expect(campaignSchema.parse({ ...campaign, budget: '0', startsAt: '', endsAt: '' })).toMatchObject({ budget: 0, startsAt: null, endsAt: null })
  })
  it.each(['-1', '12.345', '1e5', 'Infinity', '21474836.48', 'abc'])('rejects invalid or overflowing budget %s', (budget) => {
    expect(campaignSchema.safeParse({ ...campaign, budget }).success).toBe(false)
  })
  it.each([
    { startsAt: '2026-02-30' }, { startsAt: '2026-10-02', endsAt: '2026-10-01' }, { endsAt: '2026-10-01T13:00Z' },
  ])('rejects invalid and backwards campaign dates %j', (dates) => {
    expect(campaignSchema.safeParse({ ...campaign, ...dates }).success).toBe(false)
  })
  it('requires a timezone for follow-ups and rejects invalid dates', () => {
    const base = { id: 'lead-1', status: 'CONTACTED', ownerId: '' }
    expect(leadUpdateSchema.parse({ ...base, nextContactAt: '2026-09-15T10:30:00-04:00' }).nextContactAt).toEqual(new Date('2026-09-15T14:30:00Z'))
    expect(leadUpdateSchema.safeParse({ ...base, nextContactAt: '2026-09-15T10:30' }).success).toBe(false)
    expect(leadUpdateSchema.parse({ ...base, nextContactAt: '' })).toMatchObject({ ownerId: null, nextContactAt: null })
  })
  it('bounds bulk updates and notes and deduplicates IDs', () => {
    expect(bulkLeadSchema.parse({ ids: ['lead-1', 'lead-1'], status: 'NEW' }).ids).toEqual(['lead-1'])
    expect(bulkLeadSchema.safeParse({ ids: Array(101).fill('lead-1'), status: 'NEW' }).success).toBe(false)
    expect(bulkLeadSchema.safeParse({ ids: [], status: 'NEW' }).success).toBe(false)
    expect(noteSchema.safeParse({ leadId: 'lead-1', body: ' ' }).success).toBe(false)
    expect(noteSchema.safeParse({ leadId: 'lead-1', body: 'x'.repeat(4001) }).success).toBe(false)
  })
})

describe('public lead attribution', () => {
  it('limits metadata, removes control characters and accepts only campaign slugs', () => {
    const form = new FormData()
    form.set('marketing_campaign', 'http://outside.test')
    form.set('utm_source', ' meta\n\u0000 ')
    form.set('utm_content', 'x'.repeat(500))
    form.set('utm_medium', new File(['evil'], 'evil.txt'))
    expect(readLeadAttribution(form)).toEqual({ campaignSlug: null, utmSource: 'meta', utmMedium: null, utmCampaign: null, utmContent: 'x'.repeat(200), utmTerm: null })
  })
})
