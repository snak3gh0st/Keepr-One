import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requestFindMany: vi.fn(),
  agentFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    kBotIllustrationRequest: { findMany: mocks.requestFindMany },
    agent: { findUnique: mocks.agentFindUnique },
  },
}))

import { readReadyToSendIllustrations } from './ready-to-send'
import { illustrationMessage } from '@/lib/kbot-illustration/transport'
import { SEND_WINDOW_MS } from '@/lib/kbot-illustration/domain'

const now = new Date('2026-03-11T17:00:00Z')
const createdAt = new Date('2026-03-10T17:00:00Z')

const row = {
  id: 'req-1',
  createdAt,
  client: { id: 'client-1', name: 'Ana Ribeiro', phone: '+13055550142' },
  illustration: {
    id: 'ill-1',
    productName: 'FlexLife',
    faceAmount: '250000',
    targetPremium: '180',
    documentUrl: 'https://x/ill.pdf',
    documentFetchedAt: new Date('2026-03-10T17:05:00Z'),
    documentMimeType: 'application/pdf',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestFindMany.mockResolvedValue([row])
  mocks.agentFindUnique.mockResolvedValue({ user: { language: 'PT' } })
})

describe('reading the quotes waiting to be sent', () => {
  it('only asks for requests still inside the send window', async () => {
    await readReadyToSendIllustrations('agent-1', now)
    expect(mocks.requestFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        agentId: 'agent-1',
        status: 'READY_TO_SEND',
        createdAt: { gte: new Date(now.getTime() - SEND_WINDOW_MS) },
        // The same client scoping the delivery applies, so a reassigned client
        // is not offered a send that would come back as CLIENT_UNREACHABLE.
        client: { assignedAgentId: 'agent-1' },
      },
    }))
  })

  it('never pulls the PDF bytes into the page payload', async () => {
    await readReadyToSendIllustrations('agent-1', now)
    const call = mocks.requestFindMany.mock.calls[0][0]
    expect(JSON.stringify(call.select)).not.toContain('documentBytes')
  })

  it('shows the agent the exact text the send will put in the chat', async () => {
    const [item] = await readReadyToSendIllustrations('agent-1', now)
    expect(item.message).toBe(illustrationMessage({
      requestId: 'req-1',
      agentId: 'agent-1',
      clientId: 'client-1',
      clientName: 'Ana Ribeiro',
      phone: '+13055550142',
      language: 'PT',
      illustrationId: 'ill-1',
      productName: 'FlexLife',
      faceAmount: '250000',
      targetPremium: '180',
      documentUrl: 'https://x/ill.pdf',
    }))
    expect(item.message).toContain('Ana')
  })

  it('writes the preview in the agent language the delivery uses, not the UI locale', async () => {
    mocks.agentFindUnique.mockResolvedValue({ user: { language: 'EN' } })
    const [item] = await readReadyToSendIllustrations('agent-1', now)
    expect(item.message).toContain('here is the illustration you asked for')
  })

  it('reports when the client has no number, instead of offering a send that cannot land', async () => {
    mocks.requestFindMany.mockResolvedValue([{ ...row, client: { ...row.client, phone: null } }])
    const [item] = await readReadyToSendIllustrations('agent-1', now)
    expect(item.reachable).toBe(false)
  })

  it('reports a missing document the same way', async () => {
    mocks.requestFindMany.mockResolvedValue([{
      ...row,
      illustration: { ...row.illustration, documentFetchedAt: null, documentMimeType: null },
    }])
    const [item] = await readReadyToSendIllustrations('agent-1', now)
    expect(item.hasDocument).toBe(false)
  })

  it('leaves out a request with no illustration behind it', async () => {
    mocks.requestFindMany.mockResolvedValue([{ ...row, illustration: null }])
    await expect(readReadyToSendIllustrations('agent-1', now)).resolves.toEqual([])
  })

  it('says when the numbers stop being sendable', async () => {
    const [item] = await readReadyToSendIllustrations('agent-1', now)
    expect(item.expiresAt).toBe(new Date(createdAt.getTime() + SEND_WINDOW_MS).toISOString())
    // Intl separates the symbol with a non-breaking space; the figure is what
    // matters here, not which kind of space the locale chose.
    expect(item.faceAmount?.replace(/\s/g, ' ')).toBe('US$ 250.000')
  })
})
