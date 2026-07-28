# Keepr One National Life Interactive Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stored National Life passwords with an agent-controlled login in the real National Life portal, then reuse only encrypted authenticated browser context for Keepr One synchronization jobs.

**Architecture:** Keepr One creates a short-lived connection attempt that a dedicated National Life runtime opens in an isolated, interactive self-hosted Steel session. A signed, one-time viewer bootstrap and broker expose the Steel debug viewer without exposing Steel credentials or arbitrary navigation; after deterministic authentication proof, the runtime encrypts Steel `sessionContext`, releases the interactive session, and restores that context for later read-only adapter jobs.

**Tech Stack:** Next.js 16 App Router and Server Actions, React 19, TypeScript, Prisma/PostgreSQL, Better Auth, Steel SDK 0.18, Playwright Core, Node HTTP/WebSocket reverse proxy, Vitest, AES-256-GCM, HMAC-SHA-256.

## Global Constraints

- Product-facing copy for this feature must say **Keepr One**, never Fyntra.
- The displayed page is the real National Life/Auth0 page in Steel's interactive viewer; do not recreate or restyle the carrier login form.
- The centered browser modal is limited to login, MFA, and reconnection; it is not a general-purpose portal browser.
- Keepr One must never store, model, autofill, log, screenshot, replay, or place the National Life password or MFA value in a business API payload.
- Live-view keyboard and pointer frames are opaque encrypted transport; application code must not inspect or persist their content.
- Persist only encrypted Steel `sessionContext` (cookies, local storage, session storage, and IndexedDB supported by Steel), bound by AES-256-GCM associated data to agent, deployment scope, provider, purpose, and format version.
- Each agent has at most one active connection attempt and one reusable National Life session.
- Raw Steel API keys, websocket endpoints, `debugUrl`, and `sessionViewerUrl` stay server-side.
- Browser navigation remains restricted to the configured exact National Life/Auth0 origins. `solveCaptcha` stays `false`.
- Interactive login must use a pinned self-hosted Steel build with `headless: false`; production enablement is blocked until runtime proof confirms that the selected build creates no replay events, HLS/MP4 recording, screenshots, or retained viewer artifact for the login session. Steel Cloud is not allowed for credential entry unless Steel provides and Keepr One verifies an enforceable no-recording contract.
- Existing National Life password ciphertext remains only during the rollback window and is never converted into session context.
- Legacy password ciphertext may be purged only after the authorized real-portal gate passes and the user approves the destructive production migration.
- Production enablement requires confirmation that the organization's National Life agreement and portal terms authorize the browser access and intended data handling.
- Preserve unrelated local changes in `components/PublicLanding.tsx`, `Jenkinsfile`, and `.superpowers/`.

## Technical References

- Steel human-in-the-loop viewer: `https://docs.steel.dev/overview/sessions-api/human-in-the-loop`
- Steel session lifecycle and timeouts: `https://docs.steel.dev/overview/sessions-api/session-lifecycle`
- Steel context/profile persistence: `https://docs.steel.dev/overview/profiles-api/overview`
- Installed SDK contracts: `node_modules/steel-sdk/src/resources/sessions/sessions.ts` (`debugConfig`, `sessions.context`, and `sessionContext`)
- Steel recording warning: `https://docs.steel.dev/overview/sessions-api/embed-sessions/past-sessions` states that sessions are recorded by default; therefore the no-recording self-hosted proof is a hard gate, not an assumption.

## File Structure

### Domain and persistence

- `prisma/schema.prisma` — additive session and connection-attempt models plus `ACTION_REQUIRED`.
- `prisma/migrations/20260728_add_national_life_interactive_session/migration.sql` — additive schema only; does not delete legacy credentials.
- `lib/national-life/connection-attempt-state.ts` — legal attempt transitions.
- `lib/national-life/browser-context-crypto.ts` — encrypt/decrypt authenticated Steel context and live-attempt runtime.
- `lib/national-life/viewer-token.ts` — one-time bootstrap and short-lived broker-session tokens.
- `lib/national-life/interactive-connection-service.ts` — ownership, rate limit, attempt lifecycle, session summary, disconnect, and audit boundary.

### Browser and runtime

- `workers/national-life/steel-session.ts` — interactive session creation, context capture, and context restore.
- `workers/national-life/adapter.ts` — deterministic login/MFA/authenticated classification without credential filling.
- `workers/national-life/run-connection-attempt.ts` — open, monitor, complete, cancel, expire, and clean up attempts.
- `workers/national-life/viewer-broker.ts` — authenticated HTTP/WebSocket proxy for the Steel viewer.
- `workers/national-life/runtime.ts` — dependency wiring and bounded polling loops.
- `scripts/national-life-runtime.ts` — executable entrypoint for the dedicated Coolify service.

### Web application

- `app/agent/integrations/national-life/actions.ts` — start, mint viewer bootstrap, cancel, and disconnect actions.
- `app/api/agent/integrations/national-life/attempt/[attemptId]/route.ts` — read-only owned attempt status.
- `app/api/agent/integrations/national-life/attempt/[attemptId]/cancel/route.ts` — same-origin keepalive cancellation for navigation/logout cleanup.
- `app/agent/integrations/national-life/NationalLifeConnectionCard.tsx` — status and primary actions.
- `app/agent/integrations/national-life/NationalLifeBrowserModal.tsx` — approved centered interactive viewer.
- `app/agent/integrations/national-life/useNationalLifeConnectionAttempt.ts` — polling and modal lifecycle.
- `app/agent/integrations/national-life/page.tsx` — server summary and Keepr One security copy.
- `app/admin/integrations/national-life/page.tsx` — administrator-only connection health list without viewer/session access.
- `components/Shell.tsx` — emit a pre-sign-out cleanup event before Better Auth logout.

### Cutover and operations

- `workers/national-life/run-job.ts` — restore encrypted context instead of decrypting credentials.
- `workers/national-life/types.ts` — remove password-bearing types.
- `lib/national-life/env.ts` and `.env.example` — session, viewer, and runtime configuration.
- `Dockerfile.national-life-runtime` — dedicated worker/broker image.
- `package.json` and `pnpm-lock.yaml` — runtime scripts and proxy dependency.
- `docs/operations/national-life-interactive-login-rollout.md` — deploy, proof, rollback, and purge runbook.
- `prisma/migrations/20260728_purge_national_life_password_credentials/migration.sql` — destructive phase-two migration created only after the explicit gate.

---

### Task 1: Add the connection state machine and additive database schema

**Files:**
- Create: `lib/national-life/connection-attempt-state.ts`
- Create: `lib/national-life/connection-attempt-state.test.ts`
- Modify: `prisma/schema.prisma:116-132`
- Modify: `prisma/schema.prisma:155-177`
- Replace after generating: `prisma/migrations/20260728_add_national_life_interactive_session/migration.sql`

