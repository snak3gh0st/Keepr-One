import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  requireAgentModule: vi.fn(),
  enabled: vi.fn(() => true),
  illustrationFindFirst: vi.fn(),
  illustrationUpdateMany: vi.fn(),
  commandFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  issue: vi.fn(),
  approve: vi.fn(),
  retryAuthentication: vi.fn(),
  revalidate: vi.fn(),
  language: { current: 'PT' as 'PT' | 'EN' },
  extractTermPremiums: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    language: mocks.language.current,
    copy: (pt: string, en: string) => mocks.language.current === 'PT' ? pt : en,
  }),
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getAgent }))
vi.mock('@/lib/require-agent-module', () => ({
  requireAgentModule: mocks.requireAgentModule,
}))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    illustration: { findFirst: mocks.illustrationFindFirst, updateMany: mocks.illustrationUpdateMany },
    nationalLifeConnectorCommand: { findFirst: mocks.commandFindFirst },
    auditLog: { create: mocks.auditCreate },
  },
}))
vi.mock('@/lib/national-life/foresight-term-pdf', () => ({
  extractForesightTermPremiums: mocks.extractTermPremiums,
}))
vi.mock('@/lib/national-life/connector-command-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/national-life/connector-command-service')>(
    '@/lib/national-life/connector-command-service',
  )
  return {
    ...actual,
    issueConnectorCommand: mocks.issue,
    approveConnectorCommand: mocks.approve,
    retryConnectorCommandAuthentication: mocks.retryAuthentication,
    prismaConnectorCommandRepository: {},
  }
})

import { reconcileTermIllustrationPdf, requestIllustrationPdf } from './actions'

const illustration = {
  id: 'ill_1',
  caseId: null,
  createdAt: new Date('2026-08-26T17:00:00.000Z'),
  productName: 'FlexLife',
  documentFetchedAt: null,
  rawPayload: {
    request: {
      IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '01/01/1990',
      Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount', Amount: 100_000,
      DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus', Allocation: 100,
      ProductCode: '956',
    },
    response: { ok: true, faceAmount: 100_000, monthlyPremium: 250 },
  },
}

const termIllustration = {
  id: 'ill_term_1',
  caseId: null,
  createdAt: new Date('2026-08-30T17:00:00.000Z'),
  productName: 'LSW Term',
  documentFetchedAt: null,
  rawPayload: {
    foresightTermDraft: {
      schemaVersion: 1,
      carrierProduct: 'LSW Term',
      firstName: 'KeeprOne',
      lastName: 'Term',
      dateOfBirth: '1990-01-01',
      issueState: 'FL',
      gender: 'Male',
      rateClass: 'Standard_NT',
      faceAmount: 500_000,
      premiumMode: 'Monthly',
      termDuration: '20-G',
    },
  },
}

