import { describe, expect, it, vi } from 'vitest'
import { prismaIngestDeps } from './portfolio-ingest-prisma'
import type { PlannedPolicy } from './portfolio-plan'

type UpsertArgs = {
  where: { sourceProvider_sourceExternalId: { sourceProvider: string; sourceExternalId: string } }
  update: Record<string, unknown>
  create: Record<string, unknown>
}

/// Typed so the assertions below can read `mock.calls[0][0]`: an untyped
/// `vi.fn(async () => ({}))` declares no parameters, and its call tuple is empty.
const upsertMock = () => vi.fn(async (_args: UpsertArgs) => ({}))

const planned: PlannedPolicy & { agentId: string; clientId: string } = {
  agentId: 'a1',
  clientId: 'c1',
  sourceProvider: 'NATIONAL_LIFE',
  sourceExternalId: 'LS1',
  policyNumber: 'LS1',
  carrier: 'National Life Group',
  product: 'IUL',
  status: 'INFORCE',
  sourceStatus: 'Active',
  faceAmount: null,
  premium: 1200,
  effectiveDate: null,
  clientRef: { kind: 'EXISTING', clientId: 'c1' },
}

describe('prismaIngestDeps', () => {
  it('upserts on the provider and external id pair, so an existing row is corrected in place', async () => {
    const upsert = upsertMock()
    const deps = prismaIngestDeps({ policy: { upsert } } as never)

    await deps.upsertPolicy(planned)

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceProvider_sourceExternalId: { sourceProvider: 'NATIONAL_LIFE', sourceExternalId: 'LS1' },
        },
      }),
    )
  })

  it('does not overwrite a known face amount with null on a later sync', async () => {
    // Face amount arrives by backfill, after the row. A sync that runs in between
    // must not undo it.
    const upsert = upsertMock()
    const deps = prismaIngestDeps({ policy: { upsert } } as never)

    await deps.upsertPolicy(planned)

    expect(upsert.mock.calls[0]?.[0].update).not.toHaveProperty('faceAmount')
    expect(upsert.mock.calls[0]?.[0].create).toHaveProperty('faceAmount', null)
  })

  it('carries the carrier status string through to the row', async () => {
    const upsert = upsertMock()
    const deps = prismaIngestDeps({ policy: { upsert } } as never)

    await deps.upsertPolicy({ ...planned, sourceStatus: 'Pending Lapse' })

    expect(upsert.mock.calls[0]?.[0].update.sourceStatus).toBe('Pending Lapse')
  })
})
