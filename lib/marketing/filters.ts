import type { Prisma } from '@prisma/client'
import { LEAD_STATUSES, type LeadFilters, type LeadStatus } from './types'

type SearchParams = URLSearchParams | Record<string, string | string[] | undefined>
export const MARKETING_PAGE_SIZE = 25
export const MARKETING_EXPORT_LIMIT = 10_000

export function parseLeadFilters(params: SearchParams): LeadFilters {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? params.get(key) : params[key]
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
  }
  const status = get('status')
  const period = get('period')
  const followUp = get('followup')
  const rawPage = get('page')
  return {
    query: get('q').slice(0, 200),
    status: LEAD_STATUSES.includes(status as LeadStatus) ? status as LeadStatus : null,
    campaignId: get('campaign').slice(0, 100) || null,
    ownerId: get('owner').slice(0, 100) || null,
    period: period === '7d' || period === '30d' || period === '90d' ? period : 'all',
    followUp: followUp === 'overdue' || followUp === 'scheduled' ? followUp : 'all',
    page: /^\d+$/.test(rawPage) && Number.isSafeInteger(Number(rawPage)) ? Math.max(1, Number(rawPage)) : 1,
  }
}

/** Returns the encoded query string WITHOUT a leading ?, omitting default values. */
export function leadQueryString(filters: LeadFilters, overrides: Partial<LeadFilters> = {}): string {
  const value = { ...filters, ...overrides }
  const params = new URLSearchParams()
  if (value.query) params.set('q', value.query)
  if (value.status) params.set('status', value.status)
  if (value.campaignId) params.set('campaign', value.campaignId)
  if (value.ownerId) params.set('owner', value.ownerId)
  if (value.period !== 'all') params.set('period', value.period)
  if (value.followUp !== 'all') params.set('followup', value.followUp)
  if (value.page > 1) params.set('page', String(value.page))
  return params.toString()
}

/** Shared by the page and export so filters have identical semantics. */
export function marketingLeadWhere(filters: LeadFilters, now = new Date()): Prisma.MarketingLeadWhereInput {
  const where: Prisma.MarketingLeadWhereInput = {}
  if (filters.status) where.status = filters.status
  if (filters.campaignId) where.campaignId = filters.campaignId
  if (filters.ownerId) where.ownerId = filters.ownerId === 'none' ? null : filters.ownerId
  if (filters.period !== 'all') {
    const days = Number.parseInt(filters.period, 10)
    where.createdAt = { gte: new Date(now.getTime() - days * 86_400_000) }
  }
  if (filters.query) {
    where.OR = ['name', 'email', 'phone'].map((field) => ({
      [field]: { contains: filters.query, mode: 'insensitive' },
    }))
    const digits = filters.query.replace(/\D/g, '')
    if (digits.length >= 3 && /^[+\d\s().-]+$/.test(filters.query)) {
      where.OR.push({ phone: { contains: digits } })
    }
  }
  if (filters.followUp !== 'all') {
    where.AND = [{ status: { notIn: ['CONVERTED', 'LOST'] } }]
    where.nextContactAt = filters.followUp === 'overdue' ? { lt: now } : { not: null }
  }
  return where
}
