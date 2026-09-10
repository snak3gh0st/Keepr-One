import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), headers: vi.fn(), revalidatePath: vi.fn(), transaction: vi.fn(),
  campaignFind: vi.fn(), campaignUpdate: vi.fn(), campaignCreate: vi.fn(),
  leadFind: vi.fn(), leadFindMany: vi.fn(), leadUpdate: vi.fn(), leadUpdateMany: vi.fn(),
  userFind: vi.fn(), noteCreate: vi.fn(), auditCreate: vi.fn(), auditMany: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/require-role', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/i18n/server', () => ({ getServerI18n: async () => ({ copy: (pt: string) => pt }) }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }))

import { addLeadNoteAction, bulkUpdateLeadStatusAction, saveCampaignAction, updateLeadAction } from './actions'

const tx = {
  marketingCampaign: { findUnique: mocks.campaignFind, create: mocks.campaignCreate, update: mocks.campaignUpdate },
  marketingLead: { findUnique: mocks.leadFind, findMany: mocks.leadFindMany, update: mocks.leadUpdate, updateMany: mocks.leadUpdateMany },
  user: { findFirst: mocks.userFind }, marketingLeadNote: { create: mocks.noteCreate },
  auditLog: { create: mocks.auditCreate, createMany: mocks.auditMany },
}
function form(values: Record<string, string> = {}) {
  const data = new FormData()
  Object.entries(values).forEach(([key, value]) => data.set(key, value))
  return data
}
const campaign = { name: '  Lançamento Founders  ', description: '', channel: 'META_ADS', status: 'ACTIVE', budget: '1000.99', startsAt: '2026-10-01', endsAt: '2026-10-30' }
const lead = { id: 'lead-1', status: 'QUALIFIED', ownerId: '', nextContactAt: '' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireRole.mockResolvedValue({ user: { id: 'admin-1' } })
  mocks.headers.mockResolvedValue(new Headers({ origin: 'http://localhost:3000', host: 'localhost:3000' }))
  mocks.transaction.mockImplementation((callback) => callback(tx))
  mocks.campaignCreate.mockImplementation(async ({ data }) => ({ id: 'campaign-1', ...data }))
  mocks.campaignUpdate.mockImplementation(async ({ data }) => ({ id: 'founders-program', slug: 'founders', ...data }))
  mocks.campaignFind.mockResolvedValue({ id: 'founders-program', slug: 'founders', name: 'Before' })
  mocks.leadFind.mockResolvedValue({ status: 'NEW', ownerId: null, nextContactAt: null })
  mocks.leadFindMany.mockResolvedValue([{ id: 'lead-1', status: 'NEW' }, { id: 'lead-2', status: 'CONTACTED' }])
  mocks.leadUpdateMany.mockResolvedValue({ count: 2 })
  mocks.noteCreate.mockResolvedValue({ id: 'note-1' })
  mocks.userFind.mockResolvedValue({ id: 'admin-2' })
})

