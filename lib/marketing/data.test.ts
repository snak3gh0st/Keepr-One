import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), transaction: vi.fn(), leadCount: vi.fn(), leadMany: vi.fn(), leadFind: vi.fn(),
  campaignMany: vi.fn(), campaignFind: vi.fn(), campaignCount: vi.fn(), groupBy: vi.fn(), userMany: vi.fn(),
}))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction: mocks.transaction,
  marketingLead: { count: mocks.leadCount, findMany: mocks.leadMany, findUnique: mocks.leadFind, groupBy: mocks.groupBy },
  marketingCampaign: { findMany: mocks.campaignMany, findUnique: mocks.campaignFind, count: mocks.campaignCount },
  user: { findMany: mocks.userMany },
} }))
import { parseLeadFilters, readMarketingCampaign, readMarketingCampaigns, readMarketingLead, readMarketingLeads, readMarketingOwners, readMarketingSummary } from './data'
const record = {
  id: 'legacy-lead', name: 'Original Founder', email: 'legacy@example.test', phone: '+12125550100',
  status: 'NEW', source: 'FOUNDERS', createdAt: new Date('2026-09-01T00:00:00Z'), nextContactAt: null,
  campaign: { id: 'founders-program', name: 'Programa Founders' }, owner: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'admin-1' } })
  mocks.leadCount.mockResolvedValue(0)
  mocks.leadMany.mockResolvedValue([record])
  mocks.transaction.mockImplementation((value) => typeof value === 'function'
    ? value({ marketingLead: { count: mocks.leadCount, findMany: mocks.leadMany } })
    : Promise.all(value))
})

describe('protected marketing reads', () => {
  it.each([
    () => readMarketingLeads(parseLeadFilters({})), readMarketingSummary, readMarketingCampaigns,
    () => readMarketingCampaign('campaign-1'), () => readMarketingLead('lead-1'), readMarketingOwners,
  ])('denies non-admin reads before touching persistence', async (read) => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden: insufficient role'))
    await expect(read()).rejects.toThrow('Forbidden')
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.leadCount).not.toHaveBeenCalled()
    expect(mocks.leadFind).not.toHaveBeenCalled()
    expect(mocks.campaignMany).not.toHaveBeenCalled()
    expect(mocks.userMany).not.toHaveBeenCalled()
  })
  it('clamps requested page to the last page and retains legacy founders', async () => {
    mocks.leadCount.mockResolvedValue(51)
    const result = await readMarketingLeads(parseLeadFilters({ page: '999' }))
    expect(result).toMatchObject({ total: 51, page: 3, pageCount: 3, rows: [{ ...record, createdAt: '2026-09-01T00:00:00.000Z' }] })
    expect(mocks.leadMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }))
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' })
  })
  it('keeps an empty result on page one', async () => {
    mocks.leadMany.mockResolvedValue([])
    expect(await readMarketingLeads(parseLeadFilters({ page: '3' }))).toEqual({ rows: [], total: 0, page: 1, pageCount: 1 })
  })
  it('counts aggregate results consistently including open overdue contacts', async () => {
    mocks.leadCount.mockResolvedValueOnce(10).mockResolvedValueOnce(6).mockResolvedValueOnce(2).mockResolvedValueOnce(1).mockResolvedValueOnce(3)
    mocks.campaignCount.mockResolvedValue(2)
    expect(await readMarketingSummary()).toEqual({ total: 10, new: 6, qualified: 2, converted: 1, overdue: 3, activeCampaigns: 2 })
    expect(mocks.leadCount).toHaveBeenLastCalledWith({ where: { status: { notIn: ['CONVERTED', 'LOST'] }, nextContactAt: { lt: expect.any(Date) } } })
  })
  it('reads campaign totals and conversions without per-campaign requests', async () => {
    const campaign = { id: 'founders-program', name: 'Programa Founders', slug: 'founders', description: null, channel: 'ORGANIC', status: 'ACTIVE', budgetCents: null, startsAt: null, endsAt: null, createdAt: record.createdAt, _count: { leads: 12 } }
    mocks.campaignMany.mockResolvedValue([campaign])
    mocks.groupBy.mockResolvedValue([{ campaignId: 'founders-program', _count: { _all: 3 } }])
    expect(await readMarketingCampaigns()).toEqual([{ ...campaign, _count: undefined, createdAt: record.createdAt.toISOString(), totalLeads: 12, convertedLeads: 3 }])
    expect(mocks.campaignMany).toHaveBeenCalledTimes(1)
    expect(mocks.groupBy).toHaveBeenCalledTimes(1)
  })
  it('limits assignable owners to active admins', async () => {
    mocks.userMany.mockResolvedValue([])
    await readMarketingOwners()
    expect(mocks.userMany).toHaveBeenCalledWith(expect.objectContaining({ where: { role: 'ADMIN', banned: false } }))
  })
})
