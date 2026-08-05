import { describe, expect, it } from 'vitest'
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
