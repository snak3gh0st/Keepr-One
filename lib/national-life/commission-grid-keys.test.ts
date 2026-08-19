import { describe, expect, it } from 'vitest'
import { COMMISSION_EARNING_GRID_KEYS } from './commission-grid-keys'
import { NATIONAL_LIFE_GRIDS } from './portal-grid-client'

describe('COMMISSION_EARNING_GRID_KEYS', () => {
  /// The screens queried only the retired REMOTE engine's key while the local
  /// connector wrote the catalogue one, so every commission read matched zero
  /// rows no matter how many the sync collected.
  it('includes the key the local connector actually writes', () => {
    expect(COMMISSION_EARNING_GRID_KEYS).toContain('COMMISSIONS_EARNING_REPORT')
  })

  /// Reading both keys is what makes the fix safe: rows written before the
  /// engine changed still carry the legacy key, and dropping it would hide
  /// history this change has no way to migrate.
  it('keeps reading the retired engine key so older rows survive', () => {
    expect(COMMISSION_EARNING_GRID_KEYS).toContain('COMMISSION_DETAIL_NLD_COMMISSION_EARNING')
  })

  /// A typo in the live key fails the same way the original bug did — silently,
  /// with an empty screen — so it is pinned against the real catalogue.
  it('names a grid the portal catalogue actually defines', () => {
    expect(Object.keys(NATIONAL_LIFE_GRIDS)).toContain('COMMISSIONS_EARNING_REPORT')
  })
})
