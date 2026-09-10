import { describe, expect, it } from 'vitest'
import { leadQueryString, marketingLeadWhere, parseLeadFilters } from './filters'

const now = new Date('2026-09-11T12:00:00Z')
describe('marketing filters', () => {
  it('normalizes repeated, unknown, oversized, and invalid query parameters', () => {
    const value = parseLeadFilters({ q: ['  Alice ', 'Bob'], status: 'ADMIN', period: '365d', page: '-1', followup: 'anything' })
    expect(value).toEqual({ query: 'Alice', status: null, campaignId: null, ownerId: null, period: 'all', page: 1, followUp: 'all' })
    expect(parseLeadFilters({ q: 'x'.repeat(500), page: '9e99' }).query).toHaveLength(200)
    expect(parseLeadFilters({ page: '9007199254740992' }).page).toBe(1)
  })

  it('round trips all filters without losing the follow-up state', () => {
    const filters = parseLeadFilters(new URLSearchParams('q=Ana+%2B+Bob&status=QUALIFIED&campaign=founders-program&owner=none&period=30d&followup=overdue&page=2'))
    expect(parseLeadFilters(new URLSearchParams(leadQueryString(filters)))).toEqual(filters)
    expect(leadQueryString(filters, { query: '', page: 1 })).not.toMatch(/q=|page=/)
    expect(leadQueryString(parseLeadFilters({}))).toBe('')
  })

  it('builds exact campaign and owner filters, rolling date range and normalized phone search', () => {
    const where = marketingLeadWhere(parseLeadFilters(new URLSearchParams('q=(305)+555-0100&campaign=founders-program&owner=none&status=NEW&period=7d')), now)
    expect(where).toMatchObject({ campaignId: 'founders-program', ownerId: null, status: 'NEW', createdAt: { gte: new Date('2026-09-04T12:00:00Z') } })
    expect(where.OR).toContainEqual({ phone: { contains: '3055550100' } })
  })

  it('keeps user status and open-only follow-up restrictions as an intersection', () => {
    const filters = parseLeadFilters(new URLSearchParams('status=CONVERTED&followup=overdue'))
    expect(marketingLeadWhere(filters, now)).toEqual({
      status: 'CONVERTED', AND: [{ status: { notIn: ['CONVERTED', 'LOST'] } }], nextContactAt: { lt: now },
    })
    expect(marketingLeadWhere({ ...filters, status: null, followUp: 'scheduled' }, now)).toEqual({
      AND: [{ status: { notIn: ['CONVERTED', 'LOST'] } }], nextContactAt: { not: null },
    })
  })
})