**Interfaces:**
- Produces: `NationalLifeConnectionAttemptState`, `assertConnectionAttemptTransition(from, to)`, Prisma models `AgentIntegrationSession` and `NationalLifeConnectionAttempt`.
- Consumes: existing `Agent`, `BrowserJobState`, and provider string `NATIONAL_LIFE`.

- [ ] **Step 1: Write the failing transition tests**

```ts
import { describe, expect, it } from 'vitest'
import { assertConnectionAttemptTransition } from './connection-attempt-state'

describe('National Life interactive connection state', () => {
  it.each([
    ['OPENING_PORTAL', 'AWAITING_LOGIN'],
    ['AWAITING_LOGIN', 'AWAITING_MFA'],
    ['AWAITING_LOGIN', 'AUTHENTICATED'],
    ['AWAITING_MFA', 'AUTHENTICATED'],
    ['OPENING_PORTAL', 'CANCELLED'],
    ['AWAITING_LOGIN', 'EXPIRED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertConnectionAttemptTransition(from, to)).not.toThrow()
  })

  it.each([
    ['AUTHENTICATED', 'AWAITING_LOGIN'],
    ['CANCELLED', 'AUTHENTICATED'],
    ['FAILED', 'AWAITING_MFA'],
    ['EXPIRED', 'OPENING_PORTAL'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertConnectionAttemptTransition(from, to)).toThrow('Invalid National Life connection transition')
  })
})
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `pnpm exec vitest run lib/national-life/connection-attempt-state.test.ts`

Expected: FAIL because `connection-attempt-state.ts` does not exist.

- [ ] **Step 3: Implement the state contract**

```ts
export type NationalLifeConnectionAttemptState =
  | 'OPENING_PORTAL'
  | 'AWAITING_LOGIN'
  | 'AWAITING_MFA'
  | 'AUTHENTICATED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'

