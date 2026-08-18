import type { ChatwootClient } from './chatwoot-client'

export type ProvisionDeps = {
  findAccount: (
    agentId: string,
  ) => Promise<{ externalAccountId: string; externalUserId: string } | null>
  saveAccount: (row: {
    agentId: string
    externalAccountId: string
    externalUserId: string
  }) => Promise<void>
  chatwoot: ChatwootClient
  randomPassword: () => string
}

/// One account per agent, created on first connect and reused forever after.
///
/// The row is written only after the link succeeds. Persisting earlier would leave
/// an agent marked as provisioned while their user belongs to no account — and
/// every later connect would take the idempotent path and never repair it.
export async function provisionAgentInbox(
  deps: ProvisionDeps,
  input: { agentId: string; agentName: string; agentEmail: string },
): Promise<{ accountId: string; userId: string; created: boolean }> {
  const existing = await deps.findAccount(input.agentId)
  if (existing) {
    return {
      accountId: existing.externalAccountId,
      userId: existing.externalUserId,
      created: false,
    }
  }

  // The user first, deliberately. It is the call Chatwoot validates — a password
  // policy lives behind it — while creating an account almost never fails. Doing
  // it the other way round meant every refused user left an orphan account, and
  // nine accumulated in production from one afternoon of retries.
  const user = await deps.chatwoot.createUser({
    name: input.agentName,
    email: input.agentEmail,
    // The agent never types this. They reach the inbox by SSO, so the password
    // exists only because Chatwoot requires one.
    password: deps.randomPassword(),
  })
  const account = await deps.chatwoot.createAccount({ name: input.agentName })
  await deps.chatwoot.linkUserToAccount({ accountId: account.id, userId: user.id })

  await deps.saveAccount({
    agentId: input.agentId,
    externalAccountId: account.id,
    externalUserId: user.id,
  })

  return { accountId: account.id, userId: user.id, created: true }
}
