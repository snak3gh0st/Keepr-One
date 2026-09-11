import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestFindFirst: vi.fn(), requestUpdateMany: vi.fn(),
  clientFindFirst: vi.fn(), prefFindMany: vi.fn(), illustrationFindFirst: vi.fn(),
  agentFindUnique: vi.fn(), prefUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  agent: { findUnique: mocks.agentFindUnique },
  kBotIllustrationRequest: { findFirst: mocks.requestFindFirst, updateMany: mocks.requestUpdateMany },
  client: { findFirst: mocks.clientFindFirst },
  kBotContactPreference: { findMany: mocks.prefFindMany, upsert: mocks.prefUpsert },
  illustration: { findFirst: mocks.illustrationFindFirst },
} }))

import { markIllustrationReadyToSend, sendIllustrationRequest, expireStaleIllustrationRequests } from './delivery'
import { illustrationMessage } from './transport'

const now = new Date('2026-03-11T17:00:00Z')
const input = { agentId: 'agent_1', requestId: 'req_1', now }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestFindFirst.mockResolvedValue({ id: 'req_1', clientId: 'client_1', illustrationId: 'ill_1' })
  mocks.requestUpdateMany.mockResolvedValue({ count: 1 })
  mocks.clientFindFirst.mockResolvedValue({ id: 'client_1', name: 'Ana Ribeiro', phone: '+13055550142' })
  mocks.prefFindMany.mockResolvedValue([])
  mocks.agentFindUnique.mockResolvedValue({ user: { language: 'EN' } })
  mocks.prefUpsert.mockResolvedValue({})
  mocks.illustrationFindFirst.mockResolvedValue({
    id: 'ill_1', productName: 'FlexLife', faceAmount: '250000', targetPremium: '180', documentUrl: 'https://x/ill.pdf',
  })
})

describe('markIllustrationReadyToSend', () => {
  it('stops at ready, because generating is not sending', async () => {
    // The carrier finished and the numbers are in Keeprone. Nothing leaves the
    // building until the agent presses send.
    expect(await markIllustrationReadyToSend({ agentId: 'agent_1', illustrationId: 'ill_1' })).toEqual({ moved: 1 })
    expect(mocks.requestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agentId: 'agent_1', status: 'GENERATING' }),
      data: { status: 'READY_TO_SEND' },
    }))
  })

  it('ignores an illustration the agent ran by hand', async () => {
    mocks.requestUpdateMany.mockResolvedValue({ count: 0 })
    expect(await markIllustrationReadyToSend({ agentId: 'agent_1', illustrationId: 'ill_1' })).toEqual({ moved: 0 })
  })
})

