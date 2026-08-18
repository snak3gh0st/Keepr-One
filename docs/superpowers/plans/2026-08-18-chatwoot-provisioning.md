# Chatwoot Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent clicks "Conectar meu WhatsApp" in Keepr One and lands in their own isolated Chatwoot inbox, without a second login and without seeing anything technical.

**Architecture:** Keepr One drives Chatwoot's Platform API to create one account and one user per agent, stores the link, and mints an SSO URL on demand. The HTTP client is injected, so every step is unit-testable without Chatwoot running — the same pattern `portfolio-ingest.ts` uses for Prisma.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Vitest, Chatwoot Platform API.

**Spec:** `docs/superpowers/specs/2026-08-18-chatwoot-agent-client-messaging-design.md`

## Global Constraints

- One Chatwoot **account** per agent, never one shared account with per-inbox rules. Isolation must be structural, not configured. (Spec D3)
- Provisioning is idempotent: reconnecting never creates a second account. (Spec §7)
- No Chatwoot, Meta, API or instance vocabulary reaches the agent's screen. (Spec D4)
- The Chatwoot platform token is a server-only secret and must never reach the browser.
- Never modify Chatwoot itself — it is AGPL and running it unmodified alongside the product is what keeps the obligation off. (Spec §5.4)

## Phase 0 — blocked on the account owner, not on code

These are not implementation tasks; they gate Phase 2 only. Phase 1 below runs
without them.

- A DNS record for the Chatwoot host (e.g. `chat.keeprone.com`) pointing at the
  server. No DNS access from here.
- A decision on where Chatwoot runs. The production box has **5 GB RAM free** and
  already serves the app, Postgres, Steel and the National Life runtime. Chatwoot
  is Rails + Sidekiq with its own Postgres and Redis; the QR provider holds one
  live WhatsApp session per agent. If it shares the box it **must** run under
  memory limits, or an OOM there takes the product down with it.

---

### Task 1: Store the link between an agent and their Chatwoot account

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260818120000_agent_messaging_account/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: model `AgentMessagingAccount`, used by Tasks 3 and 4.

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, after model `AgentIntegrationCredential`:

```prisma
/// One Chatwoot account per agent, never a shared account with per-inbox rules:
/// agents are independent and a configuration slip would show one agent's book to
/// a competitor. Isolation is structural here, not procedural.
model AgentMessagingAccount {
  id                String   @id @default(cuid())
  agentId           String   @unique
  agent             Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  provider          String   @default("CHATWOOT")
  externalAccountId String
  externalUserId    String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([provider, externalAccountId])
}
```

And add to model `Agent`, beside the other relations:

```prisma
  messagingAccount                      AgentMessagingAccount?
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260818120000_agent_messaging_account/migration.sql`:

```sql
CREATE TABLE "AgentMessagingAccount" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'CHATWOOT',
  "externalAccountId" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentMessagingAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentMessagingAccount_agentId_key" ON "AgentMessagingAccount"("agentId");
CREATE UNIQUE INDEX "AgentMessagingAccount_provider_externalAccountId_key"
  ON "AgentMessagingAccount"("provider", "externalAccountId");

ALTER TABLE "AgentMessagingAccount" ADD CONSTRAINT "AgentMessagingAccount_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Verify**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Store one Chatwoot account per agent"
```

---

### Task 2: A typed client for the Chatwoot Platform API

