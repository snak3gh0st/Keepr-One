import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  featureEnabled: vi.fn(),
  followupCount: vi.fn(),
  count: vi.fn(),
  localConnectorConfig: vi.fn(),
  getStatus: vi.fn(),
  sanitizeStatus: vi.fn(),
  commandFindFirst: vi.fn(),
  credentialFindUnique: vi.fn(),
  onboardingFindUnique: vi.fn(),
  hasVerifiedNationalLifeSync: vi.fn(),
  illustrationFindFirst: vi.fn(),
  applicationFindFirst: vi.fn(),
}))

vi.mock('@/lib/kbot-followup/domain', () => ({ featureEnabled: mocks.featureEnabled }))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    browserAutomationJob: { count: mocks.count },
    kBotFollowupJob: { count: mocks.followupCount },
    nationalLifeConnectorCommand: { findFirst: mocks.commandFindFirst },
    agentIntegrationCredential: { findUnique: mocks.credentialFindUnique },
    agentOnboarding: { findUnique: mocks.onboardingFindUnique },
    illustration: { findFirst: mocks.illustrationFindFirst },
    application: { findFirst: mocks.applicationFindFirst },
  },
}))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  getNationalLifeLocalConnectorConfig: mocks.localConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE: 'LOCAL_CONNECTOR',
}))
vi.mock('@/lib/national-life/sync-run-service', () => ({
  getNationalLifeSyncStatus: mocks.getStatus,
}))
vi.mock('@/lib/national-life/plan-access', () => ({
  sanitizeNationalLifeSyncStatusForAgent: mocks.sanitizeStatus,
}))
vi.mock('@/lib/agent-onboarding', () => ({
  hasVerifiedNationalLifeSyncForAgent: mocks.hasVerifiedNationalLifeSync,
}))

import { GET } from './route'

const connector = {
  enabled: true,
  extensionTarget: 'abcdefghijklmnopabcdefghijklmnop',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.featureEnabled.mockReturnValue(false)
  mocks.localConnectorConfig.mockReturnValue(connector)
  mocks.getStatus.mockResolvedValue(null)
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.sanitizeStatus.mockImplementation(async (_agentId, status) => status)
  mocks.commandFindFirst.mockResolvedValue(null)
  mocks.illustrationFindFirst.mockResolvedValue(null)
  mocks.applicationFindFirst.mockResolvedValue(null)
  mocks.credentialFindUnique.mockResolvedValue(null)
  mocks.onboardingFindUnique.mockResolvedValue(null)
  mocks.hasVerifiedNationalLifeSync.mockResolvedValue(false)
})

