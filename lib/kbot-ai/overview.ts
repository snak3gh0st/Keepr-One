export const AI_PERIODS = ['month', '7d', '30d'] as const
export type AiPeriod = typeof AI_PERIODS[number]
export const AI_FILTERS = ['all', 'working', 'attention', 'completed'] as const
export type AiFilter = typeof AI_FILTERS[number]
export const AI_PAGE_SIZE = 20
export const WORKING_STATUSES = ['PENDING', 'PREPARING', 'DISPATCHING', 'ACCEPTED', 'CANCEL_REQUESTED']
export const ATTENTION_STATUSES = ['UNKNOWN', 'FAILED']
export const CONFIRMED_STATUSES = ['SENT', 'DELIVERED', 'READ']

export function periodStart(period: AiPeriod, now: Date) {
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (period === '7d' ? 6 : 29)))
}

export function filterStatuses(filter: AiFilter): string[] | undefined {
  if (filter === 'working') return WORKING_STATUSES
  if (filter === 'attention') return ATTENTION_STATUSES
  if (filter === 'completed') return [...CONFIRMED_STATUSES, 'CANCELLED']
}

export function summarizeStatuses(rows: Array<{ status: string; _count: { _all: number } }>) {
  const count = (statuses: string[]) => rows.reduce((sum, row) => sum + (statuses.includes(row.status) ? row._count._all : 0), 0)
  return {
    total: rows.reduce((sum, row) => sum + row._count._all, 0),
    working: count(WORKING_STATUSES), attention: count(ATTENTION_STATUSES),
    sent: count(CONFIRMED_STATUSES), delivered: count(['DELIVERED', 'READ']), read: count(['READ']),
  }
}

export type AiActivity = {
  id: string; batchId: string; customerName: string; status: string; reason: string
  creditState: string; billedTokens: number; reservedTokens: number; inputTokens: number; outputTokens: number
  content: string | null; conversationId: string | null; createdAt: string
}

export type AiOverview = {
  enabled: true; updatedAt: string; period: AiPeriod; start: string
  availability: 'READY' | 'AI_DISABLED' | 'CHANNEL_UNAVAILABLE'
  balance: { available: number; reserved: number; spent: number; allowance: number; expiresAt: string | null }
  consumption: { tokens: number; generations: number }
  impact: ReturnType<typeof summarizeStatuses>
  current: { working: number; unconfirmed: number }
  reservationPerMessage: number
  subscription: { cents: number; currency: string; status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean } | null
  activity: { jobs: AiActivity[]; total: number; page: number; pageSize: number; filter: AiFilter }
}

export type AiOverviewResponse = AiOverview | { enabled: false }
