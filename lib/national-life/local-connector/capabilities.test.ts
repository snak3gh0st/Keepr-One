import { describe, expect, it, vi } from 'vitest'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import {
  LocalConnectorPlanError,
  isSafeNavigatePath,
  planReadGridStages,
} from './capabilities'
import { LOCAL_CONNECTOR_ROUTED_GRIDS, planRawIngest } from './raw-ingest'
import { LOCAL_CONNECTOR_DEFAULT_GRID_KEYS } from './run-service'

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

  it('produces a plan every routed grid key can reach', () => {
    const keys = [...LOCAL_CONNECTOR_ROUTED_GRIDS]
    const plan = planReadGridStages(keys)
    expect(plan).toHaveLength(keys.length)
    expect(plan.every((stage) => isSafeNavigatePath(stage.params.navigatePath))).toBe(true)
  })

  it('plans the default pair', () => {
    expect(planReadGridStages(LOCAL_CONNECTOR_DEFAULT_GRID_KEYS).map((s) => s.params.gridKey)).toEqual([
      'NEW_BUSINESS',
      'INFORCE_CLIENTS',
    ])
  })

  it('refuses a catalogue grid that has no ingest destination', () => {
    // The whole point of planning: a grid the server cannot land anywhere must fail
    // before a run row exists, not on the device once the run is RUNNING.
    expect(() => planReadGridStages(['COMMISSIONS_OVERVIEW'])).toThrow(
      /No ingest destination for grid COMMISSIONS_OVERVIEW/,
    )
    try {
      planReadGridStages(['COMMISSIONS_OVERVIEW'])
    } catch (error) {
      expect(error).toBeInstanceOf(LocalConnectorPlanError)
      expect((error as LocalConnectorPlanError).code).toBe('GRID_NOT_ROUTED')
    }
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
        expect(() => planReadGridStages([gridKey])).not.toThrow()
      } else {
        expect(routes).toThrow(/No ingest route for grid/)
        expect(() => planReadGridStages([gridKey])).toThrow(LocalConnectorPlanError)
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