describe('carrier sync badge route', () => {
  it('reports owned follow-up work independently of the local connector', async () => {
    mocks.featureEnabled.mockReturnValue(true)
    mocks.localConnectorConfig.mockReturnValue({ enabled: false })
    mocks.followupCount.mockResolvedValueOnce(3).mockResolvedValueOnce(1)
    const response = await GET()
    expect((await response.json()).followup).toEqual({ working: 3, attention: 1 })
    expect(mocks.followupCount.mock.calls.every(([query]) => query.where.agentId === 'agent-1')).toBe(true)
    expect(mocks.count).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('preserves follow-up counts together with a skipped National Life setup reminder', async () => {
    mocks.featureEnabled.mockReturnValue(true)
    mocks.localConnectorConfig.mockReturnValue({ enabled: false })
    mocks.onboardingFindUnique.mockResolvedValue({ nationalLifeSkippedAt: new Date() })
    mocks.followupCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1)
    const response = await GET()
    expect(await response.json()).toMatchObject({
      nationalLifeSetupRequired: true,
      followup: { working: 2, attention: 1 },
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('counts working jobs across QUEUED, RUNNING and RETRYABLE, and blocked jobs only where a carrier login would revive them', async () => {
    mocks.count.mockResolvedValueOnce(2).mockResolvedValueOnce(0)

    const response = await GET()

    expect(mocks.count).toHaveBeenNthCalledWith(1, {
      where: {
        agentId: 'agent-1',
        provider: NATIONAL_LIFE_PROVIDER,
        operation: { not: 'GET_RAPID_SOLVE_QUOTE' },
        state: { in: ['QUEUED', 'RUNNING', 'RETRYABLE'] },
      },
    })
    // Must mirror releaseJobsBlockedOnCarrierLogin's filter exactly: both
    // ACTION_REQUIRED codes are parks that a fresh carrier login revives.
    // Keeping the count aligned with the drain prevents the badge from going
    // quiet while a job is still waiting, or from inviting a login that cannot
    // clear the state it reports.
    expect(mocks.count).toHaveBeenNthCalledWith(2, {
      where: {
        agentId: 'agent-1',
        provider: NATIONAL_LIFE_PROVIDER,
        operation: { not: 'GET_RAPID_SOLVE_QUOTE' },
        state: 'ACTION_REQUIRED',
        safeErrorCode: {
          in: ['FORESIGHT_SSO_EXPIRED', 'NATIONAL_LIFE_RECONNECT_REQUIRED'],
        },
      },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      state: { kind: 'WORKING', count: 2 },
      connector,
    })
  })

  it('reports NEEDS_YOU from the login-required count', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'NEEDS_YOU', count: 1 },
      connector,
    })
  })

  it('does not ask for login from an expired illustration command', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.commandFindFirst.mockResolvedValue({
      state: 'AUTH_REQUIRED',
      target: { kind: 'ILLUSTRATION', id: 'ill-expired' },
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    })

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'IN_SYNC' },
      connector,
    })
  })

  it('reports an illustration independently from a simultaneous sync', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.commandFindFirst.mockResolvedValue({
      state: 'RUNNING',
      deviceId: 'device-1',
      target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
      expiresAt: new Date('2027-08-27T17:00:00.000Z'),
      updatedAt: new Date('2026-08-27T15:00:00.000Z'),
    })

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'IN_SYNC' },
      connector,
      illustration: {
        id: 'ill-1',
        state: 'WORKING',
        updatedAt: '2026-08-27T15:00:00.000Z',
      },
    })
  })

  it('reports a queued illustration without a device as waiting for K-Bot', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.commandFindFirst.mockResolvedValue({
      state: 'QUEUED',
      deviceId: null,
      target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
      expiresAt: new Date('2027-08-27T17:00:00.000Z'),
      updatedAt: new Date('2026-08-27T15:00:00.000Z'),
    })

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'IN_SYNC' },
      connector,
      illustration: {
        id: 'ill-1',
        state: 'NEEDS_KBOT',
        updatedAt: '2026-08-27T15:00:00.000Z',
      },
    })
  })

  it('exposes only the enabled automatic-sign-in setting to the agent who owns it', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.credentialFindUnique.mockResolvedValue({ autoLoginEnabled: true })

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'IN_SYNC' },
      connector: { ...connector, autoLoginEnabled: true },
    })
    expect(mocks.credentialFindUnique).toHaveBeenCalledWith({
      where: { agentId_provider: { agentId: 'agent-1', provider: NATIONAL_LIFE_PROVIDER } },
      select: { autoLoginEnabled: true },
    })
  })

  it('asks K-Bot to keep reminding an agent who explicitly skipped National Life', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.onboardingFindUnique.mockResolvedValue({
      nationalLifeSkippedAt: new Date('2026-09-04T12:00:00.000Z'),
    })

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'IN_SYNC' },
      connector,
      nationalLifeSetupRequired: true,
    })
    expect(mocks.hasVerifiedNationalLifeSync).toHaveBeenCalledWith('agent-1')
  })

  it('clears the reminder after a canonical National Life sync is verified', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.onboardingFindUnique.mockResolvedValue({
      nationalLifeSkippedAt: new Date('2026-09-04T12:00:00.000Z'),
    })
    mocks.hasVerifiedNationalLifeSync.mockResolvedValue(true)

    const response = await GET()

    await expect(response.json()).resolves.toEqual({
      state: { kind: 'IN_SYNC' },
      connector,
    })
  })

  it('calls an illustration ready only after its official PDF is persisted', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.commandFindFirst.mockResolvedValue({
      state: 'COMPLETED',
      target: { kind: 'ILLUSTRATION', id: 'ill-1' },
      safeErrorCode: null,
      expiresAt: new Date('2026-08-27T17:00:00.000Z'),
      updatedAt: new Date('2026-08-27T15:02:00.000Z'),
    })
    mocks.illustrationFindFirst.mockResolvedValue({ documentFetchedAt: new Date('2026-08-27T15:02:00.000Z') })

    const response = await GET()

    expect((await response.json()).illustration).toEqual({
      id: 'ill-1',
      state: 'READY',
      updatedAt: '2026-08-27T15:02:00.000Z',
    })
  })

  it('reports an Application independently from a simultaneous sync and illustration', async () => {
    mocks.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0)
    mocks.commandFindFirst
      .mockResolvedValueOnce({
        state: 'RUNNING', target: { kind: 'ILLUSTRATION', id: 'ill-1' },
        expiresAt: new Date('2027-08-27T17:00:00.000Z'),
        updatedAt: new Date('2026-08-27T15:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        state: 'RUNNING', target: { kind: 'APPLICATION', id: 'app-1' },
        expiresAt: new Date('2027-08-27T17:00:00.000Z'),
        updatedAt: new Date('2026-08-27T15:01:00.000Z'),
      })
    mocks.applicationFindFirst.mockResolvedValue({ caseId: 'case-1', automationState: 'PREPARING_DRAFT' })

    const body = await (await GET()).json()

    expect(body.illustration.state).toBe('WORKING')
    expect(body.application).toEqual({
      id: 'app-1', caseId: 'case-1', state: 'WORKING',
      updatedAt: '2026-08-27T15:01:00.000Z',
    })
  })

  it('reports that the companion cannot connect when the integration is not configured', async () => {
    mocks.localConnectorConfig.mockReturnValue({ enabled: false })

    const response = await GET()

    expect(mocks.getCurrentAgent).toHaveBeenCalledOnce()
    expect(mocks.count).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      state: null,
      connector: { enabled: false, extensionTarget: null },
    })
  })

  it('keeps the setup reminder visible when the connector is not configured yet', async () => {
    mocks.localConnectorConfig.mockReturnValue({ enabled: false })
    mocks.onboardingFindUnique.mockResolvedValue({
      nationalLifeSkippedAt: new Date('2026-09-04T12:00:00.000Z'),
    })

    const response = await GET()

    expect(mocks.count).not.toHaveBeenCalled()
    expect(mocks.hasVerifiedNationalLifeSync).toHaveBeenCalledWith('agent-1')
    await expect(response.json()).resolves.toEqual({
      state: null,
      connector: { enabled: false, extensionTarget: null },
      nationalLifeSetupRequired: true,
    })
  })

  it('renders no badge rather than guess when the agent lookup fails', async () => {
    mocks.getCurrentAgent.mockRejectedValue(new Error('no session'))

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ state: null, connector })
  })

  it('renders no badge rather than guess when the queue query fails', async () => {
    mocks.count.mockRejectedValue(new Error('db unreachable'))

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ state: null, connector })
  })
})