describe('marketing authorization', () => {
  it.each([saveCampaignAction, updateLeadAction, addLeadNoteAction, bulkUpdateLeadStatusAction])('authenticates before validation and any database access', async (action) => {
    mocks.requireRole.mockRejectedValue(new Error('Forbidden: insufficient role'))
    await expect(action(new FormData())).rejects.toThrow('Forbidden')
    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('rejects a cross-origin mutation', async () => {
    mocks.headers.mockResolvedValue(new Headers({ origin: 'https://outside.test', host: 'localhost:3000' }))
    await expect(saveCampaignAction(form(campaign))).rejects.toThrow('Invalid action origin')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe('campaign management', () => {
  it('creates a stable share slug, cents budget and audit inside one transaction', async () => {
    const result = await saveCampaignAction(form(campaign))
    expect(result).toEqual({ ok: true, id: 'campaign-1' })
    expect(mocks.campaignCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: 'Lançamento Founders', slug: expect.stringMatching(/^lancamento-founders-[a-f0-9]{8}$/), budgetCents: 100099,
      startsAt: new Date('2026-10-01T00:00:00Z'),
    }) })
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'MARKETING_CAMPAIGN_CREATED', userId: 'admin-1', entityId: 'campaign-1' }) })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
  it('preserves a campaign slug when changing name and status', async () => {
    expect(await saveCampaignAction(form({ ...campaign, id: 'founders-program' }))).toEqual({ ok: true, id: 'founders-program' })
    const write = mocks.campaignUpdate.mock.calls[0][0]
    expect(write.data).not.toHaveProperty('slug')
    expect(write.where).toEqual({ id: 'founders-program' })
  })
  it('returns field errors without a transaction for backwards dates', async () => {
    const result = await saveCampaignAction(form({ ...campaign, endsAt: '2026-09-01' }))
    expect(result).toMatchObject({ ok: false, fieldErrors: { endsAt: [expect.any(String)] } })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it('does not create a missing campaign through the edit path', async () => {
    mocks.campaignFind.mockResolvedValue(null)
    expect(await saveCampaignAction(form({ ...campaign, id: 'missing' }))).toMatchObject({ ok: false, message: expect.stringContaining('não encontrada') })
    expect(mocks.campaignUpdate).not.toHaveBeenCalled()
    expect(mocks.campaignCreate).not.toHaveBeenCalled()
  })
})

describe('lead management', () => {
  it('only changes validated management fields and attributes audit to the session', async () => {
    expect(await updateLeadAction(form({ ...lead, email: 'attack@example.com', campaignId: 'other', authorId: 'other', status: 'CONTACTED' }))).toEqual({ ok: true, id: 'lead-1' })
    expect(mocks.leadUpdate).toHaveBeenCalledWith({ where: { id: 'lead-1' }, data: { status: 'CONTACTED', ownerId: null, nextContactAt: null } })
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'admin-1', entity: 'MarketingLead' }) })
  })
  it('rejects inactive and non-admin owners before writing', async () => {
    mocks.userFind.mockResolvedValue(null)
    expect(await updateLeadAction(form({ ...lead, ownerId: 'agent-1' }))).toMatchObject({ ok: false, fieldErrors: { ownerId: [expect.any(String)] } })
    expect(mocks.userFind).toHaveBeenCalledWith({ where: { id: 'agent-1', role: 'ADMIN', banned: false }, select: { id: true } })
    expect(mocks.leadUpdate).not.toHaveBeenCalled()
  })
  it('appends trimmed notes under the administrator identity', async () => {
    expect(await addLeadNoteAction(form({ leadId: 'lead-1', body: '  Primeiro contato feito.  ', authorId: 'spoof' }))).toEqual({ ok: true, id: 'note-1' })
    expect(mocks.noteCreate).toHaveBeenCalledWith({ data: { leadId: 'lead-1', body: 'Primeiro contato feito.', authorId: 'admin-1' } })
    expect(mocks.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ after: { noteId: 'note-1' } }) })
  })
  it('does not report success or revalidate if the transactional audit fails', async () => {
    mocks.auditCreate.mockRejectedValue(new Error('private database details'))
    expect(await updateLeadAction(form(lead))).toEqual({ ok: false, message: 'Não foi possível atualizar o lead agora.' })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})

describe('bulk status changes', () => {
  function bulk(ids = ['lead-1', 'lead-2']) {
    const data = form({ status: 'QUALIFIED' })
    ids.forEach((id) => data.append('ids', id))
    return data
  }
  it('updates selected IDs atomically and audits each previous status', async () => {
    expect(await bulkUpdateLeadStatusAction(bulk())).toEqual({ ok: true })
    expect(mocks.leadUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ['lead-1', 'lead-2'] } }, data: { status: 'QUALIFIED' } })
    expect(mocks.auditMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ entityId: 'lead-1', before: { status: 'NEW' }, after: { status: 'QUALIFIED' } }),
      expect.objectContaining({ entityId: 'lead-2', before: { status: 'CONTACTED' }, after: { status: 'QUALIFIED' } }),
    ] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
  it('fails the entire selection when any ID is missing', async () => {
    mocks.leadFindMany.mockResolvedValue([{ id: 'lead-1', status: 'NEW' }])
    expect(await bulkUpdateLeadStatusAction(bulk())).toMatchObject({ ok: false })
    expect(mocks.leadUpdateMany).not.toHaveBeenCalled()
    expect(mocks.auditMany).not.toHaveBeenCalled()
  })
  it('throws within the transaction if a row disappears before the update', async () => {
    mocks.leadUpdateMany.mockResolvedValue({ count: 1 })
    expect(await bulkUpdateLeadStatusAction(bulk())).toMatchObject({ ok: false })
    expect(mocks.auditMany).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('rejects over 100 IDs before querying the database', async () => {
    expect(await bulkUpdateLeadStatusAction(bulk(Array.from({ length: 101 }, (_, index) => `lead-${index}`)))).toMatchObject({ ok: false })
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
