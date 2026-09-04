import { describe, expect, it } from 'vitest'
import {
  ingestNationalLifePortfolio,
  ingestPortfolioIfRunFinished,
  type IngestDeps,
} from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'

const runScope = { agentId: 'a1', deviceId: 'device-a', runId: 'run-a' }

const row = (overrides: Partial<InforceRow>): InforceRow => ({
  deploymentScope: 'LOCAL_CONNECTOR',
  agentNumber: '10001',
  policyNumber: 'LS1',
  policyStatus: 'Active',
  lastStatusChangeDate: null,
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
  const upsertedAgentIds: string[] = []
  const deps: IngestDeps = {
    loadInforceRows: async () => rows,
    loadClients: async () => existing,
    createClient: async (input) => {
      createdClients.push({ name: input.name })
      return { id: `new-${createdClients.length}` }
    },
    upsertPolicy: async (input) => {
      upserted.push({ sourceExternalId: input.sourceExternalId, faceAmount: input.faceAmount })
      upsertedAgentIds.push(input.agentId)
    },
  }
  return { deps, createdClients, upserted, upsertedAgentIds }
}

describe('ingestNationalLifePortfolio', () => {
  it('creates the client, upserts the policy and reports the counts', async () => {
    const h = harness([row({})])
    const report = await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.createdClients).toEqual([{ name: 'Enrico Abdalla' }])
    expect(h.upserted).toEqual([{ sourceExternalId: 'LS1', faceAmount: null }])
    expect(report).toMatchObject({ clientsCreated: 1, policiesUpserted: 1, needsFaceAmount: 1 })
  })

  it('promotes paired-account rows to the agent despite missing or different carrier numbers', async () => {
    const h = harness([
      row({ policyNumber: 'DIFFERENT-CARRIER-NUMBER', agentNumber: 'another-producer' }),
      row({ policyNumber: 'MISSING-CARRIER-NUMBER', agentNumber: null }),
    ])

    const report = await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.upserted.map(({ sourceExternalId }) => sourceExternalId)).toEqual([
      'DIFFERENT-CARRIER-NUMBER',
      'MISSING-CARRIER-NUMBER',
    ])
    expect(h.upsertedAgentIds).toEqual(['a1', 'a1'])
    expect(report.policiesUpserted).toBe(2)
  })

  it('is idempotent: a second run against the same data creates no new client', async () => {
    const second = harness([row({})], [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: null }])
    const report = await ingestNationalLifePortfolio(second.deps, runScope)

    expect(second.createdClients).toEqual([])
    expect(report.clientsCreated).toBe(0)
    expect(report.policiesUpserted).toBe(1)
  })

  it('keeps going when one policy fails and reports which one', async () => {
    const h = harness([row({ policyNumber: 'LS1' }), row({ policyNumber: 'LS2' })])
    h.deps.upsertPolicy = async (input) => {
      if (input.sourceExternalId === 'LS1') throw new Error('boom')
    }

    const report = await ingestNationalLifePortfolio(h.deps, runScope)

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

    const report = await ingestNationalLifePortfolio(h.deps, runScope)

    expect(touched).toEqual(['LS1'])
    expect(report.policiesUpserted).toBe(1)
  })
})

describe('ingestPortfolioIfRunFinished', () => {
  it('does nothing while the run still has stages left', async () => {
    const h = harness([row({})])
    const report = await ingestPortfolioIfRunFinished(h.deps, { ...runScope, terminal: false })

    expect(report).toBeNull()
    expect(h.upserted).toEqual([])
  })

  it('ingests once the last stage settles', async () => {
    const h = harness([row({})])
    const report = await ingestPortfolioIfRunFinished(h.deps, { ...runScope, terminal: true })

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
      ingestPortfolioIfRunFinished(h.deps, { ...runScope, terminal: true }),
    ).resolves.toBeNull()
  })

  it('never promotes a second device run when its verified source is unavailable', async () => {
    const h = harness([row({ policyNumber: 'RUN-A' })])
    const requested: typeof runScope[] = []
    h.deps.loadInforceRows = async (input) => {
      requested.push(input)
      if (input.deviceId === 'device-a' && input.runId === 'run-a') return [row({ policyNumber: 'RUN-A' })]
      // Device B has only uploaded a partial page; it must never inherit A's
      // normalized agent-wide rows as a fallback.
      return null
    }

    await expect(ingestPortfolioIfRunFinished(h.deps, {
      agentId: 'a1', deviceId: 'device-b', runId: 'run-b', terminal: true,
    })).resolves.toBeNull()

    expect(requested).toEqual([{ agentId: 'a1', deviceId: 'device-b', runId: 'run-b' }])
    expect(h.upserted).toEqual([])
  })
})
