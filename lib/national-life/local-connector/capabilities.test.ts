import { describe, expect, it, vi } from 'vitest'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '@/lib/national-life/portal-grid-client'
import { isSafeNavigatePath, planReadGridStages } from './capabilities'

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

  it('produces a plan every grid key can reach', () => {
    const keys = Object.keys(NATIONAL_LIFE_GRIDS) as NationalLifeGridKey[]
    const plan = planReadGridStages(keys)
    expect(plan).toHaveLength(keys.length)
    expect(plan.every((stage) => isSafeNavigatePath(stage.params.navigatePath))).toBe(true)
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
