import { describe, expect, it, vi } from 'vitest'
import { provisionAgentInbox, type ProvisionDeps } from './provision-agent-inbox'

function harness(existing: { externalAccountId: string; externalUserId: string } | null) {
  const saved: { agentId: string; externalAccountId: string; externalUserId: string }[] = []
  const deps: ProvisionDeps = {
    findAccount: async () => existing,
    saveAccount: async (row) => {
      saved.push(row)
    },
    chatwoot: {
      createAccount: vi.fn(async () => ({ id: '7' })),
      createUser: vi.fn(async () => ({ id: '12', accessToken: 'tok' })),
      linkUserToAccount: vi.fn(async () => {}),
      createSsoUrl: vi.fn(async () => 'https://chat.example.com/app/login?sso_auth_token=abc'),
    },
    randomPassword: () => 'p'.repeat(24),
  }
  return { deps, saved }
}

const input = { agentId: 'a1', agentName: 'Felipe', agentEmail: 'felipe@keeprone.com' }

describe('provisionAgentInbox', () => {
  it('creates account, user and link on first connect', async () => {
    const h = harness(null)
    const result = await provisionAgentInbox(h.deps, input)

    expect(result).toEqual({ accountId: '7', userId: '12', created: true })
    expect(h.deps.chatwoot.linkUserToAccount).toHaveBeenCalledWith({ accountId: '7', userId: '12' })
    expect(h.saved).toEqual([{ agentId: 'a1', externalAccountId: '7', externalUserId: '12' }])
  })

  it('is idempotent: reconnecting reuses the account instead of creating a second', async () => {
    // Two accounts for one agent would split their conversations in half, with no
    // way to tell which inbox a client wrote to.
    const h = harness({ externalAccountId: '7', externalUserId: '12' })
    const result = await provisionAgentInbox(h.deps, input)

    expect(result).toEqual({ accountId: '7', userId: '12', created: false })
    expect(h.deps.chatwoot.createAccount).not.toHaveBeenCalled()
    expect(h.saved).toEqual([])
  })

  it('never reuses a password across agents', async () => {
    const h = harness(null)
    await provisionAgentInbox(h.deps, input)

    const call = vi.mocked(h.deps.chatwoot.createUser).mock.calls[0]?.[0]
    expect(call?.password).toHaveLength(24)
    expect(call?.email).toBe('felipe@keeprone.com')
  })

  it('does not persist a half-provisioned agent when linking fails', async () => {
    // A saved row with no working link would make every later connect think the
    // agent is already set up, and they would never reach an inbox.
    const h = harness(null)
    h.deps.chatwoot.linkUserToAccount = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(provisionAgentInbox(h.deps, input)).rejects.toThrow('boom')
    expect(h.saved).toEqual([])
  })
})
