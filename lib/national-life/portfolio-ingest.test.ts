import { describe, expect, it } from 'vitest'
import {
  ingestNationalLifePortfolio,
  ingestPortfolioIfRunFinished,
  type IngestDeps,
} from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'

const row = (overrides: Partial<InforceRow>): InforceRow => ({
  deploymentScope: 'LOCAL_CONNECTOR',
  policyNumber: 'LS1',
  policyStatus: 'Active',
  policyIssueDate: '06/02/2023',
  productName: 'IUL',
  insuredClientName: 'Enrico Abdalla',
  insuredDob: null,
  insuredEmail: null,
  insuredPhoneNumber: null,
  insuredZipcode: null,
  ownerClientName: 'Enrico Abdalla',
  anticipatedAnnualPremium: '1200',
  ...overrides,
})

function harness(rows: InforceRow[], existing: { id: string; name: string; dateOfBirth: Date | null }[] = []) {
  const createdClients: { name: string }[] = []
  const upserted: { sourceExternalId: string; faceAmount: unknown }[] = []
  const deps: IngestDeps = {
    loadInforceRows: async () => rows,
    loadClients: async () => existing,
    createClient: async (input) => {
      createdClients.push({ name: input.name })
      return { id: `new-${createdClients.length}` }
    },
    upsertPolicy: async (input) => {
      upserted.push({ sourceExternalId: input.sourceExternalId, faceAmount: input.faceAmount })
    },
  }
  return { deps, createdClients, upserted }
}

describe('ingestNationalLifePortfolio', () => {
  it('creates the client, upserts the policy and reports the counts', async () => {
    const h = harness([row({})])
    const report = await ingestNationalLifePortfolio(h.deps, { agentId: 'a1' })

    expect(h.createdClients).toEqual([{ name: 'Enrico Abdalla' }])
    expect(h.upserted).toEqual([{ sourceExternalId: 'LS1', faceAmount: null }])
    expect(report).toMatchObject({ clientsCreated: 1, policiesUpserted: 1, needsFaceAmount: 1 })
  })

  it('is idempotent: a second run against the same data creates no new client', async () => {
    const second = harness([row({})], [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: null }])
    const report = await ingestNationalLifePortfolio(second.deps, { agentId: 'a1' })

    expect(second.createdClients).toEqual([])
    expect(report.clientsCreated).toBe(0)
    expect(report.policiesUpserted).toBe(1)
  })

  it('keeps going when one policy fails and reports which one', async () => {
    const h = harness([row({ policyNumber: 'LS1' }), row({ policyNumber: 'LS2' })])
    h.deps.upsertPolicy = async (input) => {
      if (input.sourceExternalId === 'LS1') throw new Error('boom')
    }

    const report = await ingestNationalLifePortfolio(h.deps, { agentId: 'a1' })

    expect(report.policiesUpserted).toBe(1)
    expect(report.failed).toEqual([{ policyNumber: 'LS1', reason: 'boom' }])
  })

  it('leaves a policy that vanished from the export untouched instead of removing it', async () => {
    // The carrier may have changed a filter. Absent from the export is not proof
    // the policy stopped existing: the run must simply not mention it.
    const h = harness([row({ policyNumber: 'LS1' })])
    const touched: string[] = []
    h.deps.upsertPolicy = async (input) => {
      touched.push(input.sourceExternalId)
    }

    const report = await ingestNationalLifePortfolio(h.deps, { agentId: 'a1' })

    expect(touched).toEqual(['LS1'])
    expect(report.policiesUpserted).toBe(1)
  })
})

describe('ingestPortfolioIfRunFinished', () => {
  it('does nothing while the run still has stages left', async () => {
    const h = harness([row({})])
    const report = await ingestPortfolioIfRunFinished(h.deps, { agentId: 'a1', terminal: false })

    expect(report).toBeNull()
    expect(h.upserted).toEqual([])
  })

  it('ingests once the last stage settles', async () => {
    const h = harness([row({})])
    const report = await ingestPortfolioIfRunFinished(h.deps, { agentId: 'a1', terminal: true })

    expect(report?.policiesUpserted).toBe(1)
  })

  it('never lets an ingestion failure fail the sync', async () => {
    // The device is waiting on this response to finish its run. A portfolio that
    // could not be written is a problem for the portfolio, not a reason to tell
    // the connector its sync failed.
    const h = harness([row({})])
    h.deps.loadInforceRows = async () => {
      throw new Error('database on fire')
    }

    await expect(
      ingestPortfolioIfRunFinished(h.deps, { agentId: 'a1', terminal: true }),
    ).resolves.toBeNull()
  })
})
