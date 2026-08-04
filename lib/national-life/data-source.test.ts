import { describe, expect, it } from 'vitest'
import { chooseMostRecentNationalLifeScope } from './data-source'

describe('chooseMostRecentNationalLifeScope', () => {
  it('chooses the source with the newest case or inforce observation', () => {
    expect(
      chooseMostRecentNationalLifeScope(['LOCAL_CONNECTOR', 'remote'], [
        { deploymentScope: 'remote', observedAt: new Date('2026-08-04T10:00:00Z') },
        { deploymentScope: 'LOCAL_CONNECTOR', observedAt: new Date('2026-08-04T11:00:00Z') },
      ]),
    ).toBe('LOCAL_CONNECTOR')
  })

  it('uses the preferred allowed source when no rows exist', () => {
    expect(chooseMostRecentNationalLifeScope(['LOCAL_CONNECTOR', 'remote'], [null, null])).toBe(
      'LOCAL_CONNECTOR',
    )
  })
})