**Files:**
- Create: `lib/messaging/chatwoot-client.ts`
- Test: `lib/messaging/chatwoot-client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ChatwootHttp`, `type ChatwootClient`, `function createChatwootClient(config: { baseUrl: string; platformToken: string; http: ChatwootHttp }): ChatwootClient` with methods `createAccount`, `createUser`, `linkUserToAccount`, `createSsoUrl`. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Create `lib/messaging/chatwoot-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createChatwootClient, type ChatwootHttp } from './chatwoot-client'

function recorder(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  let index = 0
  const http: ChatwootHttp = async (url, init) => {
    calls.push({ url, init })
    const body = responses[index] ?? {}
    index += 1
    return { ok: true, status: 200, json: async () => body }
  }
  return { http, calls }
}

const config = (http: ChatwootHttp) => ({
  baseUrl: 'https://chat.example.com',
  platformToken: 'secret-token',
  http,
})

describe('createChatwootClient', () => {
  it('creates an account and returns its id', async () => {
    const { http, calls } = recorder([{ id: 7, name: 'Felipe' }])
    const client = createChatwootClient(config(http))

    const account = await client.createAccount({ name: 'Felipe' })

    expect(account).toEqual({ id: '7' })
    expect(calls[0]?.url).toBe('https://chat.example.com/platform/api/v1/accounts')
    expect(calls[0]?.init.method).toBe('POST')
  })

  it('authenticates with the platform token header on every call', async () => {
    const { http, calls } = recorder([{ id: 7 }])
    const client = createChatwootClient(config(http))

    await client.createAccount({ name: 'Felipe' })

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.api_access_token).toBe('secret-token')
  })

  it('creates a user and returns id and access token', async () => {
    const { http } = recorder([{ id: 12, access_token: 'user-token' }])
    const client = createChatwootClient(config(http))

    const user = await client.createUser({ name: 'Felipe', email: 'f@example.com', password: 'x'.repeat(20) })

    expect(user).toEqual({ id: '12', accessToken: 'user-token' })
  })

  it('links a user to an account as administrator', async () => {
    const { http, calls } = recorder([{}])
    const client = createChatwootClient(config(http))

    await client.linkUserToAccount({ accountId: '7', userId: '12' })

    expect(calls[0]?.url).toBe('https://chat.example.com/platform/api/v1/accounts/7/account_users')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ user_id: '12', role: 'administrator' })
  })

  it('mints an SSO url so the agent never sees a second login', async () => {
    const { http, calls } = recorder([{ url: 'https://chat.example.com/app/login?sso_auth_token=abc' }])
    const client = createChatwootClient(config(http))

    const url = await client.createSsoUrl({ userId: '12' })

    expect(url).toBe('https://chat.example.com/app/login?sso_auth_token=abc')
    expect(calls[0]?.url).toBe('https://chat.example.com/platform/api/v1/users/12/login')
  })

  it('raises a typed error when Chatwoot refuses, instead of returning junk', async () => {
    const http: ChatwootHttp = async () => ({ ok: false, status: 422, json: async () => ({ message: 'taken' }) })
    const client = createChatwootClient(config(http))

    await expect(client.createAccount({ name: 'Felipe' })).rejects.toThrow('CHATWOOT_REQUEST_FAILED')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/messaging/chatwoot-client.test.ts`
Expected: FAIL — `Failed to resolve import "./chatwoot-client"`.

- [ ] **Step 3: Implement the client**

Create `lib/messaging/chatwoot-client.ts`:

```ts
/// The Platform API is the administrative surface: it creates accounts and users
/// and mints login links. Its token is server-only — it can act on every account
/// in the instance, so it must never reach a browser.
///
/// `http` is injected rather than calling `fetch` directly so provisioning is
/// testable without a Chatwoot to talk to, the same reason `portfolio-ingest.ts`
/// injects its writes.

export type ChatwootResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type ChatwootHttp = (url: string, init: RequestInit) => Promise<ChatwootResponse>

export type ChatwootClient = {
  createAccount: (input: { name: string }) => Promise<{ id: string }>
  createUser: (input: { name: string; email: string; password: string }) => Promise<{ id: string; accessToken: string }>
  linkUserToAccount: (input: { accountId: string; userId: string }) => Promise<void>
  createSsoUrl: (input: { userId: string }) => Promise<string>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function createChatwootClient(config: {
  baseUrl: string
  platformToken: string
  http: ChatwootHttp
}): ChatwootClient {
  const call = async (path: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const response = await config.http(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        api_access_token: config.platformToken,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error('CHATWOOT_REQUEST_FAILED')
    return asRecord(await response.json())
  }

  return {
    createAccount: async ({ name }) => {
      const body = await call('/platform/api/v1/accounts', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      return { id: String(body.id) }
    },

    createUser: async ({ name, email, password }) => {
      const body = await call('/platform/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      })
      return { id: String(body.id), accessToken: String(body.access_token) }
    },

    linkUserToAccount: async ({ accountId, userId }) => {
      await call(`/platform/api/v1/accounts/${accountId}/account_users`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, role: 'administrator' }),
      })
    },

    createSsoUrl: async ({ userId }) => {
      const body = await call(`/platform/api/v1/users/${userId}/login`, { method: 'GET' })
      return String(body.url)
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/messaging/chatwoot-client.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/messaging/chatwoot-client.ts lib/messaging/chatwoot-client.test.ts
git commit -m "Add a typed client for the Chatwoot Platform API"
```

