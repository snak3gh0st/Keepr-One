import { describe, expect, it } from 'vitest'
import { planRawIngest, LocalConnectorRawIngestError } from './raw-ingest'

describe('planRawIngest', () => {
  it('routes new business rows to case snapshots and keeps the raw row', () => {
    const plan = planRawIngest('NEW_BUSINESS', [
      { PolicyNo: 'X1', InsuredName: 'Maria Silva', UnknownColumn: 'keep me' },
    ])
    // Narrow before touching `snapshots`: RawIngestPlan is a union and the
    // REPORT_ROW arm carries `rows`, so an unnarrowed access fails typecheck.
    if (plan.target !== 'CASE_SNAPSHOT') throw new Error('expected CASE_SNAPSHOT')
    expect(plan.snapshots[0].raw).toMatchObject({ UnknownColumn: 'keep me' })
  })

  it('routes inforce rows to policies', () => {
    const plan = planRawIngest('INFORCE_CLIENTS', [{ PolicyNumber: 'P1' }])
    expect(plan.target).toBe('INFORCE_POLICY')
  })

  it('routes commission rows to report rows', () => {
    const plan = planRawIngest('PAID_COMMISSIONS', [{ PolicyNumber: 'P1' }])
    expect(plan.target).toBe('REPORT_ROW')
  })

  it('records duplicate and rejected rows before the normalized upsert', () => {
    const plan = planRawIngest('NEW_BUSINESS', [
      { PolicyNo: 'P1', Status: 'old' },
      { PolicyNo: 'P1', Status: 'new' },
      { InsuredName: 'No stable key' },
    ])

    expect(plan.stats).toEqual({
      receivedCount: 3,
      duplicateCount: 1,
      rejectedCount: 1,
    })
    if (plan.target !== 'CASE_SNAPSHOT') throw new Error('expected CASE_SNAPSHOT')
    expect(plan.snapshots).toHaveLength(1)
    expect(plan.snapshots[0].carrierStatus).toBe('new')
  })

  it('rejects a grid key it does not route with a distinguishable error', () => {
    expect(() => planRawIngest('NOT_A_GRID' as never, [])).toThrow(LocalConnectorRawIngestError)
    try {
      planRawIngest('NOT_A_GRID' as never, [])
      throw new Error('expected planRawIngest to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(LocalConnectorRawIngestError)
      expect((error as LocalConnectorRawIngestError).code).toBe('GRID_NOT_ROUTED')
    }
  })
})
