import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true),
  findAgent: vi.fn(),
  findClient: vi.fn(),
  lock: vi.fn(),
  findInFlight: vi.fn(),
  createRequest: vi.fn(),
  updateRequests: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
}))
vi.mock('@/lib/national-life/foresight-illustration-dispatch', () => ({
  dispatchForesightIllustration: mocks.dispatch,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    agent: { findUnique: mocks.findAgent },
    client: { findFirst: mocks.findClient },
    kBotIllustrationRequest: { updateMany: mocks.updateRequests },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.lock,
      kBotIllustrationRequest: { findFirst: mocks.findInFlight, create: mocks.createRequest },
    }),
  },
}))

import { requestIllustrationForSignal, type IllustrationQuoteInput } from './trigger'

const QUOTE: IllustrationQuoteInput = {
  productKey: 'FLEXLIFE_IUL',
  issueState: 'FL',
  gender: 'Male',
  rateClass: 'Standard_NT',
  faceAmount: 250_000,
  monthlyPremium: 350,
  deathBenefitOption: 'A_Level',
}

function call(overrides: Partial<Parameters<typeof requestIllustrationForSignal>[0]> = {}) {
  return requestIllustrationForSignal({
    agentId: 'agent_1',
    userId: 'user_1',
    signal: { conversationId: 'conv_1', clientId: 'client_1', detectedBy: 'KBOT_INTENT', excerpt: 'quanto ficaria?' },
    quote: QUOTE,
    ...overrides,
  })
}

describe('raising an illustration from a conversation signal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.findAgent.mockResolvedValue({ adminProvisionedAccess: null, agencyInvitationsAccepted: [] })
    mocks.findClient.mockResolvedValue({ id: 'client_1', name: 'Maria Silva', dateOfBirth: new Date('1981-08-26T00:00:00.000Z') })
    mocks.findInFlight.mockResolvedValue(null)
    mocks.createRequest.mockResolvedValue({ id: 'req_1' })
    mocks.updateRequests.mockResolvedValue({ count: 1 })
    mocks.dispatch.mockResolvedValue({
      command: { commandId: 'cmd_1' },
      illustrationId: 'ill_1',
      reusedActiveCommand: false,
    })
  })

  it('creates the request and dispatches one carrier command', async () => {
    const result = await call()
    expect(result).toEqual({ ok: true, requestId: 'req_1', illustrationId: 'ill_1', commandId: 'cmd_1' })
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    const created = mocks.createRequest.mock.calls[0][0]
    // It starts in GENERATING: nothing here is deliverable yet.
    expect(created.data.status).toBe('GENERATING')
    expect(created.data.signal).toMatchObject({ conversationId: 'conv_1', detectedBy: 'KBOT_INTENT' })
    expect(mocks.updateRequests).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'req_1', agentId: 'agent_1', status: 'GENERATING' },
      data: { illustrationId: 'ill_1', commandId: 'cmd_1' },
    }))
  })

  it('refuses a duplicate while one is already in flight for the same client and product', async () => {
    mocks.findInFlight.mockResolvedValue({ id: 'req_existing', illustrationId: 'ill_existing' })
    const result = await call()
    expect(result).toEqual({ ok: false, reason: 'ALREADY_IN_FLIGHT', requestId: 'req_existing' })
    expect(mocks.createRequest).not.toHaveBeenCalled()
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.lock).toHaveBeenCalled()
    const where = mocks.findInFlight.mock.calls[0][0].where
    expect(where).toMatchObject({ agentId: 'agent_1', clientId: 'client_1', productKey: 'FLEXLIFE_IUL' })
  })

  it('does not start a second carrier run while the connector is already generating', async () => {
    mocks.dispatch.mockResolvedValue({
      command: { commandId: 'cmd_other' },
      illustrationId: 'ill_other',
      reusedActiveCommand: true,
    })
    const result = await call()
    expect(result).toEqual({ ok: false, reason: 'CARRIER_RUN_IN_PROGRESS', requestId: 'req_1' })
    // The request is closed rather than wired to someone else's numbers.
    expect(mocks.updateRequests).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', safeErrorCode: 'CARRIER_RUN_IN_PROGRESS' }),
    }))
  })

  it('reads the client only inside the agent book', async () => {
    mocks.findClient.mockResolvedValue(null)
    const result = await call()
    expect(result).toEqual({ ok: false, reason: 'CLIENT_NOT_IN_BOOK' })
    expect(mocks.findClient).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'client_1', assignedAgentId: 'agent_1' },
    }))
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('refuses when the agent has no illustrations module', async () => {
    mocks.findAgent.mockResolvedValue({
      adminProvisionedAccess: { modules: ['CASES'] },
      agencyInvitationsAccepted: [],
    })
    const result = await call()
    expect(result).toEqual({ ok: false, reason: 'ILLUSTRATIONS_MODULE_DISABLED' })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('refuses rather than inventing a missing carrier input', async () => {
    mocks.findClient.mockResolvedValue({ id: 'client_1', name: 'Maria Silva', dateOfBirth: null })
    expect(await call()).toEqual({ ok: false, reason: 'CLIENT_DATE_OF_BIRTH_MISSING' })

    mocks.findClient.mockResolvedValue({ id: 'client_1', name: 'Maria', dateOfBirth: new Date('1981-08-26') })
    expect(await call()).toEqual({ ok: false, reason: 'CLIENT_NAME_INCOMPLETE' })

    mocks.findClient.mockResolvedValue({ id: 'client_1', name: 'Maria Silva', dateOfBirth: new Date('1981-08-26') })
    expect(await call({ quote: { ...QUOTE, faceAmount: 0 } })).toEqual({ ok: false, reason: 'QUOTE_INPUT_INVALID' })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('refuses when the connector is not connected in this browser', async () => {
    mocks.enabled.mockReturnValue(false)
    expect(await call()).toEqual({ ok: false, reason: 'CONNECTOR_NOT_CONNECTED' })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})
