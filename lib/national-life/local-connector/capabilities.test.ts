import { describe, expect, it, vi } from 'vitest'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import {
  PLANNED_LOCAL_CONNECTOR_CAPABILITIES,
  isSafeNavigatePath,
  planReadGridStages,
  planReadPageStages,
  planReadExportStages,
} from './capabilities'
import { LOCAL_CONNECTOR_ROUTED_GRIDS, planRawIngest } from './raw-ingest'
import {
  LOCAL_CONNECTOR_DEFAULT_GRID_KEYS,
  LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS,
} from './run-service'

describe('isSafeNavigatePath', () => {
  it('accepts a portal agent path', () => {
    expect(isSafeNavigatePath('/agent/book-of-business/new-business/all-new-business-cases')).toBe(true)
  })

  it('rejects anything outside the agent tree', () => {
    expect(isSafeNavigatePath('/NWI/Main/Layout.aspx')).toBe(false)
    expect(isSafeNavigatePath('/agent/../admin')).toBe(false)
    expect(isSafeNavigatePath('https://evil.example/agent/x')).toBe(false)
    expect(isSafeNavigatePath('//evil.example/agent/x')).toBe(false)
    expect(isSafeNavigatePath('/agent/x?next=/y')).toBe(false)
  })

  it('rejects a scheme, a bare authority, and a fragment', () => {
    expect(isSafeNavigatePath('javascript:alert(1)')).toBe(false)
    expect(isSafeNavigatePath('/agent/x@evil.example')).toBe(false)
    expect(isSafeNavigatePath('/agent/x#fragment')).toBe(false)
  })

  it('rejects characters the whitelist regex excludes, even without a literal ".."', () => {
    // These carry no literal `..` and would slip past the earlier checks, but the
    // trailing `[A-Za-z0-9/_-]` whitelist rejects backslash and percent-encoding
    // outright, so a URL parser never gets the chance to normalize them.
    expect(isSafeNavigatePath('/agent/x\\y')).toBe(false)
    expect(isSafeNavigatePath('/agent/%2e%2e/admin')).toBe(false)
  })
})

