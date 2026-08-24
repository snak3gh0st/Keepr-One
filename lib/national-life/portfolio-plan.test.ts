import { describe, expect, it } from 'vitest'
import { planPortfolioIngest } from './portfolio-plan'
import type { InforceRow } from './portfolio-reconcile'

function row(overrides: Partial<InforceRow>): InforceRow {
  return {
    deploymentScope: 'LOCAL_CONNECTOR',
    policyNumber: 'LS1',
    policyStatus: 'Active',
    policyIssueDate: '06/02/2023',
    productName: 'Indexed Universal Life',
    insuredClientName: 'Enrico Abdalla',
    insuredDob: null,
    insuredEmail: null,
    insuredPhoneNumber: null,
    insuredZipcode: null,
    ownerClientName: 'Enrico Abdalla',
    anticipatedAnnualPremium: '1200.00',
    ...overrides,
  }
}

describe('planPortfolioIngest', () => {
  it('plans a new client and a policy keyed for upsert on the policy number', () => {
    const plan = planPortfolioIngest({ rows: [row({})], existingClients: [] })

    expect(plan.clientsToCreate).toHaveLength(1)
    expect(plan.policies[0]).toMatchObject({
      sourceProvider: 'NATIONAL_LIFE',
      sourceExternalId: 'LS1',
      carrier: 'National Life Group',
      status: 'INFORCE',
      sourceStatus: 'Active',
      premium: 1200,
    })
  })

  it('leaves face amount unknown rather than zero', () => {
    const plan = planPortfolioIngest({ rows: [row({})], existingClients: [] })

    expect(plan.policies[0]?.faceAmount).toBeNull()
    expect(plan.needsFaceAmount).toEqual(['LS1'])
  })

  it('attaches the policy to an existing client instead of duplicating them', () => {
    const plan = planPortfolioIngest({
      rows: [row({ insuredDob: '01/15/1980', deploymentScope: 'legacy' })],
      existingClients: [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: new Date(Date.UTC(1980, 0, 15)) }],
    })

    expect(plan.clientsToCreate).toEqual([])
    expect(plan.policies[0]?.clientRef).toEqual({ kind: 'EXISTING', clientId: 'c1' })
  })

  it('reports a low-confidence match instead of hiding it', () => {
    const plan = planPortfolioIngest({
      rows: [row({})],
      existingClients: [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: null }],
    })

    expect(plan.lowConfidence).toEqual([{ policyNumber: 'LS1', clientId: 'c1', name: 'Enrico Abdalla' }])
  })

  it('passes the discarded footer rows through to the report', () => {
    const plan = planPortfolioIngest({
      rows: [row({ policyNumber: '', policyStatus: 'Exported By: Novaes, Beatriz Moraes' })],
      existingClients: [],
    })

    expect(plan.policies).toEqual([])
    expect(plan.discarded).toHaveLength(1)
  })

  it('plans one client for two policies of the same person', () => {
    const plan = planPortfolioIngest({
      rows: [row({ policyNumber: 'LS1' }), row({ policyNumber: 'LS2' })],
      existingClients: [],
    })

    expect(plan.clientsToCreate).toHaveLength(1)
    expect(plan.policies).toHaveLength(2)
    expect(plan.policies[0]?.clientRef).toEqual(plan.policies[1]?.clientRef)
  })

  it('skips a policy whose insured has no name, because a client cannot be identified', () => {
    const plan = planPortfolioIngest({ rows: [row({ insuredClientName: null })], existingClients: [] })

    expect(plan.policies).toEqual([])
    expect(plan.discarded).toEqual([{ reason: 'MISSING_INSURED_NAME', policyStatus: 'Active' }])
  })
})
