import { describe, expect, it } from 'vitest'
import { NATIONAL_LIFE_PORTAL_ACTIONS, nationalLifePortalActionsFor } from './portal-actions'

describe('National Life portal action catalogue', () => {
  it('has stable unique action IDs', () => {
    const ids = NATIONAL_LIFE_PORTAL_ACTIONS.map((action) => action.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never classifies a carrier write as automatic', () => {
    const writes = NATIONAL_LIFE_PORTAL_ACTIONS.filter((action) =>
      ['GENERATES_CARRIER_ARTIFACT', 'WRITES_CARRIER_DRAFT', 'SUBMITS_TO_CARRIER'].includes(action.risk),
    )
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((action) => action.requiresUserGesture)).toBe(true)
  })

  it('covers application, policy and Foresight action surfaces', () => {
    expect(nationalLifePortalActionsFor('APPLICATION_DETAIL').length).toBeGreaterThan(0)
    expect(nationalLifePortalActionsFor('POLICY_DETAIL').length).toBeGreaterThan(0)
    expect(nationalLifePortalActionsFor('FORESIGHT').length).toBeGreaterThan(0)
  })

  it('models iGO navigation, draft and final submission separately', () => {
    expect(NATIONAL_LIFE_PORTAL_ACTIONS.find((action) => action.id === 'GLOBAL_EAPP')?.risk)
      .toBe('NAVIGATION_ONLY')
    expect(NATIONAL_LIFE_PORTAL_ACTIONS.find((action) => action.id === 'IGO_PREPARE_APPLICATION')?.risk)
      .toBe('WRITES_CARRIER_DRAFT')
    expect(NATIONAL_LIFE_PORTAL_ACTIONS.find((action) => action.id === 'IGO_SUBMIT_APPLICATION')?.risk)
      .toBe('SUBMITS_TO_CARRIER')
  })
})