---

### Task 3: Provision an agent's inbox, once and only once

**Files:**
- Create: `lib/messaging/provision-agent-inbox.ts`
- Test: `lib/messaging/provision-agent-inbox.test.ts`

**Interfaces:**
- Consumes: `ChatwootClient` (Task 2); model `AgentMessagingAccount` (Task 1).
- Produces: `type ProvisionDeps`, `function provisionAgentInbox(deps: ProvisionDeps, input: { agentId: string; agentName: string; agentEmail: string }): Promise<{ accountId: string; userId: string; created: boolean }>`, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `lib/messaging/provision-agent-inbox.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/messaging/provision-agent-inbox.test.ts`
Expected: FAIL — `Failed to resolve import "./provision-agent-inbox"`.

- [ ] **Step 3: Implement provisioning**

Create `lib/messaging/provision-agent-inbox.ts`:

```ts
import type { ChatwootClient } from './chatwoot-client'

export type ProvisionDeps = {
  findAccount: (agentId: string) => Promise<{ externalAccountId: string; externalUserId: string } | null>
  saveAccount: (row: { agentId: string; externalAccountId: string; externalUserId: string }) => Promise<void>
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

  const account = await deps.chatwoot.createAccount({ name: input.agentName })
  const user = await deps.chatwoot.createUser({
    name: input.agentName,
    email: input.agentEmail,
    // The agent never types this. They reach the inbox by SSO, so the password
    // exists only because Chatwoot requires one.
    password: deps.randomPassword(),
  })
  await deps.chatwoot.linkUserToAccount({ accountId: account.id, userId: user.id })

  await deps.saveAccount({
    agentId: input.agentId,
    externalAccountId: account.id,
    externalUserId: user.id,
  })

  return { accountId: account.id, userId: user.id, created: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/messaging/provision-agent-inbox.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/messaging/provision-agent-inbox.ts lib/messaging/provision-agent-inbox.test.ts
git commit -m "Provision one Chatwoot account per agent, idempotently"
```

---

### Task 4: Bind provisioning to Prisma and configuration

**Files:**
- Create: `lib/messaging/chatwoot-config.ts`
- Create: `lib/messaging/provision-prisma.ts`
- Test: `lib/messaging/chatwoot-config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ProvisionDeps` (Task 3), `createChatwootClient` (Task 2).
- Produces: `function chatwootConfigFromEnv(env: NodeJS.ProcessEnv): { baseUrl: string; platformToken: string } | null`, `function prismaProvisionDeps(prisma: PrismaClient): ProvisionDeps`.

- [ ] **Step 1: Write the failing test**

