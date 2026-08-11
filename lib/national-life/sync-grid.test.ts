import { describe, expect, it, vi } from 'vitest'
import type { GridPage, NationalLifeGridKey } from './portal-grid-client'
import { syncNationalLifeGrid } from './sync-grid'

const page = {} as GridPage
const fetchedAt = new Date('2026-08-03T17:00:00.000Z')

function dependencies() {
  return {
    fetchGrid: vi.fn(async () => ({
      rows: [{ PolicyNo: 'P-1' }],
      recordsTotal: 1,
      endpoint: '/agent/Datatable/GetJsonResult',
      truncated: false,
    })),
    persistCaseSnapshots: vi.fn(async () => ({ written: 1 })),
    persistInforcePolicies: vi.fn(async () => ({ written: 1 })),
    persistReportRows: vi.fn(async () => ({ written: 1 })),
  }
}

describe('syncNationalLifeGrid', () => {
  it('rejects a registered route outside the automatic read allowlist', async () => {
    await expect(
      syncNationalLifeGrid({
        gridKey: 'PLACEMENT_REPORT' as NationalLifeGridKey,
        page,
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        portalLoginUrl: 'https://national-life.example/login',
        fetchedAt,
        dependencies: dependencies(),
      }),
    ).rejects.toMatchObject({ code: 'GRID_NOT_ALLOWED' })
  })

  it('routes case grids to case snapshot persistence and returns counts', async () => {
    const deps = dependencies()
    const result = await syncNationalLifeGrid({
      gridKey: 'NEW_BUSINESS',
      page,
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      portalLoginUrl: 'https://national-life.example/login',
      fetchedAt,
      dependencies: deps,
    })

    expect(deps.persistCaseSnapshots).toHaveBeenCalledOnce()
    expect(deps.persistInforcePolicies).not.toHaveBeenCalled()
    expect(deps.persistReportRows).not.toHaveBeenCalled()
    expect(result).toMatchObject({ recordsTotal: 1, rowsFetched: 1, truncated: false, written: 1 })
  })

  it('routes inforce and report grids to their dedicated persistence services', async () => {
    const inforceDeps = dependencies()
    await syncNationalLifeGrid({
      gridKey: 'INFORCE_CLIENTS',
      page,
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      portalLoginUrl: 'https://national-life.example/login',
      fetchedAt,
      dependencies: inforceDeps,
    })
    expect(inforceDeps.persistInforcePolicies).toHaveBeenCalledOnce()

    const reportDeps = dependencies()
    await syncNationalLifeGrid({
      gridKey: 'CLIENT_INTELLIGENCE',
      page,
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      portalLoginUrl: 'https://national-life.example/login',
      fetchedAt,
      dependencies: reportDeps,
    })
    expect(reportDeps.persistReportRows).toHaveBeenCalledOnce()
  })

  it.each([
    'TRANSFERS_EXCHANGES',
    'LIFE_PENDING_LAPSE',
    'COMMISSIONS_EARNING_REPORT',
    'PAYABLE_GROSS_COMMISSIONS',
  ] as const)('persists the expanded paginated report %s as raw carrier rows', async (gridKey) => {
    const deps = dependencies()
    await syncNationalLifeGrid({
      gridKey,
      page,
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      portalLoginUrl: 'https://national-life.example/login',
      fetchedAt,
      dependencies: deps,
    })

    expect(deps.persistReportRows).toHaveBeenCalledWith(
      expect.objectContaining({ gridKey, rows: expect.any(Array) }),
    )
  })
})
