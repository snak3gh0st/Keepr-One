import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ candidates: vi.fn(), lock: vi.fn(), client: vi.fn(), updateClient: vi.fn(), insuranceCase: vi.fn(), updateProspect: vi.fn() }))
vi.mock('./candidates', () => ({ getFollowupCandidates: mocks.candidates }))
vi.mock('./credits', () => ({ lockAgent: mocks.lock }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({
  client: { findFirst: mocks.client, updateMany: mocks.updateClient },
  insuranceCase: { findFirst: mocks.insuranceCase }, prospect: { updateMany: mocks.updateProspect },
}) } }))
import { saveFollowupPhone } from './service'
const input = { candidateId: 'policy:one', fingerprint: 'f'.repeat(64), phone: '+1 (407) 555-0100' }
const candidate = { id: input.candidateId, fingerprint: input.fingerprint, subjectKey: 'client:one', blockedReason: 'PHONE_REQUIRED' }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.candidates.mockResolvedValue([candidate])
  mocks.client.mockResolvedValue({ phone: null })
  mocks.updateClient.mockResolvedValue({ count: 1 })
  mocks.updateProspect.mockResolvedValue({ count: 1 })
})
describe('owned phone correction', () => {
  it('normalizes and updates only the currently owned record with an optimistic guard', async () => {
    expect(await saveFollowupPhone('owner', input)).toEqual({ ok: true })
    expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), 'owner')
    expect(mocks.client).toHaveBeenCalledWith({ where: { id: 'one', assignedAgentId: 'owner' }, select: { phone: true } })
    expect(mocks.updateClient).toHaveBeenCalledWith({ where: { id: 'one', assignedAgentId: 'owner', phone: null }, data: { phone: '+14075550100' } })
  })
  it('rejects numbers without an explicit country code', async () => {
    await expect(saveFollowupPhone('owner', { ...input, phone: '4075550100' })).rejects.toThrow('PHONE_REQUIRED')
    expect(mocks.updateClient).not.toHaveBeenCalled()
  })
  it('rejects a candidate from outside the current agent list or with changed facts', async () => {
    mocks.candidates.mockResolvedValue([])
    await expect(saveFollowupPhone('owner', input)).rejects.toThrow('SOURCE_CHANGED')
    mocks.candidates.mockResolvedValue([{ ...candidate, fingerprint: 'changed' }])
    await expect(saveFollowupPhone('owner', input)).rejects.toThrow('SOURCE_CHANGED')
    expect(mocks.updateClient).not.toHaveBeenCalled()
  })
  it('does not turn opt-outs or ambiguous contacts into editable phone repairs', async () => {
    for (const blockedReason of ['OPTED_OUT', 'CONTACT_AMBIGUOUS', 'RECENT_CONTACT']) {
      mocks.candidates.mockResolvedValue([{ ...candidate, blockedReason }])
      await expect(saveFollowupPhone('owner', input)).rejects.toThrow(blockedReason)
    }
    expect(mocks.updateClient).not.toHaveBeenCalled()
  })
  it('rejects ownership loss and concurrent updates without overwriting a valid phone', async () => {
    mocks.client.mockResolvedValue(null)
    await expect(saveFollowupPhone('owner', input)).rejects.toThrow('SOURCE_CHANGED')
    mocks.client.mockResolvedValue({ phone: '+14075550101' })
    await expect(saveFollowupPhone('owner', input)).rejects.toThrow('SOURCE_CHANGED')
    expect(mocks.updateClient).not.toHaveBeenCalled()
    mocks.client.mockResolvedValue({ phone: null })
    mocks.updateClient.mockResolvedValue({ count: 0 })
    await expect(saveFollowupPhone('owner', input)).rejects.toThrow('SOURCE_CHANGED')
  })
  it('repairs a prospect only through an owned open case and owned prospect', async () => {
    mocks.candidates.mockResolvedValue([{ ...candidate, subjectKey: 'case:one' }])
    mocks.insuranceCase.mockResolvedValue({ prospect: { id: 'prospect', phone: null } })
    await saveFollowupPhone('owner', input)
    expect(mocks.insuranceCase).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'one', assignedAgentId: 'owner', clientId: null, status: 'OPEN', prospect: { assignedAgentId: 'owner' } } }))
    expect(mocks.updateProspect).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'prospect', assignedAgentId: 'owner', phone: null }), data: { phone: '+14075550100' } }))
    expect(mocks.updateClient).not.toHaveBeenCalled()
  })
})
