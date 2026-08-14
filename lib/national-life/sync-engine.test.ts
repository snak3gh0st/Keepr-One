import { describe, expect, it } from 'vitest'
import {
  CANONICAL_NATIONAL_LIFE_SYNC,
  isCanonicalNationalLifeSync,
  NATIONAL_LIFE_SYNC_ENGINE,
  NATIONAL_LIFE_SYNC_PIPELINE,
} from './sync-engine'

describe('National Life sync engine contract', () => {
  it('pins the complete Keepr One and KeeproneConnect pipeline', () => {
    expect(NATIONAL_LIFE_SYNC_ENGINE).toBe('KEEPRONE_CONNECT')
    expect(NATIONAL_LIFE_SYNC_PIPELINE).toEqual([
      'KEEPRONE_SYNC',
      'KEEPRONE_CONNECT_REQUEST',
      'NATIONAL_LIFE_BROWSER',
      'KEEPRONE_CONNECT_RECEIPT',
      'KEEPRONE_VALIDATE_DEDUPLICATE',
      'KEEPRONE_DATABASE',
      'KEEPRONE_APP_RENDER',
    ])
  })

  it('accepts only the local connector as the canonical source', () => {
    expect(isCanonicalNationalLifeSync(CANONICAL_NATIONAL_LIFE_SYNC)).toBe(true)
    expect(isCanonicalNationalLifeSync({
      ...CANONICAL_NATIONAL_LIFE_SYNC,
      deploymentScope: 'SINGLE_DEPLOYMENT',
    })).toBe(false)
    expect(isCanonicalNationalLifeSync({
      ...CANONICAL_NATIONAL_LIFE_SYNC,
      executionSource: 'REMOTE',
    })).toBe(false)
  })
})