const transitions: Record<NationalLifeConnectionAttemptState, readonly NationalLifeConnectionAttemptState[]> = {
  OPENING_PORTAL: ['AWAITING_LOGIN', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AWAITING_LOGIN: ['AWAITING_MFA', 'AUTHENTICATED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AWAITING_MFA: ['AWAITING_LOGIN', 'AUTHENTICATED', 'FAILED', 'CANCELLED', 'EXPIRED'],
  AUTHENTICATED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
}

export function assertConnectionAttemptTransition(
  from: NationalLifeConnectionAttemptState,
  to: NationalLifeConnectionAttemptState,
) {
  if (!transitions[from].includes(to)) {
    throw new Error(`Invalid National Life connection transition: ${from} -> ${to}`)
  }
}
```

- [ ] **Step 4: Add the Prisma models and additive migration**

Add `ACTION_REQUIRED` to `BrowserJobState`, add both relations to `Agent`, and add:

```prisma
model AgentIntegrationSession {
  id                 String   @id @default(cuid())
  agentId            String
  agent              Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  provider           String
  status             String   @default("CONNECTED")
  formatVersion      Int      @default(1)
  keyVersion         String?
  algorithm          String?
  iv                 String?
  ciphertext         String?
  authTag            String?
  carrierExpiresAt   DateTime?
  lastConnectedAt    DateTime
  lastUsedAt         DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([agentId, provider])
  @@index([provider, status])
}

model NationalLifeConnectionAttempt {
  id                String   @id @default(cuid())
  agentId           String
  agent             Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  provider          String
  state             String
  runtimeKeyVersion String?
  runtimeAlgorithm  String?
  runtimeIv         String?
  runtimeCiphertext String?
  runtimeAuthTag    String?
  viewerNonceHash   String?
  currentOrigin     String?
  safeErrorCode     String?
  leaseOwner        String?
  leaseExpiresAt    DateTime?
  expiresAt         DateTime
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([agentId, provider])
  @@index([state, expiresAt])
  @@index([leaseExpiresAt])
}
```

Generate the additive SQL with:

```bash
mkdir -p prisma/migrations/20260728_add_national_life_interactive_session
pnpm exec prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma \
  --script \
  --output /tmp/keepr-one-national-life-additive.sql
```

Copy the reviewed SQL into the migration with `apply_patch`. Verify that it only adds the enum value, tables, indexes, and foreign keys; it must not alter or drop `AgentIntegrationCredential`.

- [ ] **Step 5: Validate schema and state tests**

Run:

```bash
pnpm exec prisma validate
pnpm exec prisma generate
pnpm exec vitest run lib/national-life/connection-attempt-state.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the additive domain boundary**

```bash
git add prisma/schema.prisma prisma/migrations/20260728_add_national_life_interactive_session lib/national-life/connection-attempt-state.ts lib/national-life/connection-attempt-state.test.ts
git commit -m "feat: add National Life interactive session state"
```

### Task 2: Encrypt Steel context and sign viewer tokens

**Files:**
- Create: `lib/national-life/browser-context-crypto.ts`
- Create: `lib/national-life/browser-context-crypto.test.ts`
- Create: `lib/national-life/viewer-token.ts`
- Create: `lib/national-life/viewer-token.test.ts`

**Interfaces:**
- Produces: `encryptBrowserContext`, `decryptBrowserContext`, `encryptAttemptRuntime`, `decryptAttemptRuntime`, `createViewerBootstrapToken`, `verifyViewerBootstrapToken`, `createViewerSessionToken`, `verifyViewerSessionToken`, `hashViewerNonce`.
- Consumes: `steel-sdk` `SessionContext`, the existing AES key ring shape, and Node crypto.

- [ ] **Step 1: Write failing authenticated-encryption tests**

Use a fixture containing cookies, local storage, session storage, and IndexedDB. Assert round-trip success and failure when `agentId`, `scopeId`, `provider`, `purpose`, or `formatVersion` changes. Also assert `JSON.stringify(encrypted)` does not contain cookie values.

```ts
const context = {
  cookies: [{ name: 'nlg-session', value: 'carrier-secret', domain: '.nationallife.example' }],
  localStorage: { 'https://agent.nationallife.example': { preference: 'compact' } },
  sessionStorage: { 'https://agent.nationallife.example': { flow: 'agent' } },
  indexedDB: {},
}

const binding = {
  agentId: 'agent-1',
  scopeId: 'keepr-one-production',
  provider: 'NATIONAL_LIFE',
  purpose: 'AUTHENTICATED_BROWSER_CONTEXT' as const,
  formatVersion: 1,
}
```

- [ ] **Step 2: Write failing viewer-token tests**

Cover a valid one-time bootstrap payload, signature tampering, expiration, wrong purpose, and confirm the token contains no Steel URL:

```ts
const issued = createViewerBootstrapToken(
  { attemptId: 'attempt-1', agentId: 'agent-1', expiresAt: '2026-07-28T12:05:00.000Z' },
  signingKey,
  () => Buffer.alloc(32, 7),
)

expect(verifyViewerBootstrapToken(issued.token, signingKey, now)).toMatchObject({
  attemptId: 'attempt-1',
  agentId: 'agent-1',
})
expect(issued.token).not.toContain('steel.example')
expect(hashViewerNonce(issued.nonce)).toBe(issued.nonceHash)
```

- [ ] **Step 3: Run both test files and verify failure**

Run: `pnpm exec vitest run lib/national-life/browser-context-crypto.test.ts lib/national-life/viewer-token.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement browser-context encryption**

Use AES-256-GCM with a fresh 12-byte IV and canonical JSON AAD:

```ts
export type BrowserContextBinding = {
  agentId: string
  scopeId: string
  provider: string
  purpose: 'AUTHENTICATED_BROWSER_CONTEXT' | 'INTERACTIVE_ATTEMPT_RUNTIME'
  formatVersion: 1
}

export type AttemptRuntime = {
  steelSessionId: string
  debugUrl: string
  expiresAt: string
}

export type EncryptedBrowserSecret = {
  algorithm: 'aes-256-gcm'
  keyVersion: string
  iv: string
  ciphertext: string
  authTag: string
}
```

Validate decrypted context with Zod before returning it. Reject unknown algorithms, missing key versions, malformed base64, empty ciphertext, and any AAD mismatch with the generic message `Browser context decryption failed`.

- [ ] **Step 5: Implement signed tokens without embedding upstream details**

Use base64url JSON plus `createHmac('sha256', key)` and `timingSafeEqual`. Bootstrap payload:

```ts
type ViewerBootstrapPayload = {
  purpose: 'NATIONAL_LIFE_VIEWER_BOOTSTRAP'
  attemptId: string
  agentId: string
  nonce: string
  expiresAt: string
}
```

Broker-session payload:

```ts
type ViewerSessionPayload = {
  purpose: 'NATIONAL_LIFE_VIEWER_SESSION'
  attemptId: string
  agentId: string
  expiresAt: string
}
```

The bootstrap function returns `{ token, nonce, nonceHash }`; store only the SHA-256 nonce hash.

- [ ] **Step 6: Run crypto tests**

Run: `pnpm exec vitest run lib/national-life/browser-context-crypto.test.ts lib/national-life/viewer-token.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/national-life/browser-context-crypto.ts lib/national-life/browser-context-crypto.test.ts lib/national-life/viewer-token.ts lib/national-life/viewer-token.test.ts
git commit -m "feat: protect National Life browser context"
```

### Task 3: Build the owned connection/session service

**Files:**
- Create: `lib/national-life/interactive-connection-service.ts`
- Create: `lib/national-life/interactive-connection-service.test.ts`
- Modify: `lib/national-life/constants.ts`

**Interfaces:**
- Produces: `startConnectionAttempt`, `getOwnedAttemptStatus`, `issueViewerBootstrap`, `cancelConnectionAttempt`, `completeConnectionAttempt`, `invalidateAgentSession`, `disconnectAgentSession`, `getAgentSessionSummary`, `listAgentSessionHealthForAdmin`.
- Consumes: Prisma models from Task 1 and crypto/token functions from Task 2.

- [ ] **Step 1: Write an in-memory repository test suite**

Cover:

```ts
it('creates only one active attempt for the exact agent/provider')
it('returns an existing unexpired attempt instead of creating a second Steel session')
it('rejects another agent reading or cancelling an attempt')
it('limits starts to five audit events per fifteen minutes')
it('consumes a viewer nonce exactly once')
it('commits encrypted session context before removing the attempt')
it('disconnects only the owning agent session and cancels that agent attempt')
it('returns summaries without ciphertext, runtime, nonce, debug URL, or Steel id')
it('returns admin health rows without ciphertext or viewer access')
```

Use exact constants:

```ts
export const NATIONAL_LIFE_CONNECTION_ATTEMPT_TTL_MS = 10 * 60_000
export const NATIONAL_LIFE_VIEWER_TOKEN_TTL_MS = 60_000
export const NATIONAL_LIFE_CONNECTION_RATE_LIMIT = 5
export const NATIONAL_LIFE_CONNECTION_RATE_WINDOW_MS = 15 * 60_000
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `pnpm exec vitest run lib/national-life/interactive-connection-service.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Define repository and public result types**

```ts
export type ConnectionAttemptStatus = {
  id: string
  state: NationalLifeConnectionAttemptState
  currentOrigin: string | null
  safeErrorCode: string | null
  expiresAt: Date
}

export type AgentSessionSummary = {
  provider: 'NATIONAL_LIFE'
  status: 'CONNECTED' | 'SESSION_EXPIRED'
  lastConnectedAt: Date
  lastUsedAt: Date | null
  carrierExpiresAt: Date | null
}

export type StartConnectionResult =
  | { kind: 'STARTED'; attempt: ConnectionAttemptStatus }
  | { kind: 'EXISTING'; attempt: ConnectionAttemptStatus }
  | { kind: 'RATE_LIMITED' }
```

The Prisma repository must scope every attempt/session mutation by both `agentId` and `provider`. Audit records contain action, user, attempt/session ID, result, and timestamp only.

`listAgentSessionHealthForAdmin` returns `{ agentId, agentName, status, lastConnectedAt, lastUsedAt, carrierExpiresAt }[]` and is called only after `requireRole('ADMIN')`; it never returns attempts, tokens, viewer URLs, Steel IDs, or encrypted fields.

- [ ] **Step 4: Implement atomic lifecycle operations**

`startConnectionAttempt` first requires `interactiveLoginEnabled === true` and, when the pilot set is non-empty, exact membership of `agentId`. It then creates the attempt and `NATIONAL_LIFE_CONNECTION_STARTED` audit event in one transaction. On unique conflict, return the unexpired existing attempt. `completeConnectionAttempt` upserts `AgentIntegrationSession` with all five encrypted fields populated and deletes the exact attempt in one transaction; do not report success if either write fails. `invalidateAgentSession` sets status `SESSION_EXPIRED` and nulls all five encrypted fields atomically, preserving only non-secret timestamps so the UI can show `Reconectar`. `disconnectAgentSession` deletes the record entirely.

`issueViewerBootstrap` verifies owned `AWAITING_LOGIN` or `AWAITING_MFA`, creates the token, stores `nonceHash`, and returns:

```ts
{
  bootstrapUrl: `${env.viewerPublicOrigin}/bootstrap?ticket=${encodeURIComponent(token)}`,
  expiresAt: payload.expiresAt,
}
```

The viewer response later sets `Referrer-Policy: no-referrer`; no analytics runs on the broker origin.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm exec vitest run lib/national-life/interactive-connection-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/national-life/constants.ts lib/national-life/interactive-connection-service.ts lib/national-life/interactive-connection-service.test.ts
git commit -m "feat: manage National Life connection attempts"
```

### Task 4: Add interactive Steel sessions, context capture, and auth classification

**Files:**
- Modify: `workers/national-life/types.ts`
- Modify: `workers/national-life/steel-session.ts`
- Modify: `workers/national-life/steel-session.test.ts`
- Modify: `workers/national-life/adapter.ts`
- Modify: `workers/national-life/adapter.test.ts`
- Modify: `scripts/national-life-fixture-server.ts`
- Modify: `tests/fixtures/national-life/login.html`
- Modify: `tests/fixtures/national-life/mfa.html`
- Modify: `tests/fixtures/national-life/case-results.html`

**Interfaces:**
- Produces: `createInteractiveSteelSession(env)`, `createSteelBrowserSession(env, { sessionContext })`, `captureSteelSessionContext(sessionId, env)`, `NationalLifeAdapter.classifyAuthenticationState()`, `NationalLifeAdapter.assertAuthenticated()`.
- Consumes: Steel SDK `debugConfig`, `sessions.context`, `sessionContext`, exact allowed origins.

- [ ] **Step 1: Replace credential-login tests with state-classification tests**

Fixture markers remain deterministic:

```ts
await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
  kind: 'AWAITING_LOGIN',
  origin: fixtureServer.origin,
})

await page.goto(`${fixtureServer.origin}/mfa`)
await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
  kind: 'AWAITING_MFA',
  origin: fixtureServer.origin,
})

await page.goto(`${fixtureServer.origin}/cases/search`)
await expect(adapter.classifyAuthenticationState()).resolves.toEqual({
  kind: 'AUTHENTICATED',
  origin: fixtureServer.origin,
})
```

Delete tests that call `adapter.login({ username, password })`. Add a source-level assertion that `adapter.ts` contains no calls to `.fill(credentials` and no `NationalLifeCredentials` import.

- [ ] **Step 2: Add failing Steel session tests**

Assert `sessions.create` receives:

```ts
{
  timeout: 600000,
  headless: false,
  solveCaptcha: false,
  persistProfile: false,
  debugConfig: { interactive: true, systemCursor: true },
  dimensions: { width: 1280, height: 800 },
}
```

Also assert a restored worker session receives the exact decrypted `sessionContext`, and `captureSteelSessionContext` calls `sessions.context` for the exact Steel session ID.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm exec vitest run workers/national-life/adapter.test.ts workers/national-life/steel-session.test.ts`

Expected: FAIL because the new interfaces are missing.

- [ ] **Step 4: Implement interactive and restored session creation**

Extend the internal remote session shape to include `sessionViewerUrl`. Add:

```ts
export type InteractiveBrowserSession = BrowserSession & {
  internalDebugUrl: string
}

export async function createInteractiveSteelSession(
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): Promise<InteractiveBrowserSession>

export async function captureSteelSessionContext(
  steelSessionId: string,
  env: NationalLifeEnv,
  deps?: SteelSessionDeps,
): Promise<SessionContext>
```

Use the returned `debugUrl` as the upstream viewer target only inside server/runtime code. Keep the existing Playwright navigation guard on every new and restored context.

- [ ] **Step 5: Implement deterministic auth classification**

```ts
export type NationalLifeAuthenticationState =
  | { kind: 'AWAITING_LOGIN'; origin: string }
  | { kind: 'AWAITING_MFA'; origin: string }
  | { kind: 'AUTHENTICATED'; origin: string }

async classifyAuthenticationState(): Promise<NationalLifeAuthenticationState>
async assertAuthenticated(): Promise<void>
```

Validate the exact URL origin before reading page markers. Unknown pages on an allowlisted origin throw `PORTAL_LAYOUT_CHANGED`; non-allowlisted origins throw `NAVIGATION_ORIGIN_BLOCKED`. No method accepts username or password.

- [ ] **Step 6: Run focused tests**

Run: `pnpm exec vitest run workers/national-life/adapter.test.ts workers/national-life/steel-session.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/national-life/types.ts workers/national-life/steel-session.ts workers/national-life/steel-session.test.ts workers/national-life/adapter.ts workers/national-life/adapter.test.ts scripts/national-life-fixture-server.ts tests/fixtures/national-life
git commit -m "feat: open interactive National Life browser sessions"
```

### Task 5: Orchestrate connection attempts in the runtime

**Files:**
- Create: `workers/national-life/run-connection-attempt.ts`
- Create: `workers/national-life/run-connection-attempt.test.ts`

**Interfaces:**
- Produces: `runNationalLifeConnectionAttempt(attemptId, deps)` and `cleanupNationalLifeConnectionAttempt(attemptId, deps)`.
- Consumes: services from Task 3, Steel functions and adapter from Task 4, crypto from Task 2.

- [ ] **Step 1: Write orchestration tests**

Cover these exact call sequences:

```ts
expect(calls).toEqual([
  'attempt:claim:OPENING_PORTAL',
  'steel:create-interactive',
  'page:goto-login',
  'runtime:encrypt',
  'attempt:AWAITING_LOGIN',
  'steel:disconnect',
])
```

```ts
expect(calls).toEqual([
  'attempt:claim:AWAITING_MFA',
  'runtime:decrypt',
  'steel:reconnect',
  'adapter:AUTHENTICATED',
  'steel:context',
  'context:encrypt',
  'attempt:complete-transaction',
  'steel:close',
])
```

Also cover login remains open, MFA transition, cancellation, expiration, unexpected origin, context-encryption failure, and Steel cleanup retry. A failed context write must leave no `CONNECTED` session summary.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm exec vitest run workers/national-life/run-connection-attempt.test.ts`

Expected: FAIL because the orchestrator is missing.

- [ ] **Step 3: Implement the dependency contract**

```ts
export type RunConnectionAttemptDeps = {
  env: NationalLifeEnv
  workerId: string
  now: () => Date
  store: {
    claim(attemptId: string, workerId: string, now: Date): Promise<StoredConnectionAttempt | null>
    setRuntime(input: SetAttemptRuntimeInput): Promise<void>
    transition(input: TransitionAttemptInput): Promise<void>
    complete(input: CompleteAttemptInput): Promise<void>
    releaseLease(attemptId: string): Promise<void>
  }
  createInteractiveSession(): Promise<InteractiveBrowserSession>
  reconnectSession(runtime: AttemptRuntime): Promise<BrowserSession>
  captureContext(steelSessionId: string): Promise<SessionContext>
  createAdapter(session: BrowserSession): NationalLifeAdapter
}
```

- [ ] **Step 4: Implement open, monitor, complete, and cleanup paths**

For `OPENING_PORTAL`, create and navigate once, encrypt runtime, transition to `AWAITING_LOGIN`, then disconnect Playwright without releasing Steel. For `AWAITING_LOGIN` and `AWAITING_MFA`, decrypt/reconnect, classify, and:

- update the state and `currentOrigin` if human interaction is still required;
- capture/encrypt context and atomically complete if authenticated;
- close/release on authenticated, failed, cancelled, or expired;
- disconnect without release only while the attempt remains interactive.

Never put `debugUrl`, Steel IDs, cookies, or page content in `safeErrorCode`, audit data, or job results.

- [ ] **Step 5: Run tests**

Run: `pnpm exec vitest run workers/national-life/run-connection-attempt.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/national-life/run-connection-attempt.ts workers/national-life/run-connection-attempt.test.ts
git commit -m "feat: orchestrate National Life interactive login"
```

### Task 6: Build the signed viewer broker

**Files:**
- Create: `workers/national-life/viewer-broker.ts`
- Create: `workers/national-life/viewer-broker.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `createNationalLifeViewerBroker(deps)` returning a Node `http.Server`.
- Consumes: viewer tokens from Task 2 and owned attempt runtime from Task 3.

- [ ] **Step 1: Add proxy dependencies**

Run:

```bash
pnpm add http-proxy
pnpm add -D @types/http-proxy
```

Expected: `package.json` and `pnpm-lock.yaml` change only for these packages.

- [ ] **Step 2: Write failing broker tests**

Using a local fake HTTP upstream, prove:

- `/bootstrap?ticket=invalid-token` rejects invalid, expired, replayed, wrong-agent, and wrong-attempt tokens;
- valid bootstrap atomically consumes the nonce, sets `__Host-keepr_nlg_viewer` with `Secure; HttpOnly; SameSite=Strict; Path=/`, sets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, then redirects to `/viewer/`;
- `/viewer/` rejects missing/expired cookies;
- authenticated HTTP and upgrade requests resolve only the attempt's decrypted `debugUrl`;
- requests cannot provide or override an upstream URL;
- terminal, cancelled, or expired attempts invalidate the viewer immediately;
- upstream response headers cannot weaken the broker CSP or referrer policy.

- [ ] **Step 3: Run the focused test and verify failure**

Run: `pnpm exec vitest run workers/national-life/viewer-broker.test.ts`

Expected: FAIL because the broker is missing.

- [ ] **Step 4: Implement bootstrap and cookie authentication**

Expose only:

```ts
GET /health
GET /bootstrap?ticket=<one-time-signed-token>
GET /viewer/*
UPGRADE /viewer/*
```

The bootstrap consumes the stored nonce hash before issuing a five-minute viewer-session cookie. The proxy resolves the attempt by ID from the signed cookie, verifies state `AWAITING_LOGIN` or `AWAITING_MFA`, decrypts runtime server-side, and rewrites to:

```ts
const target = new URL(runtime.debugUrl)
target.searchParams.set('interactive', 'true')
target.searchParams.set('showControls', 'false')
```

Use `http-proxy` with `ws: true`, `changeOrigin: true`, and no client-supplied target. Strip upstream `X-Frame-Options` and replace framing policy with:

```text
Content-Security-Policy: default-src 'self'; frame-ancestors ${env.appOrigin}; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss:; font-src 'self' data:
Referrer-Policy: no-referrer
Cache-Control: no-store
Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()
```

`${env.appOrigin}` is the exact validated `BETTER_AUTH_URL` origin, never a request header. Do not add wildcard sources.

- [ ] **Step 5: Run broker tests**

Run: `pnpm exec vitest run workers/national-life/viewer-broker.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/national-life/viewer-broker.ts workers/national-life/viewer-broker.test.ts package.json pnpm-lock.yaml
git commit -m "feat: broker the National Life live viewer"
```

### Task 7: Replace credential actions with connection-attempt actions

**Files:**
- Create: `lib/security/same-origin-action.ts`
- Create: `lib/security/same-origin-action.test.ts`
- Modify: `app/agent/integrations/national-life/actions.ts`
- Create: `app/agent/integrations/national-life/actions.test.ts`
- Create: `app/api/agent/integrations/national-life/attempt/[attemptId]/route.ts`
- Create: `app/api/agent/integrations/national-life/attempt/[attemptId]/route.test.ts`
- Create: `app/api/agent/integrations/national-life/attempt/[attemptId]/cancel/route.ts`
- Create: `app/api/agent/integrations/national-life/attempt/[attemptId]/cancel/route.test.ts`

**Interfaces:**
- Produces: `startNationalLifeConnection`, `createNationalLifeViewerBootstrap`, `cancelNationalLifeConnection`, `disconnectNationalLifeConnection`, owned status `GET`, and same-origin keepalive cancel `POST`.
- Consumes: `getCurrentAgent`, `headers()`, `interactive-connection-service`.

- [ ] **Step 1: Write same-origin and action tests**

Assert:

```ts
expect(() => assertSameOriginAction({
  origin: 'https://app.keepr.one',
  host: 'app.keepr.one',
  forwardedHost: null,
  forwardedProto: 'https',
})).not.toThrow()
```

Reject absent origin in production, mismatched host, multiple forwarded hosts, non-HTTPS production origin, and lookalike domains. Action tests prove:

- anonymous/client users fail through `getCurrentAgent`;
- start returns only attempt ID/state/expiry;
- viewer bootstrap requires owned interactive state;
- cancel/disconnect scope to the current agent;
- no action accepts `FormData`, username, password, cookie, token, or arbitrary URL;
- safe errors use Portuguese Keepr One copy.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm exec vitest run lib/security/same-origin-action.test.ts app/agent/integrations/national-life/actions.test.ts app/api/agent/integrations/national-life/attempt/\\[attemptId\\]/route.test.ts app/api/agent/integrations/national-life/attempt/\\[attemptId\\]/cancel/route.test.ts
```

Expected: FAIL because the new contracts are missing.

- [ ] **Step 3: Implement the four server actions**

Use discriminated results:

```ts
export type StartConnectionActionResult =
  | { ok: true; attemptId: string; state: string; expiresAt: string }
  | { ok: false; message: string }

export type ViewerBootstrapActionResult =
  | { ok: true; bootstrapUrl: string; expiresAt: string }
  | { ok: false; message: string }
```

Call `assertSameOriginAction` before every mutation. Delete `SAVE_CONNECTION_SCHEMA`, `saveNationalLifeConnection`, and `testNationalLifeConnection`.

- [ ] **Step 4: Implement the owned status route**

Return only:

```ts
{
  id: attempt.id,
  state: attempt.state,
  currentOrigin: attempt.currentOrigin,
  safeErrorCode: attempt.safeErrorCode,
  expiresAt: attempt.expiresAt.toISOString(),
}
```

Set `Cache-Control: no-store`. Return 404 for both missing and non-owned attempts to avoid ownership disclosure.

The cancel route accepts only same-origin `POST`, resolves the current agent, marks only their matching attempt `CANCELLED`, returns 204, and contains no body fields or arbitrary identifiers beyond the route's `attemptId`. It exists so `fetch(cancelUrl, { method: 'POST', keepalive: true })` can run during unmount/navigation/logout.

- [ ] **Step 5: Run focused tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/security/same-origin-action.ts lib/security/same-origin-action.test.ts app/agent/integrations/national-life/actions.ts app/agent/integrations/national-life/actions.test.ts app/api/agent/integrations/national-life/attempt
git commit -m "feat: expose secure National Life connection actions"
```

### Task 8: Build the approved Keepr One connection modal

**Files:**
- Create: `app/agent/integrations/national-life/NationalLifeConnectionCard.tsx`
- Create: `app/agent/integrations/national-life/NationalLifeConnectionCard.test.tsx`
- Create: `app/agent/integrations/national-life/NationalLifeBrowserModal.tsx`
- Create: `app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx`
- Create: `app/agent/integrations/national-life/useNationalLifeConnectionAttempt.ts`
- Delete: `app/agent/integrations/national-life/NationalLifeConnectionForm.tsx`
- Modify: `app/agent/integrations/national-life/page.tsx`
- Create: `app/admin/integrations/national-life/page.tsx`
- Create: `app/admin/integrations/national-life/page.test.tsx`
- Modify: `components/Shell.tsx`
- Modify: `components/Shell.test.tsx`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: centered modal UI and status polling.
- Consumes: Task 7 actions/status route and `AgentSessionSummary`.

- [ ] **Step 1: Add component-test dependencies**

Run:

```bash
pnpm add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Create `tests/setup.ts` containing:

```ts
import '@testing-library/jest-dom/vitest'
```

Set `test.setupFiles` to `['./tests/setup.ts']` in `vitest.config.ts`.

- [ ] **Step 2: Write failing UI tests**

Cover:

- not connected shows `Conectar National Life` and `O Keepr One não armazena sua senha`;
- there are no username/password inputs and no `Salvar conexão` copy;
- clicking connect opens the centered modal;
- modal shows `Entrar na National Life`, `Sessão segura e isolada`, a countdown, and the verified current origin;
- iframe uses only the broker bootstrap URL, has no browser navigation controls, and does not grant clipboard or file-system permissions;
- `AWAITING_MFA` keeps the modal open;
- `AUTHENTICATED` closes it, refreshes, and announces `National Life conectada`;
- timeout/error/cancel closes the viewer and shows a safe reconnect action;
- connected summary shows last connection/use and `Desconectar`.
- component unmount, page navigation, and `keepr-one:sign-out` send a same-origin keepalive cancellation before the Keepr One session ends;
- the admin page lists agent name, connection status, last connected/use timestamps, and expiry only; it exposes no connect, viewer, context export, or impersonation action.

- [ ] **Step 3: Run component tests and verify failure**

Run:

```bash
pnpm exec vitest run app/agent/integrations/national-life/NationalLifeConnectionCard.test.tsx app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx
```

Expected: FAIL because the components are missing.

- [ ] **Step 4: Implement polling hook**

Poll every 1500 ms only while a modal attempt is active. Stop on unmount, terminal state, hidden modal, or abort signal. Request a viewer bootstrap once when the attempt first reaches `AWAITING_LOGIN` or `AWAITING_MFA`; do not mint on every poll. On unmount and `keepr-one:sign-out`, send the exact attempt ID to the same-origin keepalive cancel route.

```ts
export type UseConnectionAttemptResult = {
  status: ConnectionAttemptStatus | null
  viewerUrl: string | null
  error: string | null
  close(): Promise<void>
}
```

- [ ] **Step 5: Implement card and centered modal**

The iframe:

```tsx
<iframe
  title="Portal oficial da National Life"
  src={viewerUrl}
  className="h-full min-h-[600px] w-full border-0"
  sandbox="allow-forms allow-scripts allow-same-origin"
  referrerPolicy="no-referrer"
/>
```

Do not add `allow-popups`, clipboard permissions, downloads, or an editable address bar. The Keepr One frame displays the `currentOrigin` returned by the worker as read-only text.

- [ ] **Step 6: Update the page and security panel**

Use Keepr One copy throughout. Replace credential-oriented text with:

```text
Entre diretamente no portal oficial da National Life. O Keepr One guarda somente a sessão autenticada e nunca armazena sua senha.
```

Remove the old form component and all references to saved credentials or masked username.

Add the admin health page with `requireRole('ADMIN')` and a service query that returns only agent name and `AgentSessionSummary`. Change the admin integration navigation entry to `/admin/integrations/national-life`; admins do not enter an agent's viewer from this page.

Before `authClient.signOut()` in both desktop and mobile logout paths, dispatch:

```ts
window.dispatchEvent(new Event('keepr-one:sign-out'))
await new Promise((resolve) => window.setTimeout(resolve, 50))
```

The 50 ms delay gives the keepalive request a scheduling opportunity; correctness still relies on the server-side attempt TTL and runtime cleanup.

- [ ] **Step 7: Run component tests, typecheck, and lint**

Run:

```bash
pnpm exec vitest run app/agent/integrations/national-life app/admin/integrations/national-life components/Shell.test.tsx
pnpm exec tsc --noEmit
pnpm exec eslint app/agent/integrations/national-life app/api/agent/integrations/national-life lib/security
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add app/agent/integrations/national-life app/admin/integrations/national-life app/api/agent/integrations/national-life components/Shell.tsx components/Shell.test.tsx tests/setup.ts vitest.config.ts package.json pnpm-lock.yaml
git commit -m "feat: add Keepr One National Life login modal"
```

### Task 9: Restore session context in read-only jobs and remove password runtime paths

**Files:**
- Modify: `workers/national-life/run-job.ts`
- Modify: `workers/national-life/run-job.test.ts`
- Modify: `workers/national-life/types.ts`
- Modify: `lib/national-life/job-state.ts`
- Modify: `lib/national-life/job-state.test.ts`
- Delete: `lib/national-life/credential-crypto.ts`
- Delete: `lib/national-life/credential-crypto.test.ts`
- Replace: `lib/national-life/connection-service.ts`
- Replace: `lib/national-life/connection-service.test.ts`

**Interfaces:**
- Produces: sync jobs that require `AgentIntegrationSession` and transition to `ACTION_REQUIRED` on missing/expired/invalid context.
- Consumes: browser-context crypto, restored Steel session, `adapter.assertAuthenticated()`.

- [ ] **Step 1: Rewrite job tests around encrypted session context**

Replace `credentialStore` and `adapter.login` expectations with:

```ts
expect(calls).toEqual([
  'session-store:find',
  'context:decrypt',
  'steel:create-restored',
  'adapter:assert-authenticated',
  'adapter:read',
  'sync:apply',
])
```

Add tests that missing context, expired context, and `AUTHENTICATION_STATE_INVALID` null every encrypted session field, set summary status `SESSION_EXPIRED`, and transition to:

```ts
{
  to: 'ACTION_REQUIRED',
  safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED',
}
```

Assert no job dependency, result, error, or source file contains `password`, `decryptCredential`, or `NationalLifeCredentials`.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm exec vitest run workers/national-life/run-job.test.ts lib/national-life/job-state.test.ts
```

Expected: FAIL against the password-based runtime.

- [ ] **Step 3: Implement restored-context job flow**

Update dependencies:

```ts
sessionStore: {
  findForAgent(agentId: string, provider: string): Promise<StoredAgentIntegrationSession | null>
  markUsed(sessionId: string, usedAt: Date): Promise<void>
  invalidate(agentId: string, provider: string): Promise<void>
}
createSession(sessionContext: SessionContext): Promise<BrowserSession>
```

After claim:

1. read the exact agent/provider session only when status is `CONNECTED` and all encrypted fields are present, then decrypt it;
2. create an isolated Steel browser initialized with `sessionContext`;
3. call `adapter.assertAuthenticated()` before any case lookup;
4. invalidate by nulling encrypted fields, setting `SESSION_EXPIRED`, and request reconnect on rejection;
5. read/apply as before;
6. mark the reusable session used only after authenticated access succeeds;
7. always close the job's Steel session.

Remove job-driven MFA continuation; MFA now exists only in interactive connection attempts.

- [ ] **Step 4: Remove password code from the runtime**

Delete `credential-crypto.ts`, credential tests, `NationalLifeCredentials`, `saveAgentCredential`, `deleteAgentCredential`, and all imports. Replace `connection-service.ts` with a compatibility re-export of session summary/disconnect functions only if another route still imports it; otherwise delete it and update imports directly.

Do not drop the legacy database table in this task.

- [ ] **Step 5: Run focused and National Life suites**

Run:

```bash
pnpm exec vitest run workers/national-life lib/national-life app/agent/integrations/national-life
pnpm exec tsc --noEmit
rg -n "decryptCredential|saveAgentCredential|NationalLifeCredentials|password:" workers/national-life lib/national-life app/agent/integrations/national-life --glob '!*.test.*'
```

Expected: tests/typecheck pass and `rg` returns no password-bearing runtime path.

- [ ] **Step 6: Commit**

```bash
git add workers/national-life lib/national-life app/agent/integrations/national-life
git commit -m "refactor: restore National Life authenticated sessions"
```

### Task 10: Wire the dedicated runtime and deployable viewer service

**Files:**
- Create: `workers/national-life/runtime.ts`
- Create: `workers/national-life/runtime.test.ts`
- Create: `scripts/national-life-runtime.ts`
- Create: `Dockerfile.national-life-runtime`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `lib/national-life/env.ts`
- Modify: `lib/national-life/env.test.ts`

**Interfaces:**
- Produces: `pnpm worker:national-life`, broker health endpoint, bounded attempt/job loops.
- Consumes: Task 5 attempt orchestrator, Task 6 broker, Task 9 sync runner.

- [ ] **Step 1: Write environment and runtime-loop tests**

Require:

```text
NATIONAL_LIFE_SESSION_SCOPE_ID
NATIONAL_LIFE_SESSION_KEY_VERSION
NATIONAL_LIFE_SESSION_KEYS
NATIONAL_LIFE_VIEWER_SIGNING_KEY
NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN
NATIONAL_LIFE_VIEWER_BIND_HOST
NATIONAL_LIFE_VIEWER_PORT
NATIONAL_LIFE_RUNTIME_WORKER_ID
NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED
NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS
BETTER_AUTH_URL
```

Tests reject non-HTTPS public/app origins, signing/encryption keys not exactly 32 bytes after base64 decode, invalid port, wildcard portal origins, invalid boolean feature flag, and identical worker IDs in concurrent fixtures. Parse `NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS` as an exact comma-separated set of agent IDs with no wildcard support. Runtime tests use fake timers to prove:

- the loop claims connection attempts and browser jobs independently;
- one failure does not stop later polls;
- SIGTERM stops claiming, cleans leased interactive attempts, closes the broker, then exits;
- no loop busy-spins when queues are empty.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
pnpm exec vitest run lib/national-life/env.test.ts workers/national-life/runtime.test.ts
```

Expected: FAIL because new environment and runtime contracts are missing.

- [ ] **Step 3: Implement runtime wiring**

Use bounded polling with a 1000 ms empty-queue delay and one in-flight unit per loop:

```ts
export async function runNationalLifeRuntime(deps: RuntimeDeps) {
  const abortController = new AbortController()
  const shutdown = () => abortController.abort()
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const broker = createNationalLifeViewerBroker(deps.viewer)
  await deps.listen(broker)

  await Promise.all([
    runAttemptLoop(deps, abortController.signal),
    runBrowserJobLoop(deps, abortController.signal),
  ])

  await deps.closeServer(broker)
}
```

The concrete wiring uses Prisma repositories, Steel SDK, Playwright, and the active session key ring. Redact errors before logging; log IDs, states, codes, and durations only.

- [ ] **Step 4: Add executable script and package command**

```json
{
  "scripts": {
    "worker:national-life": "tsx scripts/national-life-runtime.ts"
  }
}
```

The entrypoint calls `runNationalLifeRuntime` and sets a non-zero exit code on startup/configuration failure without printing secret values.

- [ ] **Step 5: Create the dedicated container**

`Dockerfile.national-life-runtime` must:

1. use Node 22;
2. install the locked pnpm dependencies;
3. run `pnpm exec prisma generate`;
4. copy only required `lib`, `workers`, `scripts`, Prisma client/schema, package, and tsconfig files;
5. expose the configured viewer port `3010`;
6. healthcheck `http://127.0.0.1:3010/health`;
7. run `pnpm worker:national-life`;
8. not run `prisma migrate deploy` concurrently with the web container.

- [ ] **Step 6: Run tests and build both images**

Run:

```bash
pnpm exec vitest run lib/national-life/env.test.ts workers/national-life/runtime.test.ts
pnpm exec tsc --noEmit
docker build -t keepr-one-web:test .
docker build -f Dockerfile.national-life-runtime -t keepr-one-national-life-runtime:test .
```

Expected: all commands exit 0 and both healthcheck commands exist in image metadata.

- [ ] **Step 7: Commit**

```bash
git add workers/national-life/runtime.ts workers/national-life/runtime.test.ts scripts/national-life-runtime.ts Dockerfile.national-life-runtime package.json pnpm-lock.yaml .env.example lib/national-life/env.ts lib/national-life/env.test.ts
git commit -m "feat: run National Life connection runtime"
```

### Task 11: Verify locally and document the production gate

**Files:**
- Create: `tests/national-life/interactive-login.test.ts`
- Modify: `scripts/national-life-fixture-server.ts`
- Create: `docs/operations/national-life-interactive-login-rollout.md`

**Interfaces:**
- Produces: local end-to-end proof and exact production runbook.
- Consumes: all prior tasks.

- [ ] **Step 1: Add a fixture-backed end-to-end test**

The test must start the fixture portal, fake Steel viewer/upstream, broker, runtime, and service repositories, then prove:

1. start returns an owned attempt;
2. broker bootstrap is single-use;
3. viewer reaches the real fixture login page;
4. fixture login/MFA values are absent from Keepr One business requests and persisted records;
5. authenticated context is encrypted;
6. the interactive viewer becomes unavailable after success;
7. a new read job restores context and reads `NLG-TEST-1001`;
8. disconnect removes session context.

- [ ] **Step 2: Run the end-to-end test and fix only feature-scoped failures**

Run: `pnpm exec vitest run tests/national-life/interactive-login.test.ts`

Expected: PASS.

- [ ] **Step 3: Write the rollout runbook**

Document exact phases:

```text
1. Deploy additive migration and web code with feature disabled.
2. Deploy the dedicated runtime with private Steel access and public viewer broker origin.
3. Verify /health, one active worker ID, database connectivity, and Steel session cleanup.
4. Verify the pinned self-hosted Steel image digest, `headless: false`, absence of the recorder extension, empty replay-event response, absence of HLS/MP4 artifacts, and configured retention cleanup for an interactive fixture session.
5. Enable only for named pilot agent IDs.
6. Complete one authorized National Life login, MFA, encrypted context restore, case read, expiry/reconnect, disconnect, and resource cleanup.
7. Search application/runtime logs and database columns for the pilot password test marker; expected count is zero.
8. Verify the pilot Steel session produced no replay events, recording playlist, screenshots, or retained viewer artifact.
9. Record National Life authorization/terms confirmation and pilot evidence.
10. Obtain explicit approval before applying the legacy credential purge migration.
```

Include rollback: disable feature, stop new attempts, let runtime clean active Steel sessions, retain encrypted browser context only while investigating, and keep the old table inaccessible to code. Never restore password-based login.

- [ ] **Step 4: Run the full local verification boundary**

Run:

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm build
git diff --check
```

Expected: all commands exit 0. If a pre-existing unrelated failure appears, record the exact command and failure separately; do not label global validation clean.

- [ ] **Step 5: Commit**

```bash
git add tests/national-life/interactive-login.test.ts scripts/national-life-fixture-server.ts docs/operations/national-life-interactive-login-rollout.md
git commit -m "test: verify National Life interactive login"
```

### Task 12: Authorized real-portal checkpoint and legacy password purge

**Files:**
- Create only after approval: `prisma/migrations/20260728_purge_national_life_password_credentials/migration.sql`
- Modify only after approval: `prisma/schema.prisma`
- Modify only after approval: `docs/operations/national-life-interactive-login-rollout.md`

**Interfaces:**
- Produces: verified production session login/restore evidence and removal of the obsolete password table.
- Consumes: authorized National Life agent access and explicit user approval.

- [ ] **Step 1: Stop for the authorized external checkpoint**

Do not create or apply the destructive migration yet. Present the runbook and request an authorized agent to complete:

```text
real portal rendered -> password entered by agent -> MFA completed -> authenticated marker detected -> modal closed -> encrypted context restored in a separate job -> read-only case sync succeeded -> session expired/reconnect proven -> disconnect cleanup proven
```

Also confirm the National Life agreement/terms authorization and prove the pinned self-hosted Steel session retained no recording/replay artifact. These are required external gates, not replaceable by fixture tests.

- [ ] **Step 2: Obtain explicit approval for destructive purge**

Before deleting anything, report:

- exact production count of `AgentIntegrationCredential` rows;
- count of connected `AgentIntegrationSession` pilot rows;
- last successful context restore timestamp;
- rollback state and backup/retention policy;
- exact migration SQL to be applied.

Proceed only after the user explicitly approves the purge.

- [ ] **Step 3: Create the purge migration**

After approval, remove `Agent.integrationCredentials` and `AgentIntegrationCredential` from Prisma schema and create:

```sql
DROP TABLE "AgentIntegrationCredential";
```

Do not export, decrypt, copy, or log any legacy ciphertext before dropping it.

- [ ] **Step 4: Validate and apply through the normal deployment path**

Run locally:

```bash
pnpm exec prisma validate
pnpm exec prisma generate
pnpm exec vitest run
pnpm exec tsc --noEmit
```

Then deploy via the repository's normal Coolify path. Verify production migration status and query the catalog to confirm `"AgentIntegrationCredential"` no longer exists.

- [ ] **Step 5: Record runtime-backed proof**

Append the deployment ID/time, migration name, zero legacy table presence, successful Keepr One `/agent/integrations/national-life` response, runtime `/health`, one restored read-only sync, and Steel resource cleanup to the rollout document. Do not include credentials, cookies, tokens, applicant data, or debug URLs.

- [ ] **Step 6: Commit the approved purge**

```bash
git add prisma/schema.prisma prisma/migrations/20260728_purge_national_life_password_credentials docs/operations/national-life-interactive-login-rollout.md
git commit -m "security: purge legacy National Life credentials"
```

## Final Verification Matrix

| Boundary | Required proof |
|---|---|
| Product identity | Feature UI and operational messages say Keepr One |
| Real portal | Steel viewer renders the actual National Life/Auth0 page |
| Secret handling | No password/MFA values in Keepr One forms, business APIs, DB, jobs, logs, analytics, screenshots, or recordings |
| Ownership | Cross-agent and cross-scope attempts/sessions/viewer tokens are denied |
| Viewer | One-time bootstrap, HttpOnly short session, no raw Steel URL/API key, no arbitrary target |
| Recording | Pinned self-hosted headful Steel session produces no replay events, MP4/HLS artifact, screenshot, or retained viewer data |
| Navigation | Exact National Life/Auth0 allowlist; lookalikes terminate |
| Persistence | Steel `sessionContext` encrypted with AES-256-GCM and bound AAD |
| Success | Modal closes only after deterministic authenticated marker and committed encrypted context |
| Reuse | Separate read-only job restores context and proves authentication before reading |
| Expiry | Invalid context is deleted and job becomes `ACTION_REQUIRED` |
| Cleanup | Cancel, timeout, logout, success, disconnect, and SIGTERM release Steel resources |
| Migration | Password table remains during pilot, then is dropped only after explicit approval |
| Operations | Dedicated runtime and viewer health proven in deployed Coolify service |
