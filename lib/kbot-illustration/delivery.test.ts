import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestFindFirst: vi.fn(), requestUpdateMany: vi.fn(),
  clientFindFirst: vi.fn(), prefFindMany: vi.fn(), illustrationFindFirst: vi.fn(),
  agentFindUnique: vi.fn(), prefUpsert: vi.fn(), requestFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  agent: { findUnique: mocks.agentFindUnique },
  kBotIllustrationRequest: { findFirst: mocks.requestFindFirst, findMany: mocks.requestFindMany, updateMany: mocks.requestUpdateMany },
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
  mocks.requestFindMany.mockResolvedValue([])
  mocks.agentFindUnique.mockResolvedValue({ user: { language: 'EN' } })
  mocks.prefUpsert.mockResolvedValue({})
  mocks.illustrationFindFirst.mockResolvedValue({
    id: 'ill_1', productName: 'FlexLife', faceAmount: '250000', premium: '180',
    targetPremium: '200', documentUrl: 'https://x/ill.pdf',
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
  it('rescues a request whose document arrived but whose hook missed it', async () => {
    // The completion hook is best-effort on purpose — an outage there must not
    // cost the whole connector event. A carrier run whose PDF exists belongs on
    // the agent's screen, not in the bin.
    mocks.requestFindMany.mockResolvedValue([{ id: 'req_1' }])
    mocks.requestUpdateMany.mockResolvedValue({ count: 0 })
    expect(await expireStaleIllustrationRequests(now)).toMatchObject({ recovered: 1 })
    expect(mocks.requestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['req_1'] }, status: 'GENERATING' },
      data: { status: 'READY_TO_SEND' },
    }))
  })

  it('releases every slot nobody is using: dead run, unsent, and stuck send', async () => {
    mocks.requestUpdateMany.mockResolvedValue({ count: 2 })
    expect(await expireStaleIllustrationRequests(now)).toEqual({ expired: 6, recovered: 0 })
    // The dead run is measured against the connector command's own expiry...
    expect(mocks.requestUpdateMany.mock.calls[0][0].where.createdAt.lt)
      .toEqual(new Date('2026-03-11T16:00:00Z'))
    // ...the unsent figures against how long a quote stays current...
    expect(mocks.requestUpdateMany.mock.calls[1][0].where.createdAt.lt)
      .toEqual(new Date('2026-03-08T17:00:00Z'))
    // ...and a claimed delivery whose process died, which would otherwise hold
    // the client-and-product slot forever.
    expect(mocks.requestUpdateMany.mock.calls[2][0]).toMatchObject({
      where: { status: 'DELIVERING', updatedAt: { lt: new Date('2026-03-11T16:50:00Z') } },
      data: expect.objectContaining({ status: 'FAILED', safeErrorCode: 'DELIVERY_INTERRUPTED' }),
    })
  })
})

describe('illustrationMessage', () => {
  // `Intl` puts a non-breaking space after `US$`, which is correct on a phone
  // and invisible in a diff. Normalised here so an assertion that fails is
  // failing about words, not about whitespace nobody can see.
  const said = (...args: Parameters<typeof illustrationMessage>) =>
    illustrationMessage(...args).replace(/\u00a0/g, ' ')

  const envelope = {
    requestId: 'req_1', agentId: 'a', clientId: 'c', clientName: 'Ana Ribeiro', phone: '+1305',
    language: 'PT', illustrationId: 'i', productName: 'FlexLife', faceAmount: '250000',
    premium: '180', targetPremium: '999', documentUrl: null,
  }

  it('reads like the agent wrote it, not like a form', () => {
    expect(said(envelope)).toBe(
      'Ana, aqui está a simulação que você pediu. É um FlexLife, com US$ 250.000 de cobertura, ' +
      'por US$ 180 por mês. O PDF completo está em anexo. Qualquer dúvida, é só me chamar.',
    )
  })

  it('quotes the carrier number, never the one that was merely asked for', () => {
    // `targetPremium` is the input. Telling a client the figure we requested as
    // though it were the answer would be a quote nobody can be held to.
    expect(said(envelope)).toContain('US$ 180')
    expect(said(envelope)).not.toContain('999')
    // With no carrier result, the target is better than silence — but only then.
    expect(said({ ...envelope, premium: null })).toContain('US$ 999')
  })

  it('quotes the premium to the cent, because the PDF does', () => {
    // Rounding 62.92 to 63 would put a figure in the message that does not
    // match the document attached to it.
    expect(said({ ...envelope, premium: '62.92' })).toContain('US$ 62,92')
    // A whole premium stays whole: `US$ 180,00` reads like a form.
    expect(said({ ...envelope, premium: '180' })).toContain('US$ 180 por mês')
    // Coverage keeps no cents: it is a headline number.
    expect(said(envelope)).toContain('US$ 250.000 de cobertura')
  })

  it('still reads as a sentence when the carrier returned almost nothing', () => {
    const bare = said({
      ...envelope, productName: null, faceAmount: null, premium: null, targetPremium: null,
    })
    expect(bare).not.toMatch(/null|undefined|\$0|,\s*\./)
    expect(bare).toBe(
      'Ana, aqui está a simulação que você pediu. O PDF completo está em anexo. ' +
      'Qualquer dúvida, é só me chamar.',
    )
  })

  it('opens with the cover when there is no product name to lead with', () => {
    const text = said({ ...envelope, productName: null })
    expect(text).toContain('São US$ 250.000 de cobertura, por US$ 180 por mês.')
  })

  it('writes English for an agent whose account is in English', () => {
    const text = said({ ...envelope, language: 'EN' })
    expect(text).toBe(
      'Ana, here is the illustration you asked for. It is a FlexLife, with $250,000 in coverage, ' +
      'at $180 a month. The full PDF is attached. Any questions, just message me.',
    )
  })
})
