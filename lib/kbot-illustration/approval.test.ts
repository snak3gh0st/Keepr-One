import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findRequest: vi.fn(),
  findIllustration: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kBotIllustrationRequest: { updateMany: mocks.updateMany, findFirst: mocks.findRequest },
    illustration: { findFirst: mocks.findIllustration },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      kBotIllustrationRequest: { updateMany: mocks.updateMany, findFirst: mocks.findRequest },
    }),
  },
}))

import {
  approveIllustrationRequest,
  deliverApprovedIllustration,
  discardIllustrationRequest,
  expireStaleIllustrationRequests,
  markIllustrationReadyForApproval,
} from './approval'

const REQUEST = {
  id: 'req_1',
  agentId: 'agent_1',
  clientId: 'client_1',
  illustrationId: 'ill_1',
}

async function approve() {
  mocks.updateMany.mockResolvedValue({ count: 1 })
  mocks.findRequest.mockResolvedValue(REQUEST)
  const result = await approveIllustrationRequest({
    agentId: 'agent_1',
    requestId: 'req_1',
    approvedByUserId: 'user_1',
  })
  if (!result.ok) throw new Error('expected approval')
  return result.approved
}

describe('the agent reads the numbers before the client does', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findIllustration.mockResolvedValue({
      id: 'ill_1',
      productName: 'FlexLife',
      faceAmount: { toString: () => '250000' },
      targetPremium: { toString: () => '350' },
      documentUrl: null,
    })
  })

  it('moves a finished generation into the approval queue, scoped to the agent', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })
    const result = await markIllustrationReadyForApproval({ agentId: 'agent_1', illustrationId: 'ill_1' })
    expect(result).toEqual({ moved: 1 })
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { agentId: 'agent_1', illustrationId: 'ill_1', status: 'GENERATING' },
      data: { status: 'AWAITING_APPROVAL' },
    })
  })

  it('approves only a request of this agent that is still awaiting approval', async () => {
    await approve()
    const where = mocks.updateMany.mock.calls[0][0].where
    expect(where).toMatchObject({ id: 'req_1', agentId: 'agent_1', status: 'AWAITING_APPROVAL' })
    expect(where.illustrationId).toEqual({ not: null })
    expect(where.createdAt.gte).toBeInstanceOf(Date)
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'APPROVED',
      approvedByUserId: 'user_1',
    })
  })

  it('delivers to the client only with an approval in hand', async () => {
    const approved = await approve()
    mocks.updateMany.mockResolvedValue({ count: 1 })
    const send = vi.fn(async () => {})
    const result = await deliverApprovedIllustration(approved, send)
    expect(result).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client_1',
      illustrationId: 'ill_1',
      faceAmount: '250000',
      targetPremium: '350',
    }))
    // The claim re-asserts the state instead of trusting the value in hand.
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'req_1', agentId: 'agent_1', status: 'APPROVED' },
      data: { status: 'DELIVERING' },
    })
  })

  it('cannot deliver without approval', async () => {
    const approved = await approve()
    // Discarded from another screen after the agent approved: the claim no
    // longer matches, so the transport is never reached.
    mocks.updateMany.mockResolvedValue({ count: 0 })
    const send = vi.fn(async () => {})
    const result = await deliverApprovedIllustration(approved, send)
    expect(result).toEqual({ ok: false, reason: 'NOT_APPROVED' })
    expect(send).not.toHaveBeenCalled()

    // And there is no value to pass in the first place: a request that was
    // never approved yields no approval, only a refusal.
    mocks.updateMany.mockResolvedValue({ count: 0 })
    const refused = await approveIllustrationRequest({
      agentId: 'agent_1',
      requestId: 'req_1',
      approvedByUserId: 'user_1',
    })
    expect(refused).toEqual({ ok: false, reason: 'NOT_AWAITING_APPROVAL' })

    // The type half of the same rule: the delivery signature accepts nothing a
    // caller can write by hand, so this line does not compile.
    // @ts-expect-error delivery requires proof of approval, not a request id
    await deliverApprovedIllustration({ requestId: 'req_1', agentId: 'agent_1', clientId: 'client_1', illustrationId: 'ill_1', approvedByUserId: 'user_1' }, send)
  })

  it('never approves another agent request', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })
    const result = await approveIllustrationRequest({
      agentId: 'agent_2',
      requestId: 'req_1',
      approvedByUserId: 'user_2',
    })
    expect(result).toEqual({ ok: false, reason: 'NOT_AWAITING_APPROVAL' })
    expect(mocks.updateMany.mock.calls[0][0].where.agentId).toBe('agent_2')
  })

  it('discards what the agent chose not to send', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 })
    expect(await discardIllustrationRequest({ agentId: 'agent_1', requestId: 'req_1' })).toEqual({ discarded: 1 })
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'DISCARDED' })
  })

  it('releases slots nobody acted on', async () => {
    mocks.updateMany.mockResolvedValue({ count: 2 })
    const result = await expireStaleIllustrationRequests(new Date('2026-09-10T12:00:00.000Z'))
    expect(result).toEqual({ expired: 4 })
    expect(mocks.updateMany.mock.calls[0][0].data).toMatchObject({ safeErrorCode: 'GENERATION_TIMED_OUT' })
    expect(mocks.updateMany.mock.calls[1][0].data).toMatchObject({ status: 'EXPIRED' })
  })

  it('hands the claim back when the transport fails, instead of leaving it mid-flight', async () => {
    const approved = await approve()
    mocks.updateMany.mockResolvedValue({ count: 1 })
    const send = vi.fn(async () => { throw new Error('TRANSPORT') })
    const result = await deliverApprovedIllustration(approved, send)
    expect(result).toEqual({ ok: false, reason: 'TRANSPORT_FAILED' })
    const last = mocks.updateMany.mock.calls.at(-1)![0]
    expect(last).toMatchObject({
      where: { id: 'req_1', agentId: 'agent_1', status: 'DELIVERING' },
      data: { status: 'APPROVED', safeErrorCode: 'TRANSPORT_FAILED' },
    })
  })
})