describe('sendIllustrationRequest', () => {
  it('sends the numbers once the agent chooses to', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    expect(await sendIllustrationRequest(input, send)).toEqual({ ok: true })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client_1', phone: '+13055550142', productName: 'FlexLife',
      faceAmount: '250000', documentUrl: 'https://x/ill.pdf',
    }))
    expect(mocks.requestUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'DELIVERED' }),
    }))
  })

  it('counts the quote as contact, so a greeting does not follow it hours later', async () => {
    // The delivery is not a KBotFollowupJob, so the shared weekly window would
    // not see it. `lastManualAt` is the field that window already reads.
    await sendIllustrationRequest(input, vi.fn().mockResolvedValue(undefined))
    expect(mocks.prefUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId_subjectKey: { agentId: 'agent_1', subjectKey: '+13055550142' } },
      update: { lastManualAt: input.now },
    }))
  })

  it('does not message a client who asked not to be contacted', async () => {
    // Consent outlives the request: they may have asked for a quote last week
    // and asked to be left alone since. The second instruction is the current
    // one, and it is checked here because the carrier run takes minutes.
    const send = vi.fn()
    mocks.prefFindMany.mockResolvedValue([{ optedOut: true }])
    expect(await sendIllustrationRequest(input, send)).toEqual({ ok: false, reason: 'OPTED_OUT' })
    expect(send).not.toHaveBeenCalled()
    expect(mocks.requestUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'BLOCKED', safeErrorCode: 'OPTED_OUT' }),
    }))
  })

  it('looks for the stop request under the number and under the client', async () => {
    await sendIllustrationRequest(input, vi.fn())
    expect(mocks.prefFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ subjectKey: { in: ['+13055550142', 'client:client_1'] } }),
    }))
  })

  it('refuses a request that is past its send window', async () => {
    // The claim predicate carries the window, so a screen left open for days
    // matches nothing rather than sending figures the carrier has moved on from.
    await sendIllustrationRequest(input, vi.fn())
    expect(mocks.requestUpdateMany.mock.calls[0][0].where.createdAt.gte)
      .toEqual(new Date('2026-03-08T17:00:00Z'))
  })

  it('lets only one of two clicks send', async () => {
    const send = vi.fn()
    mocks.requestUpdateMany.mockResolvedValue({ count: 0 })
    expect(await sendIllustrationRequest(input, send)).toEqual({ ok: false, reason: 'NOT_READY_TO_SEND' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a client with no number to reach', async () => {
    mocks.clientFindFirst.mockResolvedValue({ id: 'client_1', name: 'Ana', phone: null })
    expect(await sendIllustrationRequest(input, vi.fn())).toEqual({ ok: false, reason: 'CLIENT_UNREACHABLE' })
  })

  it('is scoped to the agent, never another agent client', async () => {
    await sendIllustrationRequest(input, vi.fn())
    expect(mocks.clientFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'client_1', assignedAgentId: 'agent_1' },
    }))
  })

  it('closes the request rather than leaving it mid-flight when sending fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('provider down'))
    expect(await sendIllustrationRequest(input, send)).toEqual({ ok: false, reason: 'TRANSPORT_FAILED' })
    expect(mocks.requestUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', safeErrorCode: 'TRANSPORT_FAILED' }),
    }))
  })
})

describe('expireStaleIllustrationRequests', () => {
  it('releases a slot whose carrier run never finished, and one nobody sent', async () => {
    mocks.requestUpdateMany.mockResolvedValue({ count: 2 })
    expect(await expireStaleIllustrationRequests(now)).toEqual({ expired: 4 })
    // The dead run is measured against the connector command's own expiry...
    expect(mocks.requestUpdateMany.mock.calls[0][0].where.createdAt.lt)
      .toEqual(new Date('2026-03-11T16:00:00Z'))
    // ...and the unsent figures against how long a quote stays current.
    expect(mocks.requestUpdateMany.mock.calls[1][0].where.createdAt.lt)
      .toEqual(new Date('2026-03-08T17:00:00Z'))
  })
})

describe('illustrationMessage', () => {
  it('states the facts in the order the client asked about them', () => {
    const text = illustrationMessage({
      requestId: 'req_1', agentId: 'a', clientId: 'c', clientName: 'Ana Ribeiro', phone: '+1305',
      language: 'EN', illustrationId: 'i', productName: 'FlexLife', faceAmount: '250000',
      targetPremium: '180', documentUrl: 'https://x/ill.pdf',
    })
    expect(text).toContain('Ana, here is the illustration you asked for.')
    expect(text).toContain('FlexLife')
    expect(text).toContain('$250,000')
    // The PDF rides as the attachment, not as a link the client has to trust.
    expect(text).toContain('attached')
    expect(text).not.toContain('https://')
  })

  it('leaves out a figure the carrier did not return', () => {
    // A missing premium is a missing line, never "null" or "$0" in a client's
    // chat.
    const text = illustrationMessage({
      requestId: 'r', agentId: 'a', clientId: 'c', clientName: 'Ana', phone: '+1',
      language: 'PT', illustrationId: 'i', productName: null, faceAmount: null,
      targetPremium: null, documentUrl: null,
    })
    expect(text).not.toMatch(/null|undefined|\$0/)
    // Greeting and the line about the attachment; no empty figure lines.
    expect(text.split('\n')).toHaveLength(2)
  })
})
