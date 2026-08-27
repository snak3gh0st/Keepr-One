import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  enabled: vi.fn(() => true),
  createIllustration: vi.fn(),
  issue: vi.fn(),
  approve: vi.fn(),
  repository: {},
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

import { requestForesightIllustration } from './actions'

function form(): FormData {
  const value = new FormData()
  value.set('product', 'FLEXLIFE_IUL')
  value.set('firstName', 'KeeprOne')
  value.set('lastName', 'Test')
  value.set('dateOfBirth', '1981-08-26')
  value.set('issueState', 'FL')
  value.set('gender', 'Male')
  value.set('rateClass', 'Standard_NT')
  value.set('faceAmount', '250000')
  value.set('monthlyPremium', '350')
  value.set('deathBenefitOption', 'A_Level')
  value.set('strategy', 'SP500PointToPointCapFocus')
  return value
}

describe('request official FlexLife illustration through KeeproneConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.getAgent.mockResolvedValue({ id: 'agent_1', userId: 'user_1' })
    mocks.createIllustration.mockResolvedValue({
      id: 'ill_foresight_1',
      createdAt: new Date('2026-08-26T22:30:00.000Z'),
    })
    mocks.issue.mockResolvedValue({
      command: { commandId: 'cmd_foresight_1' },
      payloadHash: 'a'.repeat(64),
      duplicate: false,
    })
    mocks.approve.mockResolvedValue(undefined)
  })

  it('issues the approved Foresight request to the local extension and never enqueues Steel', async () => {
    await expect(requestForesightIllustration(form())).resolves.toEqual({
      ok: true,
      commandId: 'cmd_foresight_1',
      illustrationId: 'ill_foresight_1',
    })

    expect(mocks.createIllustration).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agentId: 'agent_1',
        kind: 'PRELIMINARY',
        productName: 'FlexLife',
        insuredName: 'KeeprOne Test',
        faceAmount: 250000,
        premium: null,
        targetPremium: 350,
        targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
        rawPayload: {
          foresightDraft: expect.objectContaining({
            schemaVersion: 1,
            faceAmount: 250000,
            monthlyPremium: 350,
            issueState: 'FL',
          }),
        },
      }),
    }))
    expect(mocks.issue).toHaveBeenCalledWith(mocks.repository, expect.objectContaining({
      agentId: 'agent_1',
      capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'ill_foresight_1' },
      params: {
        illustrationId: 'ill_foresight_1',
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    }))
    expect(mocks.approve).toHaveBeenCalledWith(mocks.repository, {
      agentId: 'agent_1',
      commandId: 'cmd_foresight_1',
      payloadHash: 'a'.repeat(64),
      confirmedByUserId: 'user_1',
    })
  })

  it('does not create local work when KeeproneConnect is disabled', async () => {
    mocks.enabled.mockReturnValue(false)

    await expect(requestForesightIllustration(form())).resolves.toEqual({
      ok: false,
      message: 'Conecte o KeeproneConnect para gerar a ilustração oficial.',
    })
    expect(mocks.createIllustration).not.toHaveBeenCalled()
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('requires a monthly premium before it creates any carrier work', async () => {
    const missingPremium = form()
    missingPremium.delete('monthlyPremium')
    await expect(requestForesightIllustration(missingPremium)).resolves.toEqual({
      ok: false,
      message: 'Informe um prêmio mensal maior que zero.',
    })
    expect(mocks.createIllustration).not.toHaveBeenCalled()
  })

  it('issues a premium-solved IUL command without fabricating a face amount', async () => {
    const premiumSolved = form()
    premiumSolved.set('solveBasis', 'PREMIUM')
    premiumSolved.delete('faceAmount')

    await expect(requestForesightIllustration(premiumSolved)).resolves.toEqual({
      ok: true,
      commandId: 'cmd_foresight_1',
      illustrationId: 'ill_foresight_1',
    })
    expect(mocks.createIllustration).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        faceAmount: null,
        premium: null,
        targetPremium: 350,
        targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
        rawPayload: {
          foresightDraft: expect.objectContaining({
            schemaVersion: 2,
            solveBasis: 'PREMIUM',
            targetMonthlyPremium: 350,
          }),
        },
      }),
    }))
  })

  it('issues a Term command with the carrier-selected duration and no agent premium', async () => {
    const term = new FormData()
    term.set('product', 'LSW_TERM')
    term.set('firstName', 'KeeprOne')
    term.set('lastName', 'Term')
    term.set('dateOfBirth', '1981-08-26')
    term.set('issueState', 'FL')
    term.set('gender', 'Male')
    term.set('rateClass', 'Standard_NT')
    term.set('faceAmount', '250000')
    term.set('termDuration', '20-G')
    term.set('premiumMode', 'Monthly')

    await expect(requestForesightIllustration(term)).resolves.toEqual({
      ok: true,
      commandId: 'cmd_foresight_1',
      illustrationId: 'ill_foresight_1',
    })
    expect(mocks.createIllustration).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        productName: 'LSW Term',
        insuredName: 'KeeprOne Term',
        faceAmount: 250000,
        premium: null,
        targetPremium: null,
        targetPremiumSource: 'CARRIER_CALCULATED_FOR_TERM',
        rawPayload: expect.objectContaining({
          foresightTermDraft: expect.objectContaining({
            schemaVersion: 1,
            carrierProduct: 'LSW Term',
            termDuration: '20-G',
            premiumMode: 'Monthly',
            faceAmount: 250000,
            issueState: 'FL',
          }),
        }),
      }),
    }))
  })
})
