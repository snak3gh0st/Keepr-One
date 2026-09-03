import { describe, expect, it, vi } from 'vitest'
import { loadNationalPolicyQueues } from './policy-queues-prisma'

describe('loadNationalPolicyQueues', () => {
  const observedAt = new Date('2026-09-03T15:00:00Z')
  function db() {
    const caseFindMany = vi.fn().mockResolvedValue([
      { policyNo: 'A', insuredName: 'One', product: 'IUL', carrierStatus: 'APPROVED', deliveryStatus: '-', submitDate: null },
      { policyNo: 'B', insuredName: 'Two', product: 'Term', carrierStatus: 'Issued', deliveryStatus: 'eDelivery with Agent', submitDate: null },
      { policyNo: 'C', insuredName: 'Three', product: 'IUL', carrierStatus: 'Issued', deliveryStatus: 'eDelivery with Client', submitDate: null },
    ])
    const completionFindFirst = vi.fn().mockResolvedValue({ expectedRecordCount: 3, receivedRecordCount: 3,
      finalSequence: 0, truncated: false, run: { rawGridPages: [{ sequence: 0, recordCount: 3, observedAt }] } })
    return { prisma: { nationalLifeConnectorStageCompletion: { findFirst: completionFindFirst },
      nationalLifeCaseSnapshot: { findMany: caseFindMany } }, caseFindMany, completionFindFirst }
  }
  it('returns exact queues only from a completed agent-owned snapshot', async () => {
    const { prisma, caseFindMany, completionFindFirst } = db()
    const result = await loadNationalPolicyQueues(prisma as never, ['a1'])
    expect(result).toMatchObject({ verified: true, counts: { ENTER_INFORCE: 1, WAITING_AGENT: 1, WAITING_CLIENT: 1 } })
    expect(completionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      gridKey: 'NEW_BUSINESS', truncated: false, run: { agentId: 'a1', deploymentScope: 'LOCAL_CONNECTOR' },
    } }))
    expect(caseFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      agentId: 'a1', deploymentScope: 'LOCAL_CONNECTOR', gridKey: 'NEW_BUSINESS', fetchedAt: { gte: observedAt },
    } }))
  })
  it('returns an unverified empty view instead of stale rows when no completed snapshot exists', async () => {
    const { prisma, completionFindFirst, caseFindMany } = db()
    completionFindFirst.mockResolvedValue(null)
    const result = await loadNationalPolicyQueues(prisma as never, ['a1'])
    expect(result.verified).toBe(false)
    expect(result.counts).toEqual({ ENTER_INFORCE: 0, WAITING_AGENT: 0, WAITING_CLIENT: 0 })
    expect(caseFindMany).not.toHaveBeenCalled()
  })
  it('fails closed when the page counts do not reconcile', async () => {
    const { prisma, completionFindFirst } = db()
    completionFindFirst.mockResolvedValue({ expectedRecordCount: 4, receivedRecordCount: 3,
      finalSequence: 0, truncated: false, run: { rawGridPages: [{ sequence: 0, recordCount: 3, observedAt }] } })
    await expect(loadNationalPolicyQueues(prisma as never, ['a1'])).rejects.toThrow('NATIONAL_NEW_BUSINESS_SNAPSHOT_INCOMPLETE')
  })
})
