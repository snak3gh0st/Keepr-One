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

type ExistingClient = {
  id: string
  name: string
  dateOfBirth: Date | null
  email?: string | null
  phone?: string | null
}

function harness(rows: InforceRow[], existing: ExistingClient[] = [], contactWriteLands = true) {
  const createdClients: { name: string }[] = []
  const upserted: { sourceExternalId: string; faceAmount: unknown }[] = []
  const upsertedAgentIds: string[] = []
  const contactUpdates: { clientId: string; email: string | null; phone: string | null }[] = []
  const deps: IngestDeps = {
    loadInforceRows: async () => rows,
    loadClients: async () => existing.map((one) => ({
      ...one,
      email: one.email ?? null,
      phone: one.phone ?? null,
    })),
    createClient: async (input) => {
      createdClients.push({ name: input.name })
      return { id: `new-${createdClients.length}` }
    },
    updateClientContact: async ({ clientId, email, phone }) => {
      contactUpdates.push({ clientId, email, phone })
      return contactWriteLands
    },
    upsertPolicy: async (input) => {
      upserted.push({ sourceExternalId: input.sourceExternalId, faceAmount: input.faceAmount })
      upsertedAgentIds.push(input.agentId)
    },
  }
  return { deps, createdClients, upserted, upsertedAgentIds, contactUpdates }
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

  it('fills a known client\'s missing phone and email from the carrier row', async () => {
    const h = harness(
      [row({ insuredPhoneNumber: '561-726-0051', insuredEmail: 'enrico@example.com' })],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: null, phone: null }],
    )
    const report = await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.contactUpdates).toEqual([
      { clientId: 'client-1', email: 'enrico@example.com', phone: '561-726-0051' },
    ])
    expect(report).toMatchObject({ clientsCreated: 0, clientsContactFilled: 1 })
  })

  it('does not count a contact write the guarded update refused', async () => {
    // The plan is built from a snapshot read before the write, so the agent may
    // have filled the field in between and the update matches no row. Counting
    // the attempt would report contacts the book never gained.
    const h = harness(
      [row({ insuredPhoneNumber: '561-726-0051', insuredEmail: 'enrico@example.com' })],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: null, phone: null }],
      false,
    )
    const report = await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.contactUpdates).toHaveLength(1)
    expect(report).toMatchObject({ clientsContactFilled: 0 })
  })

  it('never overwrites contact details the agent already recorded', async () => {
    const h = harness(
      [row({ insuredPhoneNumber: '561-726-0051', insuredEmail: 'carrier@example.com' })],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: 'agent@example.com', phone: '555-0000' }],
    )
    await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.contactUpdates).toEqual([])
  })

  it('fills only the side the CRM is missing', async () => {
    const h = harness(
      [row({ insuredPhoneNumber: '561-726-0051', insuredEmail: 'carrier@example.com' })],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: 'agent@example.com', phone: null }],
    )
    await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.contactUpdates).toEqual([
      { clientId: 'client-1', email: null, phone: '561-726-0051' },
    ])
  })

  it('queues one write per client even when several policies carry the contact', async () => {
    const h = harness(
      [
        row({ policyNumber: 'LS1', insuredPhoneNumber: '561-726-0051' }),
        row({ policyNumber: 'LS2', insuredPhoneNumber: '561-726-0051' }),
      ],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: null, phone: null }],
    )
    await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.contactUpdates).toHaveLength(1)
  })

  it('treats a blank carrier value as no value', async () => {
    const h = harness(
      [row({ insuredPhoneNumber: '   ', insuredEmail: '' })],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: null, phone: null }],
    )
    await ingestNationalLifePortfolio(h.deps, runScope)

    expect(h.contactUpdates).toEqual([])
  })

  it('still upserts the portfolio when a contact write fails', async () => {
    const h = harness(
      [row({ insuredPhoneNumber: '561-726-0051' })],
      [{ id: 'client-1', name: 'Enrico Abdalla', dateOfBirth: null, email: null, phone: null }],
    )
    h.deps.updateClientContact = async () => { throw new Error('DB_DOWN') }

    const report = await ingestNationalLifePortfolio(h.deps, runScope)

    expect(report).toMatchObject({ policiesUpserted: 1, clientsContactFilled: 0 })
  })
})