describe('planReadGridStages', () => {
  it('maps each grid key to its portal path', () => {
    expect(planReadGridStages(['NEW_BUSINESS'])).toEqual([
      {
        capability: 'READ_GRID',
        params: {
          gridKey: 'NEW_BUSINESS',
          navigatePath: '/agent/book-of-business/new-business/all-new-business-cases',
        },
      },
    ])
  })

  it('uses the authenticated in-force grid route after the portal redirect', () => {
    expect(planReadGridStages(['INFORCE_CLIENTS'])).toEqual([{
      capability: 'READ_GRID',
      params: {
        gridKey: 'INFORCE_CLIENTS',
        navigatePath:
          '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
      },
    }])
  })

  it('produces a plan every routed grid key can reach', () => {
    const keys = [...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS]
    const plan = planReadGridStages(keys)
    expect(plan).toHaveLength(keys.length)
    expect(plan.every((stage) => isSafeNavigatePath(stage.params.navigatePath))).toBe(true)
  })

  it('plans the default operational sync set', () => {
    expect(LOCAL_CONNECTOR_DEFAULT_GRID_KEYS).toEqual([
      'NEW_BUSINESS',
      'RECENTLY_CLOSED',
      'INFORCE_CLIENTS',
      'PAID_COMMISSIONS',
      'CLIENT_INTELLIGENCE',
      'CORRESPONDENCE',
      'COMMISSIONS_PAYMENT_PORTAL',
      'PIP_PENDING',
      'TRANSFERS_EXCHANGES',
      'LIFE_PENDING_LAPSE',
      'COMMISSIONS_EARNING_REPORT',
      'PAYABLE_GROSS_COMMISSIONS',
    ])
    expect(LOCAL_CONNECTOR_DISCOVERY_GRID_KEYS).toEqual([
      ...LOCAL_CONNECTOR_DEFAULT_GRID_KEYS,
      'AGENT_DASHBOARD',
      'PREMIUM_REPORT_AGENCY',
      'POLICY_PAYMENT_HISTORY',
      'LIFE_PERSISTENCY',
      'PENDING_GROSS_COMMISSIONS',
      'COMMISSIONS_OVERVIEW',
      'COMMISSIONS_POLICY_HISTORY',
      'PLACEMENT_REPORT',
      'DAILY_UNIT_VALUES',
      'PIP_CONTRIBUTION_INCREASE',
      'ANNUITY_PAST_DUE_CONTRIBUTIONS',
      'ANNUITY_PAYROLL_FLOW_CHANGES',
      'INFORMAL_REQUESTS',
      'TRANSFER_COMPANY_INFORMATION',
    ])
  })

  it('plans server-rendered sources with READ_PAGE', () => {
    expect(planReadPageStages(['COMMISSIONS_OVERVIEW'])).toEqual([{
      capability: 'READ_PAGE',
      params: {
        sourceKey: 'COMMISSIONS_OVERVIEW',
        navigatePath: '/agent/compensation/commissions/overview',
      },
    }])
  })

  it('plans the official in-force XLSX export with contacts', () => {
    expect(planReadExportStages(['INFORCE_CLIENTS'])).toEqual([{
      capability: 'READ_EXPORT',
      params: {
        sourceKey: 'INFORCE_CLIENTS',
        navigatePath: '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
        includeContactInformation: true,
      },
    }])
    expect(() => planReadExportStages(['NEW_BUSINESS'])).toThrow(/no official export collector/)
  })

  it('never lets a source run with the wrong collector', () => {
    expect(() => planReadGridStages(['COMMISSIONS_OVERVIEW'])).toThrow(/requires READ_PAGE/)
    expect(() => planReadPageStages(['NEW_BUSINESS'])).toThrow(/requires READ_GRID/)
  })

  it('pins the routed set to what planRawIngest actually does, in both directions', () => {
    // Bidirectional: a key can neither be exported without being routed, nor routed
    // without being exported. One direction alone lets the two drift.
    for (const gridKey of Object.keys(NATIONAL_LIFE_GRIDS) as NationalLifeGridKey[]) {
      const routes = () => {
        planRawIngest(gridKey, [])
      }
      if (LOCAL_CONNECTOR_ROUTED_GRIDS.has(gridKey)) {
        expect(routes).not.toThrow()
      } else {
        expect(routes).toThrow(/No ingest route for grid/)
      }
    }
  })

  it('collapses a repeated grid key into a single stage', () => {
    // A repeated key would give two stages the same receipt coordinates
    // (runId, gridKey, sequence), so the second stage's chunks collide with the first's.
    const plan = planReadGridStages(['NEW_BUSINESS', 'INFORCE_CLIENTS', 'NEW_BUSINESS'])
    expect(plan.map((stage) => stage.params.gridKey)).toEqual([
      'NEW_BUSINESS',
      'INFORCE_CLIENTS',
    ])
  })

  it('refuses a plan in which two grids share a navigate path', async () => {
    // Unreachable through today's catalogue (every path is distinct), so the check is
    // exercised against a catalogue that points two keys at one page. The device
    // advances stages by navigating, so an unchanged path means no new document and the
    // previous grid's rows would be uploaded under the new grid's key.
    vi.resetModules()
    vi.doMock('@/lib/national-life/portal-grid-client', () => ({
      NATIONAL_LIFE_GRIDS: { A_GRID: '/agent/shared', B_GRID: '/agent/shared' },
    }))
    vi.doMock('../read-coverage', () => ({
      NATIONAL_LIFE_AUTOMATIC_GRID_KEYS: ['A_GRID', 'B_GRID'],
      NATIONAL_LIFE_DISCOVERY_PAGE_KEYS: [],
    }))
    // The invented keys are by definition unroutable; stubbing the routing check
    // keeps this test on the path-collision behaviour it exists to pin.
    vi.doMock('./raw-ingest', () => ({ isRoutedGrid: () => true }))
    try {
      const { planReadGridStages: planWithCollidingCatalogue } = await import('./capabilities')
      expect(() =>
        planWithCollidingCatalogue([
          'A_GRID' as NationalLifeGridKey,
          'B_GRID' as NationalLifeGridKey,
        ]),
      ).toThrow(/Duplicate navigate path/)
    } finally {
      vi.doUnmock('@/lib/national-life/portal-grid-client')
      vi.doUnmock('../read-coverage')
      vi.doUnmock('./raw-ingest')
      vi.resetModules()
    }
  })

  it('keeps every catalogue path distinct', () => {
    const paths = Object.values(NATIONAL_LIFE_GRIDS)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('rejects a grid key that is not an own property of the catalogue', () => {
    // Types are gone at runtime; a caller could pass an unknown or inherited key
    // (e.g. `toString`, `__proto__`). Both must fail loudly, not resolve to a
    // non-string `navigatePath` that slips past isSafeNavigatePath as a TypeError.
    expect(() =>
      planReadGridStages(['NOT_A_REAL_GRID' as NationalLifeGridKey]),
    ).toThrow(/Unknown grid key/)
    expect(() =>
      planReadGridStages(['toString' as NationalLifeGridKey]),
    ).toThrow(/Unknown grid key/)
  })
})

describe('PLANNED_LOCAL_CONNECTOR_CAPABILITIES', () => {
  it('declares every protocol capability while the extension executes only its closed subset', () => {
    expect(PLANNED_LOCAL_CONNECTOR_CAPABILITIES).toEqual([
      'READ_GRID',
      'READ_PAGE',
      'READ_EXPORT',
      'FORESIGHT_INVENTORY',
      'FORESIGHT_CASE_DETAIL',
      'FORESIGHT_REPORT',
      'READ_APPLICATION_STATUS',
      'READ_UNDERWRITING_STATUS',
      'READ_DOCUMENT_REQUIREMENTS',
      'READ_POLICY_DETAIL',
      'READ_COMMISSIONS',
      'OPEN_APPLICATION',
      'OPEN_EAPP',
      'OPEN_POLICY',
      'OPEN_ILLUSTRATION',
      'FLEXLIFE_QUOTE',
      'GENERATE_ILLUSTRATION',
      'PREPARE_APPLICATION_DRAFT',
      'UPLOAD_APPLICATION_DOCUMENT',
      'SUBMIT_APPLICATION',
    ])
  })
})
