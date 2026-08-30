import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  enabled: vi.fn(() => true),
  illustrationFindFirst: vi.fn(),
  commandFindFirst: vi.fn(),
  issue: vi.fn(),
  approve: vi.fn(),
  revalidate: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getAgent }))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    illustration: { findFirst: mocks.illustrationFindFirst },
    nationalLifeConnectorCommand: { findFirst: mocks.commandFindFirst },
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
    prismaConnectorCommandRepository: {},
  }
})

import { requestIllustrationPdf } from './actions'

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
    mocks.getAgent.mockResolvedValue({ id: 'agent_1', userId: 'user_1' })
    mocks.illustrationFindFirst.mockResolvedValue(illustration)
    mocks.commandFindFirst.mockReset()
    mocks.commandFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
      state: 'QUEUED', confirmationState: 'PENDING',
    })
    mocks.issue.mockResolvedValue({
      command: { commandId: 'cmd_1' }, payloadHash: 'p'.repeat(64), duplicate: false,
    })
    mocks.approve.mockResolvedValue(undefined)
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

  it('resumes an assigned login-blocked command instead of creating another case', async () => {
    mocks.commandFindFirst.mockReset()
    mocks.commandFindFirst.mockResolvedValueOnce({
      id: 'cmd_existing', payloadHash: 'p'.repeat(64), state: 'AUTH_REQUIRED',
      confirmationState: 'APPROVED', expiresAt: new Date(Date.now() + 60_000),
    })
    await expect(requestIllustrationPdf('ill_1')).resolves.toEqual({
      ok: true, commandId: 'cmd_existing', duplicate: true, completed: false,
    })
    expect(mocks.issue).not.toHaveBeenCalled()
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
})
