import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireRole } from '@/lib/require-role'
import { MARKETING_PAGE_SIZE, marketingLeadWhere } from './filters'
import type { AdminOption, CampaignRow, LeadDetail, LeadFilters, LeadsPage, MarketingLeadRow, MarketingSummary } from './types'

export { parseLeadFilters, leadQueryString } from './filters'

const leadSelect = {
  id: true, name: true, email: true, phone: true, status: true, source: true,
  createdAt: true, nextContactAt: true,
  campaign: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.MarketingLeadSelect

type LeadRecord = Prisma.MarketingLeadGetPayload<{ select: typeof leadSelect }>
function leadRow(lead: LeadRecord): MarketingLeadRow {
  return { ...lead, createdAt: lead.createdAt.toISOString(), nextContactAt: lead.nextContactAt?.toISOString() ?? null }
}

const campaignSelect = {
  id: true, name: true, slug: true, description: true, channel: true, status: true,
  budgetCents: true, startsAt: true, endsAt: true, createdAt: true,
  _count: { select: { leads: true } },
} satisfies Prisma.MarketingCampaignSelect

type CampaignRecord = Prisma.MarketingCampaignGetPayload<{ select: typeof campaignSelect }>
function campaignRow(campaign: CampaignRecord, convertedLeads: number): CampaignRow {
  const { _count, ...value } = campaign
  return {
    ...value,
    createdAt: value.createdAt.toISOString(),
    startsAt: value.startsAt?.toISOString() ?? null,
    endsAt: value.endsAt?.toISOString() ?? null,
    totalLeads: _count.leads,
    convertedLeads,
  }
}

export async function readMarketingLeads(filters: LeadFilters): Promise<LeadsPage> {
  await requireRole('ADMIN')
  const where = marketingLeadWhere(filters)
  return prisma.$transaction(async (tx) => {
    const total = await tx.marketingLead.count({ where })
    const pageCount = Math.max(1, Math.ceil(total / MARKETING_PAGE_SIZE))
    const page = Math.min(pageCount, Math.max(1, filters.page))
    const rows = await tx.marketingLead.findMany({
      where, select: leadSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * MARKETING_PAGE_SIZE, take: MARKETING_PAGE_SIZE,
    })
    return { rows: rows.map(leadRow), total, page, pageCount }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

export async function readMarketingSummary(): Promise<MarketingSummary> {
  await requireRole('ADMIN')
  const [total, newLeads, qualified, converted, overdue, activeCampaigns] = await prisma.$transaction([
    prisma.marketingLead.count(),
    prisma.marketingLead.count({ where: { status: 'NEW' } }),
    prisma.marketingLead.count({ where: { status: 'QUALIFIED' } }),
    prisma.marketingLead.count({ where: { status: 'CONVERTED' } }),
    prisma.marketingLead.count({ where: { status: { notIn: ['CONVERTED', 'LOST'] }, nextContactAt: { lt: new Date() } } }),
    prisma.marketingCampaign.count({ where: { status: 'ACTIVE' } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  return { total, new: newLeads, qualified, converted, overdue, activeCampaigns }
}

export async function readMarketingCampaigns(): Promise<CampaignRow[]> {
  await requireRole('ADMIN')
  const campaignsQuery = prisma.marketingCampaign.findMany({
    select: campaignSelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  const convertedQuery = prisma.marketingLead.groupBy({
    by: ['campaignId'], where: { status: 'CONVERTED' }, orderBy: { campaignId: 'asc' }, _count: { _all: true },
  })
  const [campaigns, converted] = await prisma.$transaction([campaignsQuery, convertedQuery], {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  })
  const counts = new Map(converted.map((group) => [group.campaignId, group._count._all]))
  return campaigns.map((campaign) => campaignRow(campaign, counts.get(campaign.id) ?? 0))
}

export async function readMarketingCampaign(id: string): Promise<CampaignRow | null> {
  await requireRole('ADMIN')
  const [campaign, converted] = await prisma.$transaction([
    prisma.marketingCampaign.findUnique({ where: { id }, select: campaignSelect }),
    prisma.marketingLead.count({ where: { campaignId: id, status: 'CONVERTED' } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
  return campaign ? campaignRow(campaign, converted) : null
}

export async function readMarketingLead(id: string): Promise<LeadDetail | null> {
  await requireRole('ADMIN')
  const lead = await prisma.marketingLead.findUnique({
    where: { id },
    select: {
      ...leadSelect,
      utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, utmTerm: true,
      notes: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  })
  if (!lead) return null
  return {
    ...leadRow(lead),
    utmSource: lead.utmSource, utmMedium: lead.utmMedium, utmCampaign: lead.utmCampaign,
    utmContent: lead.utmContent, utmTerm: lead.utmTerm,
    notes: lead.notes.map((note) => ({ id: note.id, body: note.body, createdAt: note.createdAt.toISOString(), authorName: note.author?.name ?? null })),
  }
}

export async function readMarketingOwners(): Promise<AdminOption[]> {
  await requireRole('ADMIN')
  return prisma.user.findMany({
    where: { role: 'ADMIN', banned: false }, select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })
}