describe('request official Foresight illustration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enabled.mockReturnValue(true)
    mocks.language.current = 'PT'
    mocks.getAgent.mockResolvedValue({ id: 'agent_1', userId: 'user_1' })
    mocks.requireAgentModule.mockResolvedValue({ user: { role: 'AGENT' } })
    mocks.illustrationFindFirst.mockResolvedValue(illustration)
    mocks.commandFindFirst.mockReset()
    mocks.commandFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      state: 'QUEUED', confirmationState: 'PENDING',
    })
    mocks.issue.mockResolvedValue({
      command: { commandId: 'cmd_1' }, payloadHash: 'p'.repeat(64), duplicate: false,
    })
    mocks.approve.mockResolvedValue(undefined)
    mocks.retryAuthentication.mockResolvedValue(undefined)
    mocks.illustrationUpdateMany.mockResolvedValue({ count: 1 })
    mocks.auditCreate.mockResolvedValue({ id: 'audit_1' })
    mocks.extractTermPremiums.mockResolvedValue({ monthlyPremium: 62.92, annualPremium: 755.04 })
  })

  it('uses the button click as approval for one immutable command', async () => {
    await expect(requestIllustrationPdf('ill_1')).resolves.toEqual({
      ok: true, commandId: 'cmd_1', duplicate: false, completed: false,
    })
    expect(mocks.issue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      agentId: 'agent_1', capability: 'GENERATE_ILLUSTRATION',
      target: { kind: 'ILLUSTRATION', id: 'ill_1' },
      idempotencyKey: expect.stringMatching(/^foresight:ill_1:[a-f0-9]{64}$/),
    }))
    expect(mocks.approve).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent_1', commandId: 'cmd_1', payloadHash: 'p'.repeat(64), confirmedByUserId: 'user_1',
    })
  })

  it('uses the explicit click to retry one blocked password login without creating another case', async () => {
    mocks.commandFindFirst.mockReset()
    mocks.commandFindFirst.mockResolvedValueOnce({
      id: 'cmd_existing', payloadHash: 'p'.repeat(64), state: 'AUTH_REQUIRED',
      confirmationState: 'APPROVED', expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(requestIllustrationPdf('ill_1')).resolves.toEqual({
      ok: true, commandId: 'cmd_existing', duplicate: true, completed: false, retryingLogin: true,
    })
    expect(mocks.issue).not.toHaveBeenCalled()
    expect(mocks.retryAuthentication).toHaveBeenCalledWith(expect.anything(), {
      agentId: 'agent_1', commandId: 'cmd_existing',
    })
  })

  it('creates one deterministic retry after a terminal attempt', async () => {
    mocks.commandFindFirst.mockReset()
    mocks.commandFindFirst.mockResolvedValueOnce({
      id: 'cmd_failed', payloadHash: 'p'.repeat(64), state: 'FAILED',
      confirmationState: 'APPROVED', expiresAt: new Date(Date.now() + 60_000),
    }).mockResolvedValueOnce({ state: 'QUEUED', confirmationState: 'APPROVED' })
    await requestIllustrationPdf('ill_1')
    expect(mocks.issue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^foresight:ill_1:[a-f0-9]{64}:retry:cmd_failed$/),
    }))
  })

  it('retries a Term illustration with the original Term contract', async () => {
    mocks.illustrationFindFirst.mockResolvedValueOnce(termIllustration)
    mocks.commandFindFirst.mockReset()
    mocks.commandFindFirst.mockResolvedValueOnce({
      id: 'cmd_term_failed', payloadHash: 'p'.repeat(64), state: 'FAILED',
      confirmationState: 'APPROVED', expiresAt: new Date(Date.now() + 60_000),
    }).mockResolvedValueOnce({ state: 'QUEUED', confirmationState: 'APPROVED' })

    await expect(requestIllustrationPdf('ill_term_1')).resolves.toEqual({
      ok: true, commandId: 'cmd_1', duplicate: false, completed: false,
    })
    expect(mocks.issue).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      target: { kind: 'ILLUSTRATION', id: 'ill_term_1' },
      idempotencyKey: expect.stringMatching(/^foresight:ill_term_1:[a-f0-9]{64}:retry:cmd_term_failed$/),
    }))
  })

  it('does not issue work when the signed PDF already exists', async () => {
    mocks.illustrationFindFirst.mockResolvedValueOnce({ ...illustration, documentFetchedAt: new Date() })
    await expect(requestIllustrationPdf('ill_1')).resolves.toEqual({
      ok: true, commandId: '', duplicate: true, completed: true,
    })
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('returns action errors in the selected English language', async () => {
    mocks.language.current = 'EN'
    mocks.illustrationFindFirst.mockResolvedValueOnce(null)

    await expect(requestIllustrationPdf('missing')).resolves.toEqual({
      ok: false,
      message: 'Quote not found.',
    })
  })
})

describe('reconcile stored Term PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.language.current = 'PT'
    mocks.getAgent.mockResolvedValue({ id: 'agent_1', userId: 'user_1' })
    mocks.illustrationUpdateMany.mockResolvedValue({ count: 1 })
    mocks.auditCreate.mockResolvedValue({ id: 'audit_1' })
    mocks.extractTermPremiums.mockResolvedValue({ monthlyPremium: 62.92, annualPremium: 755.04 })
  })

  it('re-reads the signed Term PDF without issuing another carrier command', async () => {
    const documentBytes = new TextEncoder().encode('%PDF-1.7\nterm')
    mocks.illustrationFindFirst.mockResolvedValue({
      ...termIllustration,
      documentMimeType: 'application/pdf',
      documentBytes,
    })

    await expect(reconcileTermIllustrationPdf('ill_term_1')).resolves.toEqual({
      ok: true,
      message: 'Prêmios Term confirmados com o PDF oficial.',
    })

    expect(mocks.illustrationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'ill_term_1', agentId: 'agent_1', productName: { in: ['LSW Term', 'NL Term'] },
      }),
    }))
    expect(mocks.extractTermPremiums).toHaveBeenCalledWith(documentBytes)
    expect(mocks.illustrationUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'ill_term_1', agentId: 'agent_1' }),
      data: expect.objectContaining({
        premium: 62.92,
        rawPayload: expect.objectContaining({
          foresightTermResult: expect.objectContaining({
            confirmedMonthlyPremium: 62.92,
            confirmedAnnualPremium: 755.04,
            requestedTermDuration: '20-G',
          }),
        }),
      }),
    }))
    expect(mocks.illustrationUpdateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('targetPremium')
    expect(mocks.illustrationUpdateMany.mock.calls[0]?.[0]?.data).not.toHaveProperty('targetPremiumSource')
    expect(mocks.issue).not.toHaveBeenCalled()
  })

  it('does not write when the Term parser cannot verify the stored document', async () => {
    mocks.illustrationFindFirst.mockResolvedValue({
      ...termIllustration,
      documentMimeType: 'application/pdf',
      documentBytes: new TextEncoder().encode('%PDF-1.7\nterm'),
    })
    mocks.extractTermPremiums.mockRejectedValue(new Error('FORESIGHT_TERM_PREMIUM_MISSING'))

    await expect(reconcileTermIllustrationPdf('ill_term_1')).resolves.toEqual({
      ok: false,
      message: 'O PDF não trouxe uma tabela de prêmios Term que possa ser confirmada. Gere uma nova ilustração.',
    })
    expect(mocks.illustrationUpdateMany).not.toHaveBeenCalled()
  })
})
