import { describe, expect, it, vi } from 'vitest'
import {
  backfillClientContactFromServiceLog,
  backfillClientContactFromServiceLogSafely,
} from './client-contact-backfill-prisma'

type Where = Record<string, unknown>

function fakePrisma(input: {
  rows?: Array<{ id: string; raw: unknown }>
  policies?: Array<{ policyNumber: string; clientId: string }>
  clients?: Array<{ id: string; name: string; email: string | null; phone: string | null }>
  channels?: Array<{ normalizedPhoneE164: string | null }>
} = {}) {
  const calls: { where: Where; model: string }[] = []
  const clientUpdateMany = vi.fn(async (args: { where: Where; data: Where }) => {
    calls.push({ model: 'client.updateMany', where: args.where })
    return { count: 1 }
  })
  const find = (model: string, rows: unknown[]) => vi.fn(async (args: { where: Where }) => {
    calls.push({ model, where: args.where })
    return rows
  })

  const prisma = {
    nationalLifeReportRow: {
      findMany: find('reportRow', input.rows ?? [{
        id: 'row-1',
        raw: {
          // The grid hands the policy number back inside an anchor.
          PolicyNumber: '<a href="/policy/1">766815100</a>',
          CustomerName: 'ELIZA YAMANAKA',
          EmailAddress: 'eliza@example.com',
          PhoneNumber: '(305) 555-0142',
          CallReason: 'Client Birthday Coming up in next 7 days',
          CaseDate: '2026-08-01T00:00:00',
        },
      }]),
    },
    policy: { findMany: find('policy', input.policies ?? [{ policyNumber: '766815100', clientId: 'c1' }]) },
    client: {
      findMany: find('client', input.clients ?? [{ id: 'c1', name: 'Eliza Saeko Yamanaka', email: null, phone: null }]),
      updateMany: clientUpdateMany,
    },
    agentMessagingChannel: { findMany: find('channel', input.channels ?? []) },
  }

  return { prisma, calls, clientUpdateMany }
}

describe('backfillClientContactFromServiceLog', () => {
  it('fills the gap through the portfolio ingest writer, scoped to the agent', async () => {
    const { prisma, clientUpdateMany } = fakePrisma()

    const report = await backfillClientContactFromServiceLog(prisma as never, { agentId: 'a1' })

    expect(report).toEqual({
      planned: 1,
      clientsContactFilled: 1,
      skipped: { unmatchedPolicy: 0, nameMismatch: 0, agentOwnPhone: 0 },
    })
    expect(clientUpdateMany).toHaveBeenCalledTimes(2)
    for (const [args] of clientUpdateMany.mock.calls) {
      expect(args.where).toMatchObject({ id: 'c1', assignedAgentId: 'a1' })
    }
    expect(clientUpdateMany.mock.calls.map(([args]) => args.data)).toEqual([
      { email: 'eliza@example.com' },
      { phone: '(305) 555-0142' },
    ])
  })

  it('scopes every read to the agent', async () => {
    const { prisma, calls } = fakePrisma()

    await backfillClientContactFromServiceLog(prisma as never, { agentId: 'a1' })

    expect(calls.find((call) => call.model === 'reportRow')?.where)
      .toEqual({ agentId: 'a1', gridKey: 'CLIENT_INTELLIGENCE' })
    expect(calls.find((call) => call.model === 'policy')?.where)
      .toEqual({ agentId: 'a1', client: { assignedAgentId: 'a1' } })
    expect(calls.find((call) => call.model === 'client')?.where)
      .toEqual({ assignedAgentId: 'a1' })
    expect(calls.find((call) => call.model === 'channel')?.where).toEqual({ agentId: 'a1' })
  })

  it('never writes the agent own number as a client phone', async () => {
    const { prisma, clientUpdateMany } = fakePrisma({
      channels: [{ normalizedPhoneE164: '+13055550142' }],
    })

    const report = await backfillClientContactFromServiceLog(prisma as never, { agentId: 'a1' })

    expect(report.skipped.agentOwnPhone).toBe(1)
    expect(clientUpdateMany.mock.calls.map(([args]) => args.data)).toEqual([
      { email: 'eliza@example.com' },
    ])
  })

  it('reports nothing when the agent has no client intelligence rows', async () => {
    const { prisma, clientUpdateMany } = fakePrisma({ rows: [] })

    const report = await backfillClientContactFromServiceLog(prisma as never, { agentId: 'a1' })

    expect(report.planned).toBe(0)
    expect(clientUpdateMany).not.toHaveBeenCalled()
  })
})

describe('backfillClientContactFromServiceLogSafely', () => {
  it('turns a failed read into an empty report rather than a failed sync', async () => {
    const prisma = {
      nationalLifeReportRow: { findMany: vi.fn(async () => { throw new Error('down') }) },
      policy: { findMany: vi.fn(async () => []) },
      client: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
      agentMessagingChannel: { findMany: vi.fn(async () => []) },
    }

    await expect(backfillClientContactFromServiceLogSafely(prisma as never, { agentId: 'a1' }))
      .resolves.toEqual({
        planned: 0,
        clientsContactFilled: 0,
        skipped: { unmatchedPolicy: 0, nameMismatch: 0, agentOwnPhone: 0 },
      })
  })
})
