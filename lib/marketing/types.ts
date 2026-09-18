export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const
export const CAMPAIGN_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'] as const
export const CAMPAIGN_CHANNELS = ['ORGANIC', 'META_ADS', 'GOOGLE_ADS', 'EMAIL', 'WHATSAPP', 'OTHER'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number]
export type LeadFilters = {
  query: string
  status: LeadStatus | null
  campaignId: string | null
  ownerId: string | null
  period: 'all' | '7d' | '30d' | '90d'
  followUp: 'all' | 'overdue' | 'scheduled'
  page: number
}
export type AdminOption = { id: string; name: string }
export type MarketingLeadRow = {
  id: string
  name: string
  email: string
  phone: string
  status: LeadStatus
  source: string
  createdAt: string
  nextContactAt: string | null
  campaign: { id: string; name: string }
  owner: AdminOption | null
}
export type CampaignRow = {
  id: string
  name: string
  slug: string
  description: string | null
  channel: CampaignChannel
  status: CampaignStatus
  budgetCents: number | null
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  totalLeads: number
  convertedLeads: number
}
export type LeadsPage = { rows: MarketingLeadRow[]; total: number; page: number; pageCount: number }
export type LeadDetail = MarketingLeadRow & {
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmContent: string | null
  utmTerm: string | null
  notes: { id: string; body: string; createdAt: string; authorName: string | null }[]
}
export type MarketingSummary = {
  total: number
  new: number
  qualified: number
  converted: number
  overdue: number
  activeCampaigns: number
}
export type MarketingActionResult =
  | { ok: true; id?: string; delivery?: 'SENT' | 'FAILED'; accountCreated?: boolean }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> }