Create `lib/messaging/chatwoot-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { chatwootConfigFromEnv } from './chatwoot-config'

describe('chatwootConfigFromEnv', () => {
  it('reads the base url and platform token', () => {
    expect(
      chatwootConfigFromEnv({
        CHATWOOT_BASE_URL: 'https://chat.keeprone.com',
        CHATWOOT_PLATFORM_TOKEN: 'tok',
      } as NodeJS.ProcessEnv),
    ).toEqual({ baseUrl: 'https://chat.keeprone.com', platformToken: 'tok' })
  })

  it('returns null when unconfigured, so the feature is simply absent', () => {
    // Absent configuration must read as "messaging is off", never as a crash on a
    // deployment that has not adopted it yet.
    expect(chatwootConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('refuses a base url that is not https, because the platform token rides on it', () => {
    expect(
      chatwootConfigFromEnv({
        CHATWOOT_BASE_URL: 'http://chat.keeprone.com',
        CHATWOOT_PLATFORM_TOKEN: 'tok',
      } as NodeJS.ProcessEnv),
    ).toBeNull()
  })

  it('drops a trailing slash so paths do not double up', () => {
    const config = chatwootConfigFromEnv({
      CHATWOOT_BASE_URL: 'https://chat.keeprone.com/',
      CHATWOOT_PLATFORM_TOKEN: 'tok',
    } as NodeJS.ProcessEnv)

    expect(config?.baseUrl).toBe('https://chat.keeprone.com')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/messaging/chatwoot-config.test.ts`
Expected: FAIL — `Failed to resolve import "./chatwoot-config"`.

- [ ] **Step 3: Implement config and the Prisma binding**

Create `lib/messaging/chatwoot-config.ts`:

```ts
/// Absent configuration means the feature is off, not broken: deployments that have
/// not adopted messaging must keep working untouched.
export function chatwootConfigFromEnv(
  env: NodeJS.ProcessEnv,
): { baseUrl: string; platformToken: string } | null {
  const rawUrl = (env.CHATWOOT_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const platformToken = (env.CHATWOOT_PLATFORM_TOKEN ?? '').trim()
  if (!rawUrl || !platformToken) return null
  // The platform token can act on every account in the instance. It does not
  // travel over plaintext.
  if (!rawUrl.startsWith('https://')) return null
  return { baseUrl: rawUrl, platformToken }
}
```

Create `lib/messaging/provision-prisma.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import { createChatwootClient } from './chatwoot-client'
import type { ProvisionDeps } from './provision-agent-inbox'

export function prismaProvisionDeps(
  prisma: PrismaClient,
  config: { baseUrl: string; platformToken: string },
): ProvisionDeps {
  return {
    findAccount: async (agentId) =>
      prisma.agentMessagingAccount.findUnique({
        where: { agentId },
        select: { externalAccountId: true, externalUserId: true },
      }),

    saveAccount: async ({ agentId, externalAccountId, externalUserId }) => {
      await prisma.agentMessagingAccount.create({
        data: { agentId, externalAccountId, externalUserId },
      })
    },

    chatwoot: createChatwootClient({
      baseUrl: config.baseUrl,
      platformToken: config.platformToken,
      http: (url, init) => fetch(url, init),
    }),

    // Long and random because nobody types it: the agent reaches the inbox by SSO.
    randomPassword: () =>
      [...crypto.getRandomValues(new Uint8Array(18))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
  }
}
```

Append to `.env.example`:

```
# Chatwoot — messaging between the agent and their own clients. Absent means the
# feature is off. The platform token can act on every account in the instance:
# server-only, never exposed to the browser.
CHATWOOT_BASE_URL=""
CHATWOOT_PLATFORM_TOKEN=""
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run lib/messaging && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/messaging .env.example
git commit -m "Bind Chatwoot provisioning to Prisma and environment"
```

---

## Not in this plan

- Deploying Chatwoot and the QR provider (Phase 0 above): needs DNS and a decision
  on where it runs.
- The QR connect flow and its ban-risk warning screen: it needs a running provider
  to be worth writing, and the warning copy is a product decision, not a
  mechanical one.
- The Dashboard App context panel: separate plan, and it needs a live conversation
  to develop against.
- Contact sync between `Client` and Chatwoot contacts: the QR channel brings the
  agent's own contacts, so this earns its place only if measurement shows a gap.
