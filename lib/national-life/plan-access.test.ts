import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAgentAccessForAgent: vi.fn() }))

vi.mock('@/lib/agent-access', () => ({
  getAgentAccessForAgent: mocks.getAgentAccessForAgent,
}))

import {
  canAgentReadNationalLifeGrid,
  filterNationalLifeGridKeysForAgent,
  isNationalLifeAgencyOnlyGrid,
  NATIONAL_LIFE_PERSONAL_GRID_KEYS,
  sanitizeNationalLifeSyncStatusForAgent,
} from './plan-access'

describe('National Life plan source boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('classifies the agency premium source explicitly', () => {
    expect(isNationalLifeAgencyOnlyGrid('PREMIUM_REPORT_AGENCY')).toBe(true)
    expect(isNationalLifeAgencyOnlyGrid('INFORCE_CLIENTS')).toBe(false)
  })

  it('removes agency-only sources from an individual run plan', async () => {
    mocks.getAgentAccessForAgent.mockResolvedValue({
      isActive: true,
      canViewAgencyNationalLife: false,
    })

    await expect(
      filterNationalLifeGridKeysForAgent('agent-1', [
        'INFORCE_CLIENTS',
        'PREMIUM_REPORT_AGENCY',
      ]),
    ).resolves.toEqual(['INFORCE_CLIENTS'])
  })

  it('fails closed for every unclassified or discovery-only source', async () => {
    mocks.getAgentAccessForAgent.mockResolvedValue({
      isActive: true,
      canViewAgencyNationalLife: false,
    })

    expect(NATIONAL_LIFE_PERSONAL_GRID_KEYS).not.toContain('POLICY_PAYMENT_HISTORY')
    await expect(
      canAgentReadNationalLifeGrid('agent-1', 'POLICY_PAYMENT_HISTORY'),
    ).resolves.toBe(false)
  })

  it('keeps paid commissions before its earning-detail drill-down for individual runs', () => {
    const paidIndex = NATIONAL_LIFE_PERSONAL_GRID_KEYS.indexOf('PAID_COMMISSIONS')
    const detailIndex = NATIONAL_LIFE_PERSONAL_GRID_KEYS.indexOf('COMMISSIONS_EARNING_REPORT')

    expect(paidIndex).toBeGreaterThanOrEqual(0)
    expect(detailIndex).toBeGreaterThan(paidIndex)
  })

  it('allows the agency source only for the entitled owner', async () => {
    mocks.getAgentAccessForAgent.mockResolvedValue({
      isActive: true,
      canViewAgencyNationalLife: true,
    })

    await expect(
      canAgentReadNationalLifeGrid('owner-1', 'PREMIUM_REPORT_AGENCY'),
    ).resolves.toBe(true)
  })

  it('rejects every connector source after the agent is deactivated', async () => {
    mocks.getAgentAccessForAgent.mockResolvedValue({
      isActive: false,
      canViewAgencyNationalLife: true,
    })

    await expect(
      filterNationalLifeGridKeysForAgent('owner-1', [
        'INFORCE_CLIENTS',
        'PREMIUM_REPORT_AGENCY',
      ]),
    ).resolves.toEqual([])
  })

  it('removes historical agency progress and aggregate counts after downgrade', async () => {
    mocks.getAgentAccessForAgent.mockResolvedValue({
      isActive: true,
      canViewAgencyNationalLife: false,
    })

    const sanitized = await sanitizeNationalLifeSyncStatusForAgent('agent-1', {
      runId: 'run-1',
      state: 'COMPLETED',
      completed: 2,
      total: 2,
      percent: 100,
      failed: 0,
      currentGridKey: 'PREMIUM_REPORT_AGENCY',
      currentGridLabel: 'premium report',
      safeErrorCode: null,
      shouldPoll: false,
      completedAt: new Date(),
      receivedRecords: 120,
      writtenRecords: 120,
      duplicateRecords: 0,
      rejectedRecords: 0,
      stageCoverage: [
        {
          gridKey: 'INFORCE_CLIENTS',
          label: 'in-force policies',
          state: 'VERIFIED',
          verifiedRecords: 20,
        },
        {
          gridKey: 'PREMIUM_REPORT_AGENCY',
          label: 'premium report',
          state: 'VERIFIED',
          verifiedRecords: 100,
        },
      ],
    })

    expect(sanitized).toMatchObject({
      completed: 1,
      total: 1,
      percent: 100,
      currentGridKey: null,
      receivedRecords: null,
      writtenRecords: null,
      stageCoverage: [{ gridKey: 'INFORCE_CLIENTS' }],
    })
  })
})
