import { describe, expect, it, vi } from 'vitest'
import { prismaProvisionDeps } from './provision-prisma'

describe('Prisma messaging provision coordinator', () => {
  it('holds a transaction-scoped per-agent advisory lock around local lookup/save', async () => {
    const rootFind = vi.fn()
    const transactionFind = vi.fn().mockResolvedValue({
      externalAccountId: 'account-1',
      externalUserId: 'user-1',
    })
    const queryRaw = vi.fn().mockResolvedValue([])
    const transactionClient = {
      $queryRaw: queryRaw,
      agentMessagingAccount: {
        findUnique: transactionFind,
        create: vi.fn(),
      },
    }
    const transaction = vi.fn(async (
      operation: (client: typeof transactionClient) => unknown,
    ) => operation(transactionClient))
    const database = {
      agentMessagingAccount: {
        findUnique: rootFind,
        create: vi.fn(),
      },
      $transaction: transaction,
    }

    const deps = prismaProvisionDeps(database as never, {
      baseUrl: 'https://chat.example.com',
      platformToken: 'platform-secret',
    })
    const result = await deps.runExclusive?.('agent-1', (lockedDeps) =>
      lockedDeps.findAccount('agent-1'),
    )

    expect(result).toEqual({ externalAccountId: 'account-1', externalUserId: 'user-1' })
    expect(transactionFind).toHaveBeenCalledWith({
      where: { agentId: 'agent-1' },
      select: { externalAccountId: true, externalUserId: true },
    })
    expect(rootFind).not.toHaveBeenCalled()
    expect(transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 10_000, timeout: 60_000 },
    )

    const query = queryRaw.mock.calls[0]?.[0] as {
      strings: string[]
      values: unknown[]
    }
    expect(query.strings.join('?')).toContain(
      'SELECT 1 AS lock_acquired FROM pg_advisory_xact_lock(hashtextextended',
    )
    expect(query.values).toEqual(['keepr-agent-inbox:agent-1'])
  })
})
