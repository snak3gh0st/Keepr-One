import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  enabled: vi.fn(() => true),
  createIllustration: vi.fn(),
  issue: vi.fn(),
  approve: vi.fn(),
  repository: {},
  enqueueLegacyJob: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getAgent }))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    illustration: { create: mocks.createIllustration },
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      illustration: { create: mocks.createIllustration },
    }),
  },
}))
vi.mock('@/lib/national-life/job-service', () => ({
  enqueueRapidSolveQuote: mocks.enqueueLegacyJob,
}))
vi.mock('@/lib/national-life/connector-command-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/national-life/connector-command-service')>(
    '@/lib/national-life/connector-command-service',
  )
  return {
    ...actual,
    issueConnectorCommand: mocks.issue,
    approveConnectorCommand: mocks.approve,
    createPrismaConnectorCommandRepository: () => mocks.repository,
  }
})

import { requestCarrierQuote } from './actions'

function form(): FormData {
  const value = new FormData()
  value.set('firstName', 'KeeprOne')
  value.set('lastName', 'Test')
  value.set('dateOfBirth', '1981-08-26')
  value.set('issueState', 'FL')
  value.set('gender', 'Male')
  value.set('rateClass', 'Standard_NT')
  value.set('solveType', 'Specify_Amount')
  value.set('amount', '250000')
  value.set('deathBenefitOption', 'A_Level')
  value.set('strategy', 'SP500PointToPointCapFocus')
  return value
}

describe('request FlexLife quote through KeeproneConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.getAgent.mockResolvedValue({ id: 'agent_1', userId: 'user_1' })
    mocks.createIllustration.mockResolvedValue({
      id: 'ill_quote_1',
      createdAt: new Date('2026-08-26T22:30:00.000Z'),
    })
    mocks.issue.mockResolvedValue({
      command: { commandId: 'cmd_quote_1' },
      payloadHash: 'a'.repeat(64),
      duplicate: false,
    })
    mocks.approve.mockResolvedValue(undefined)
  })

  it('issues the approved quote to the local extension and never enqueues Steel', async () => {
    await expect(requestCarrierQuote(form())).resolves.toEqual({
      ok: true,
      jobId: 'cmd_quote_1',
      commandId: 'cmd_quote_1',
      illustrationId: 'ill_quote_1',
    })

    expect(mocks.enqueueLegacyJob).not.toHaveBeenCalled()
    expect(mocks.createIllustration).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentId: 'agent_1',
        kind: 'PRELIMINARY',
        productName: 'FlexLife',
        insuredName: 'KeeprOne Test',
        faceAmount: 250000,
        rawPayload: {
          request: expect.objectContaining({
            IssueState: 'FL',
            DateOfBirth: '08/26/1981',
            ProductCode: '956',
            Amount: 250000,
          }),
        },
      }),
    }))
    expect(mocks.issue).toHaveBeenCalledWith(mocks.repository, expect.objectContaining({
      agentId: 'agent_1',
      capability: 'FLEXLIFE_QUOTE',
      target: { kind: 'ILLUSTRATION', id: 'ill_quote_1' },
      params: {
        illustrationId: 'ill_quote_1',
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    }))
    expect(mocks.approve).toHaveBeenCalledWith(mocks.repository, {
      agentId: 'agent_1',
      commandId: 'cmd_quote_1',
      payloadHash: 'a'.repeat(64),
      confirmedByUserId: 'user_1',
    })
  })

  it('does not create local work when KeeproneConnect is disabled', async () => {
    mocks.enabled.mockReturnValue(false)

    await expect(requestCarrierQuote(form())).resolves.toEqual({
      ok: false,
      message: 'Conecte o KeeproneConnect para cotar na National Life.',
    })
    expect(mocks.createIllustration).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
    expect(mocks.enqueueLegacyJob).not.toHaveBeenCalled()
  })

  it('refuses quote variants that cannot continue to the official Illustration yet', async () => {
    const unsupported = form()
    unsupported.set('solveType', 'Based_on_Target_Premium')
    await expect(requestCarrierQuote(unsupported)).resolves.toEqual({
      ok: false,
      message: 'Por enquanto, informe o capital segurado para gerar a ilustração oficial.',
    })
    expect(mocks.createIllustration).not.toHaveBeenCalled()

    const unsupportedStrategy = form()
    unsupportedStrategy.set('strategy', 'SP500PointToPointParFocus')
    await expect(requestCarrierQuote(unsupportedStrategy)).resolves.toEqual({
      ok: false,
      message: 'Por enquanto, a ilustração oficial usa S&P 500 — foco em teto.',
    })
    expect(mocks.createIllustration).not.toHaveBeenCalled()
  })
})
