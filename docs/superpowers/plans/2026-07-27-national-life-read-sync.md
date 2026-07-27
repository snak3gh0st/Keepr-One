# National Life Read Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Phase 1 proof of concept in which an authorized Fyntra agent securely connects an individual National Life account and manually synchronizes one life-insurance case without performing any carrier write.

**Architecture:** The existing Next.js application owns authorization, encrypted credentials, jobs and normalized records. A separate TypeScript worker process claims durable PostgreSQL jobs, creates an isolated self-hosted Steel session, connects with Playwright over CDP and runs a deterministic National Life adapter. The adapter returns validated observations to a transaction service that idempotently updates existing `Application`, `ApplicationRequirement`, `ExternalReference`, `SyncEvent` and timeline records.

**Tech Stack:** Next.js 16.2.10, React 19.2.4, TypeScript 5, Prisma 6.19.3, PostgreSQL, Better Auth 1.6.23, Zod 4.4.3, Vitest 4.1.10, `playwright-core`, `steel-sdk`, self-hosted `steel-dev/steel-browser`.

## Global Constraints

- Carrier is `NATIONAL_LIFE`; line of business is life insurance only.
- Phase 1 is read-only: no portal application creation, field mutation, upload, signature, submission or policy creation.
- Credentials are individual per agent, server-only, envelope-encrypted and never returned after save.
- Plaintext credentials, cookies, tokens, SSNs and health data must not enter logs, queue payloads, traces, screenshots or test fixtures.
- MFA and CAPTCHA pause for the owning human agent; neither is bypassed.
- Browser navigation is limited to exact configured HTTPS National Life origins.
- Every browser session is isolated and destroyed after success, failure, timeout or cancellation.
- Sync and persistence are idempotent; the carrier remains authoritative.
- Real-portal validation uses an authorized account and a known permitted case.
- Do not add Stagehand or Camoufox during Phase 1.
- Preserve unrelated worktree changes, including the existing untracked `Jenkinsfile`.

---

## File Structure

### Configuration and cryptography

- `lib/national-life/constants.ts`: provider identity, operation names and non-secret limits.
- `lib/national-life/env.ts`: server-only environment parsing.
- `lib/national-life/credential-crypto.ts`: authenticated encryption and key-version handling.
- `lib/national-life/continuation-crypto.ts`: encrypted, expiring Steel MFA continuation.
- `lib/national-life/redaction.ts`: structured diagnostic redaction.

### Persistence and application services

- `prisma/schema.prisma`: per-agent connection and durable browser-job records.
- `prisma/migrations/<timestamp>_add_national_life_browser_sync/migration.sql`: exact database migration.
- `lib/national-life/connection-service.ts`: credential save, test-state and deletion operations.
- `lib/national-life/job-service.ts`: enqueue, claim and state transition rules.
- `lib/national-life/sync-service.ts`: validated, idempotent persistence into existing case records.

### Browser worker

- `workers/national-life/types.ts`: worker and adapter contracts.
- `workers/national-life/steel-session.ts`: Steel lifecycle and Playwright CDP connection.
- `workers/national-life/adapter.ts`: deterministic National Life login/search/extraction.
- `workers/national-life/run-job.ts`: one job's orchestration and cleanup.
- `workers/national-life/index.ts`: bounded polling loop and graceful shutdown.

### User interface

- `app/agent/integrations/national-life/page.tsx`: connection page.
- `app/agent/integrations/national-life/actions.ts`: authorized server actions.
- `app/agent/integrations/national-life/NationalLifeConnectionForm.tsx`: secret-entry and connection-status UI.
- `app/agent/integrations/national-life/mfa/[jobId]/page.tsx`: owner-only interactive Steel MFA handoff.
- `app/agent/integrations/national-life/mfa/[jobId]/actions.ts`: authorized MFA resume/cancel actions.
- `app/agent/cases/[id]/actions.ts`: manual sync action.
- `app/agent/cases/[id]/CaseWorkspace.tsx`: sync control and current status.
- `app/agent/cases/[id]/page.tsx`: query and serialize sync state.
- `components/Shell.tsx`: navigation entry.

### Test portal and operations

- `tests/fixtures/national-life/*.html`: synthetic portal states without personal data.
- `tests/national-life/fake-browser.ts`: deterministic adapter test harness.
- `scripts/national-life-fixture-server.ts`: local fixture portal.
- `docs/operations/national-life-read-sync.md`: local, deployment and assisted-smoke runbook.

---

### Task 1: Server-Only Configuration, Encryption and Redaction

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `lib/national-life/constants.ts`
- Create: `lib/national-life/env.ts`
- Create: `lib/national-life/credential-crypto.ts`
- Create: `lib/national-life/credential-crypto.test.ts`
- Create: `lib/national-life/redaction.ts`
- Create: `lib/national-life/redaction.test.ts`

**Interfaces:**
- Produces: `NATIONAL_LIFE_PROVIDER`, `NationalLifeEnv`, `getNationalLifeEnv()`.
- Produces: `EncryptedSecret`, `encryptCredential()`, `decryptCredential()`.
- Produces: `redactDiagnostic()`.

- [ ] **Step 1: Add worker runtime dependencies**

Run:

```bash
pnpm add playwright-core steel-sdk
```

Expected: `package.json` and `pnpm-lock.yaml` contain both runtime dependencies; no browser binary is downloaded by `playwright-core`.

- [ ] **Step 2: Write failing encryption tests**

Create `lib/national-life/credential-crypto.test.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptCredential, encryptCredential } from './credential-crypto'

const key = randomBytes(32).toString('base64')
const context = { agentId: 'agent-1', scopeId: 'fyntra-production', provider: 'NATIONAL_LIFE' }

describe('National Life credential encryption', () => {
  it('round trips only with matching authenticated context', () => {
    const encrypted = encryptCredential({ username: 'producer', password: 'secret' }, context, {
      version: 'v1',
      base64Key: key,
    })
    expect(decryptCredential(encrypted, context, { v1: key })).toEqual({
      username: 'producer',
      password: 'secret',
    })
  })

  it('rejects ciphertext rebound to another agent', () => {
    const encrypted = encryptCredential({ username: 'producer', password: 'secret' }, context, {
      version: 'v1',
      base64Key: key,
    })
    expect(() =>
      decryptCredential(encrypted, { ...context, agentId: 'agent-2' }, { v1: key }),
    ).toThrow()
  })
})
```

- [ ] **Step 3: Run the encryption tests and verify failure**

Run:

```bash
pnpm vitest run lib/national-life/credential-crypto.test.ts
```

Expected: FAIL because `credential-crypto.ts` does not exist.

- [ ] **Step 4: Implement typed environment parsing and authenticated encryption**

Create `lib/national-life/constants.ts`:

```ts
export const NATIONAL_LIFE_PROVIDER = 'NATIONAL_LIFE' as const
export const NATIONAL_LIFE_MAX_JOB_ATTEMPTS = 3
export const NATIONAL_LIFE_JOB_TIMEOUT_MS = 5 * 60_000
```

Create `lib/national-life/env.ts` with a Zod schema that requires:

```ts
export type NationalLifeEnv = {
  steelBaseUrl: string
  steelApiKey?: string
  portalOrigins: string[]
  portalLoginUrl: string
  credentialScopeId: string
  credentialKeyVersion: string
  credentialKeys: Record<string, string>
}

export function getNationalLifeEnv(): NationalLifeEnv
```

Parse `NATIONAL_LIFE_CREDENTIAL_KEYS` as JSON mapping key versions to base64-encoded 32-byte keys. Require `NATIONAL_LIFE_CREDENTIAL_SCOPE_ID` as a stable, non-secret deployment/tenant identifier because the current Fyntra schema has no `Organization` model. Require `NATIONAL_LIFE_PORTAL_LOGIN_URL` to be HTTPS and its origin to occur in the comma-separated `NATIONAL_LIFE_PORTAL_ORIGINS`. Do not prefix any export with `NEXT_PUBLIC_`.

Create `lib/national-life/credential-crypto.ts` with:

```ts
export type CredentialPlaintext = { username: string; password: string }
export type CredentialContext = { agentId: string; scopeId: string; provider: string }
export type EncryptedSecret = {
  algorithm: 'aes-256-gcm'
  keyVersion: string
  iv: string
  ciphertext: string
  authTag: string
}

export function encryptCredential(
  value: CredentialPlaintext,
  context: CredentialContext,
  activeKey: { version: string; base64Key: string },
): EncryptedSecret

export function decryptCredential(
  value: EncryptedSecret,
  context: CredentialContext,
  keys: Record<string, string>,
): CredentialPlaintext
```

Use `createCipheriv('aes-256-gcm', key, randomBytes(12))`, canonical JSON for associated data, `Buffer.from(..., 'base64')` length validation and `setAAD`. Never include plaintext in thrown error messages.

- [ ] **Step 5: Write redaction tests**

Create `lib/national-life/redaction.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { redactDiagnostic } from './redaction'

it('recursively redacts secrets and sensitive identifiers', () => {
  expect(redactDiagnostic({
    username: 'agent@example.com',
    password: 'secret',
    authorization: 'Bearer token',
    cookie: 'session=x',
    applicantSsn: '111-22-3333',
    safeCode: 'SELECTOR_NOT_FOUND',
  })).toEqual({
    username: '[REDACTED]',
    password: '[REDACTED]',
    authorization: '[REDACTED]',
    cookie: '[REDACTED]',
    applicantSsn: '[REDACTED]',
    safeCode: 'SELECTOR_NOT_FOUND',
  })
})
```

- [ ] **Step 6: Implement recursive redaction**

Create `lib/national-life/redaction.ts`:

```ts
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|session|ssn|social|health|username|email/i

export function redactDiagnostic(value: unknown): unknown
```

Return primitives unchanged, map arrays recursively and replace any object property matching `SENSITIVE_KEY` with `[REDACTED]`. Limit recursion depth to 8 and string length to 2,000 characters.

- [ ] **Step 7: Run focused and global tests**

Run:

```bash
pnpm vitest run lib/national-life/credential-crypto.test.ts lib/national-life/redaction.test.ts
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml lib/national-life
git commit -m "feat: add National Life credential security primitives"
```

---

### Task 2: Per-Agent Connection and Durable Job Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<generated_timestamp>_add_national_life_browser_sync/migration.sql`
- Create: `lib/national-life/job-state.ts`
- Create: `lib/national-life/job-state.test.ts`

**Interfaces:**
- Consumes: `EncryptedSecret` serialized into dedicated scalar fields.
- Produces: Prisma models `AgentIntegrationCredential` and `BrowserAutomationJob`.
- Produces: `BrowserJobState`, `assertBrowserJobTransition()`.

- [ ] **Step 1: Write failing state-transition tests**

Create `lib/national-life/job-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertBrowserJobTransition } from './job-state'

describe('browser job transitions', () => {
  it.each([
    ['QUEUED', 'RUNNING'],
    ['RUNNING', 'WAITING_FOR_MFA'],
    ['WAITING_FOR_MFA', 'QUEUED'],
    ['RUNNING', 'SUCCEEDED'],
    ['RUNNING', 'RETRYABLE'],
    ['RETRYABLE', 'QUEUED'],
    ['RUNNING', 'CREDENTIALS_EXPIRED'],
    ['RUNNING', 'MANUAL_REVIEW'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertBrowserJobTransition(from, to)).not.toThrow()
  })

  it('rejects retrying a succeeded job', () => {
    expect(() => assertBrowserJobTransition('SUCCEEDED', 'QUEUED')).toThrow(
      'Invalid browser job transition',
    )
  })
})
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
pnpm vitest run lib/national-life/job-state.test.ts
```

Expected: FAIL because `job-state.ts` does not exist.

- [ ] **Step 3: Add enums, relations and models**

Add Prisma enums:

```prisma
enum BrowserJobState {
  QUEUED
  RUNNING
  WAITING_FOR_MFA
  WAITING_FOR_REVIEW
  RETRYABLE
  CREDENTIALS_EXPIRED
  MANUAL_REVIEW
  SUCCEEDED
  FAILED
  CANCELLED
}

enum BrowserJobOperation {
  TEST_CONNECTION
  SYNC_CASE_READ
}
```

Add `integrationCredentials AgentIntegrationCredential[]` and `browserJobs BrowserAutomationJob[]` to `Agent`, then add:

```prisma
model AgentIntegrationCredential {
  id              String   @id @default(cuid())
  agentId         String
  agent           Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  provider        String
  maskedUsername  String
  keyVersion      String
  algorithm       String
  iv              String
  ciphertext      String
  authTag         String
  status          String   @default("UNTESTED")
  lastTestedAt    DateTime?
  lastSucceededAt DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([agentId, provider])
  @@index([provider, status])
}

model BrowserAutomationJob {
  id                 String              @id @default(cuid())
  agentId            String
  agent              Agent               @relation(fields: [agentId], references: [id], onDelete: Cascade)
  caseId             String?
  insuranceCase      InsuranceCase?      @relation(fields: [caseId], references: [id], onDelete: Cascade)
  provider           String
  operation          BrowserJobOperation
  state              BrowserJobState     @default(QUEUED)
  idempotencyKey     String              @unique
  input              Json
  result             Json?
  safeErrorCode      String?
  safeErrorDetail    Json?
  attemptCount       Int                 @default(0)
  availableAt        DateTime            @default(now())
  leaseOwner         String?
  leaseExpiresAt     DateTime?
  continuationKeyVersion String?
  continuationIv         String?
  continuationCiphertext String?
  continuationAuthTag    String?
  continuationExpiresAt DateTime?
  startedAt          DateTime?
  finishedAt         DateTime?
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  @@index([state, availableAt])
  @@index([agentId, createdAt])
  @@index([caseId, createdAt])
}
```

Add `browserJobs BrowserAutomationJob[]` to `InsuranceCase`. Do not store credentials, portal cookies or arbitrary URLs in `input`. The continuation fields may hold only an encrypted `{ steelSessionId, debugUrl }` object and must be cleared when the job leaves `WAITING_FOR_MFA`.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
pnpm prisma migrate dev --name add_national_life_browser_sync
pnpm prisma generate
```

Expected: migration contains only the two enums, two tables, indexes, foreign keys and relation changes described above.

- [ ] **Step 5: Implement transition validation**

Create `lib/national-life/job-state.ts` with the exported union:

```ts
export type BrowserJobState =
  | 'QUEUED' | 'RUNNING' | 'WAITING_FOR_MFA' | 'WAITING_FOR_REVIEW'
  | 'RETRYABLE' | 'CREDENTIALS_EXPIRED' | 'MANUAL_REVIEW'
  | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'

export function assertBrowserJobTransition(from: BrowserJobState, to: BrowserJobState): void
```

Encode an explicit `Record<BrowserJobState, readonly BrowserJobState[]>`; terminal states have no outgoing transitions.

- [ ] **Step 6: Verify schema and tests**

Run:

```bash
pnpm prisma validate
pnpm vitest run lib/national-life/job-state.test.ts
pnpm test
```

Expected: schema valid and all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/national-life/job-state.ts lib/national-life/job-state.test.ts
git commit -m "feat: persist National Life connections and browser jobs"
```

---

### Task 3: Authorized Connection Service and Agent UI

**Files:**
- Create: `lib/national-life/connection-service.ts`
- Create: `lib/national-life/connection-service.test.ts`
- Create: `app/agent/integrations/national-life/actions.ts`
- Create: `app/agent/integrations/national-life/page.tsx`
- Create: `app/agent/integrations/national-life/NationalLifeConnectionForm.tsx`
- Modify: `components/Shell.tsx`

**Interfaces:**
- Consumes: `getCurrentAgent()`, `encryptCredential()`, `getNationalLifeEnv()`.
- Produces: `saveAgentCredential()`, `deleteAgentCredential()`, `getAgentConnectionSummary()`.
- Produces server actions: `saveNationalLifeConnection()`, `deleteNationalLifeConnection()`, `testNationalLifeConnection()`.

- [ ] **Step 1: Write service tests with an injected repository**

Create tests proving:

```ts
it('encrypts and stores only masked identity plus ciphertext')
it('binds encryption context to the owning agent')
it('deletes only the exact agent/provider connection')
it('never returns ciphertext or plaintext in the connection summary')
```

Use an in-memory `CredentialRepository` and inject the active key; assert the repository write has no `password` or plaintext `username` property.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run lib/national-life/connection-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the service**

Define:

```ts
export type CredentialRepository = {
  upsert(input: StoredCredentialInput): Promise<void>
  delete(agentId: string, provider: string): Promise<void>
  findSummary(agentId: string, provider: string): Promise<ConnectionSummary | null>
}

export async function saveAgentCredential(
  input: { agentId: string; scopeId: string; username: string; password: string },
  deps?: ConnectionServiceDeps,
): Promise<void>

export async function deleteAgentCredential(
  input: { agentId: string; provider: string },
  deps?: ConnectionServiceDeps,
): Promise<void>

export async function getAgentConnectionSummary(
  agentId: string,
  deps?: ConnectionServiceDeps,
): Promise<ConnectionSummary | null>
```

Validate username length `1..200` and password length `1..500`. Mask usernames as first character plus `***` and, for emails, preserve only the domain. Zero local Buffer references in `finally` where practical.

- [ ] **Step 4: Add authorized server actions**

In `actions.ts`, use Zod `safeParse`, call `getCurrentAgent()` on every action and derive the agent ID server-side. Return only:

```ts
type ConnectionActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }
```

`testNationalLifeConnection()` enqueues a `TEST_CONNECTION` job; it does not decrypt or run Playwright inside the request. The action obtains `scopeId` from server-only environment, never from form input. Add a small database-backed attempt limiter keyed by agent and recent `BrowserAutomationJob` count: maximum five connection-test jobs in fifteen minutes.

- [ ] **Step 5: Build the connection page**

The server page queries only `ConnectionSummary`. The client form:

- uses `type="text"` for username and `type="password"` with `autoComplete="current-password"`;
- never pre-populates either value;
- clears password state immediately after the server action settles;
- shows `Não testada`, `Conectada`, `Credenciais expiradas` or `Ação necessária`;
- requires confirmation before deletion;
- provides **Salvar conexão**, **Testar conexão** and **Desconectar**.

Add an `Integrações` navigation entry in `Shell` visible only to agent/admin portal roles.

- [ ] **Step 6: Run tests and static gates**

Run:

```bash
pnpm vitest run lib/national-life/connection-service.test.ts
pnpm lint
pnpm build
```

Expected: tests, lint and build PASS; the client bundle has no import from `credential-crypto.ts` or `env.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/national-life app/agent/integrations components/Shell.tsx
git commit -m "feat: add secure National Life connection flow"
```

---

### Task 4: Idempotent Job Enqueue, Claim and Lease

**Files:**
- Create: `lib/national-life/job-service.ts`
- Create: `lib/national-life/job-service.test.ts`

**Interfaces:**
- Consumes: `assertBrowserJobTransition()`, Prisma `BrowserAutomationJob`.
- Produces: `enqueueConnectionTest()`, `enqueueCaseReadSync()`, `claimNextJob()`, `transitionJob()`, `releaseExpiredLeases()`.

- [ ] **Step 1: Write job-service tests**

Test an injected `BrowserJobRepository` for:

```ts
it('deduplicates an active case sync by agent, case and five-minute bucket')
it('never places credentials or URLs in job input')
it('claims one available job with a lease')
it('does not claim a job whose lease is active')
it('requeues an expired lease below the attempt limit')
it('fails an expired lease at the attempt limit')
```

The expected case input is exactly:

```ts
{ caseId: 'case-1', applicationId: 'app-1', lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' } }
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run lib/national-life/job-service.test.ts
```

Expected: FAIL because `job-service.ts` does not exist.

- [ ] **Step 3: Implement enqueue and transitions**

Export:

```ts
export async function enqueueConnectionTest(agentId: string): Promise<{ jobId: string }>

export async function enqueueCaseReadSync(input: {
  agentId: string
  caseId: string
  applicationId: string
  lookup: { kind: 'EXTERNAL_ID'; value: string }
}): Promise<{ jobId: string; duplicate: boolean }>

export async function claimNextJob(workerId: string, now?: Date): Promise<ClaimedBrowserJob | null>

export async function transitionJob(input: {
  jobId: string
  from: BrowserJobState
  to: BrowserJobState
  result?: unknown
  safeErrorCode?: string
  safeErrorDetail?: unknown
}): Promise<void>

export async function releaseExpiredLeases(now?: Date): Promise<number>
```

Use a short Prisma transaction and compare-and-set update for claim (`state=QUEUED`, `availableAt<=now`, lease absent/expired). Set a 6-minute lease and increment `attemptCount`. Redact error details before persistence.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm vitest run lib/national-life/job-service.test.ts
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/job-service.ts lib/national-life/job-service.test.ts
git commit -m "feat: add durable National Life browser job queue"
```

---

### Task 5: Steel Session Boundary and Navigation Allowlist

**Files:**
- Create: `workers/national-life/types.ts`
- Create: `workers/national-life/steel-session.ts`
- Create: `workers/national-life/steel-session.test.ts`

**Interfaces:**
- Consumes: `NationalLifeEnv`.
- Produces: `BrowserSession`, `createSteelBrowserSession()`, `reconnectSteelBrowserSession()`, `assertAllowedNavigation()`.

- [ ] **Step 1: Write allowlist and cleanup tests**

Create tests that assert:

```ts
expect(() => assertAllowedNavigation(
  'https://agent.nationallife.example/cases',
  ['https://agent.nationallife.example'],
)).not.toThrow()

expect(() => assertAllowedNavigation(
  'https://agent.nationallife.example.evil.test/',
  ['https://agent.nationallife.example'],
)).toThrow('Navigation origin is not allowed')
```

With fake Steel and Playwright clients, verify `close()` always closes the Playwright browser connection and releases the Steel session exactly once.

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run workers/national-life/steel-session.test.ts
```

Expected: FAIL because the session module does not exist.

- [ ] **Step 3: Define worker contracts**

In `types.ts`, define:

```ts
export type NationalLifeCredentials = Readonly<{ username: string; password: string }>

export type NationalLifeCaseObservation = {
  externalApplicationId: string
  carrierStatus: string
  observedAt: string
  requirements: Array<{
    externalId: string
    title: string
    description?: string
    carrierStatus: string
    dueAt?: string
  }>
  communications: Array<{
    externalId: string
    title: string
    body?: string
    occurredAt: string
  }>
  documents: Array<{
    externalId: string
    filename: string
    contentType?: string
    availableAt?: string
  }>
}

export type AdapterRunResult =
  | { kind: 'CONNECTED' }
  | { kind: 'MFA_REQUIRED'; resumeHint: string }
  | { kind: 'CASE_OBSERVED'; observation: NationalLifeCaseObservation }
```

The POC records document metadata only; it does not download files.

- [ ] **Step 4: Implement Steel and Playwright lifecycle**

`createSteelBrowserSession()`:

1. creates a Steel session with `steel-sdk`;
2. connects `playwright-core` Chromium to the session CDP endpoint;
3. creates or reuses one isolated context;
4. installs a request/navigation guard that rejects disallowed document origins;
5. exposes one page and idempotent `close()`;
6. releases the Steel session through `close()` on terminal completion or uses `disconnect()` only for a bounded MFA continuation.

Do not log the CDP URL because it may contain session authorization.

`BrowserSession` also exposes `steelSessionId` and `debugUrl` to the worker in memory. Add `disconnect()` to close only the Playwright CDP connection while preserving the Steel session during an MFA handoff, and:

```ts
export async function reconnectSteelBrowserSession(
  continuation: { steelSessionId: string; debugUrl: string },
  env: NationalLifeEnv,
): Promise<BrowserSession>
```

`reconnectSteelBrowserSession()` must confirm the session still exists, reinstall the navigation guard and fail with `MFA_SESSION_EXPIRED` after the continuation deadline. `close()` remains the only method that releases the Steel session.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run workers/national-life/steel-session.test.ts
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/national-life
git commit -m "feat: isolate National Life Steel browser sessions"
```

---

### Task 6: Deterministic National Life Adapter Against Synthetic Fixtures

**Files:**
- Create: `workers/national-life/adapter.ts`
- Create: `workers/national-life/adapter.test.ts`
- Create: `tests/national-life/fake-browser.ts`
- Create: `tests/fixtures/national-life/login.html`
- Create: `tests/fixtures/national-life/mfa.html`
- Create: `tests/fixtures/national-life/case-results.html`
- Create: `tests/fixtures/national-life/case-detail.html`
- Create: `tests/fixtures/national-life/changed-layout.html`
- Create: `scripts/national-life-fixture-server.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `BrowserSession`, `NationalLifeCredentials`, `AdapterRunResult`.
- Produces: `NationalLifeAdapter.login()`, `NationalLifeAdapter.readCase()`.

- [ ] **Step 1: Create synthetic HTML fixtures**

Fixtures use invented values only:

```html
<main data-portal-page="case-detail">
  <span data-field="application-id">NLG-TEST-1001</span>
  <span data-field="case-status">Underwriting</span>
  <table aria-label="Requirements">
    <tr data-requirement-id="REQ-1">
      <td>Attending Physician Statement</td>
      <td>Outstanding</td>
      <td>2026-08-15</td>
    </tr>
  </table>
</main>
```

Provide fixture routes for login, MFA, search, detail and intentionally changed layout. The fixture server binds only to `127.0.0.1`.

- [ ] **Step 2: Write failing adapter tests**

Test:

```ts
it('authenticates and returns CONNECTED without exposing credentials')
it('returns MFA_REQUIRED without bypassing the challenge')
it('searches by external application id and normalizes a case observation')
it('rejects an unexpected application identifier')
it('returns a typed selector failure for the changed layout')
it('performs no POST, PUT, PATCH or DELETE after login')
```

For read-only enforcement, the fake browser records requests and allows credential login POST only; all subsequent non-GET/HEAD requests fail the test.

- [ ] **Step 3: Run and verify failure**

Run:

```bash
pnpm vitest run workers/national-life/adapter.test.ts
```

Expected: FAIL because `adapter.ts` does not exist.

- [ ] **Step 4: Implement deterministic adapter**

Export:

```ts
export class NationalLifeAdapter {
  constructor(private readonly session: BrowserSession, private readonly config: AdapterConfig)
  login(credentials: NationalLifeCredentials): Promise<AdapterRunResult>
  readCase(lookup: { kind: 'EXTERNAL_ID'; value: string }): Promise<NationalLifeCaseObservation>
}
```

Prefer `getByLabel`, `getByRole` and explicit carrier identifiers. Validate observations with Zod before returning. Never use visual coordinates, LLM recovery or inferred applicant data. Convert any selector/schema failure to a stable code such as `PORTAL_LAYOUT_CHANGED`.

- [ ] **Step 5: Add fixture command and run tests**

Add:

```json
"fixture:national-life": "tsx scripts/national-life-fixture-server.ts"
```

Run:

```bash
pnpm vitest run workers/national-life/adapter.test.ts
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add workers/national-life tests/national-life tests/fixtures/national-life scripts/national-life-fixture-server.ts package.json pnpm-lock.yaml
git commit -m "feat: add deterministic National Life read adapter"
```

---

### Task 7: Idempotent Observation Persistence

**Files:**
- Create: `lib/national-life/status-map.ts`
- Create: `lib/national-life/status-map.test.ts`
- Create: `lib/national-life/sync-service.ts`
- Create: `lib/national-life/sync-service.test.ts`

**Interfaces:**
- Consumes: `NationalLifeCaseObservation`.
- Produces: `mapApplicationStatus()`, `mapRequirementStatus()`, `applyCaseObservation()`.

- [ ] **Step 1: Write status mapping tests**

Cover exact normalized values:

```ts
expect(mapApplicationStatus('Underwriting')).toBe('UNDERWRITING')
expect(mapApplicationStatus('Issued')).toBe('ISSUED')
expect(mapApplicationStatus('Unknown Carrier Value')).toBe('STARTED')
expect(mapRequirementStatus('Outstanding')).toBe('OPEN')
expect(mapRequirementStatus('Received')).toBe('RECEIVED')
expect(mapRequirementStatus('Waived')).toBe('WAIVED')
```

Unknown values retain their original label in metadata and do not advance the case automatically.

- [ ] **Step 2: Write persistence tests**

With an injected repository, prove:

```ts
it('upserts application and requirements by NATIONAL_LIFE external id')
it('adds one timeline event for a newly observed carrier change')
it('adds no duplicate records or timeline events when replayed')
it('rejects an observation for a different external application id')
it('does not create a Policy when the observed status is Issued')
it('stores only filtered source payload fields')
```

- [ ] **Step 3: Run and verify failure**

Run:

```bash
pnpm vitest run lib/national-life/status-map.test.ts lib/national-life/sync-service.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement mappings**

Use explicit case-insensitive lookup tables. Return a result containing both normalized and original values:

```ts
export type MappedStatus<T extends string> = {
  normalized: T
  original: string
  recognized: boolean
}
```

- [ ] **Step 5: Implement transactional persistence**

Export:

```ts
export async function applyCaseObservation(input: {
  agentId: string
  caseId: string
  applicationId: string
  jobId: string
  observation: NationalLifeCaseObservation
}): Promise<{ changed: boolean; requirementChanges: number; communicationChanges: number }>
```

Inside one Prisma transaction:

1. lock/verify case ownership and application relationship;
2. verify existing external ID is absent or matches;
3. upsert `ExternalReference`;
4. update `Application` provider, external ID, normalized status and source timestamp;
5. upsert requirements by provider/external ID;
6. create timeline events only when a stable event key is new;
7. create/update a `SyncEvent` keyed by `NATIONAL_LIFE:<jobId>`;
8. never call `prisma.policy.create`.

Store filtered carrier labels and timestamps, not full page HTML.

- [ ] **Step 6: Run tests**

Run:

```bash
pnpm vitest run lib/national-life/status-map.test.ts lib/national-life/sync-service.test.ts
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/national-life/status-map.ts lib/national-life/status-map.test.ts lib/national-life/sync-service.ts lib/national-life/sync-service.test.ts
git commit -m "feat: synchronize National Life case observations"
```

---

### Task 8: Worker Orchestration and Safe Failure Handling

**Files:**
- Create: `lib/national-life/continuation-crypto.ts`
- Create: `lib/national-life/continuation-crypto.test.ts`
- Create: `workers/national-life/run-job.ts`
- Create: `workers/national-life/run-job.test.ts`
- Create: `workers/national-life/index.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: job, connection, crypto, Steel session, adapter and sync services.
- Produces: `runNationalLifeJob(jobId, deps?)`, executable `worker:national-life`.

- [ ] **Step 1: Write orchestration tests**

With all external boundaries injected, test:

```ts
it('decrypts only after claiming an authorized job')
it('closes the browser session after success')
it('closes the browser session after adapter failure')
it('moves an MFA response to WAITING_FOR_MFA')
it('encrypts the Steel continuation and disconnects without releasing the MFA session')
it('reconnects the same Steel session after owner resume')
it('releases an expired or cancelled MFA session')
it('marks rejected credentials CREDENTIALS_EXPIRED')
it('marks selector/schema drift MANUAL_REVIEW with redacted detail')
it('marks transient failures RETRYABLE with bounded availableAt')
it('applies a case observation before marking SUCCEEDED')
it('never includes the credential in job result or error')
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run workers/national-life/run-job.test.ts
```

Expected: FAIL because `run-job.ts` does not exist.

- [ ] **Step 3: Implement one-job orchestration**

Implement `continuation-crypto.ts` using the same AES-256-GCM key ring with distinct associated data `{ purpose: 'NATIONAL_LIFE_MFA', agentId, jobId, scopeId }`:

```ts
export type MfaContinuation = {
  steelSessionId: string
  debugUrl: string
  expiresAt: string
}

export function encryptMfaContinuation(
  value: MfaContinuation,
  context: { agentId: string; jobId: string; scopeId: string },
  activeKey: { version: string; base64Key: string },
): EncryptedSecret

export function decryptMfaContinuation(
  value: EncryptedSecret,
  context: { agentId: string; jobId: string; scopeId: string },
  keys: Record<string, string>,
): MfaContinuation
```

Add round-trip, wrong-agent, wrong-job and expired-continuation tests.

`runNationalLifeJob()` must use:

```ts
let session: BrowserSession | undefined
let preserveForMfa = false
try {
  // load owning credential, decrypt, create session, run adapter, persist
} finally {
  if (preserveForMfa) await session?.disconnect()
  else await session?.close()
}
```

On `MFA_REQUIRED`, encrypt `{ steelSessionId, debugUrl, expiresAt }`, persist the four encrypted continuation fields, set a five-minute expiry and move to `WAITING_FOR_MFA`. On a resumed job, decrypt the continuation and reconnect instead of logging in again. Clear continuation fields before every terminal transition. Clear credential references before persistence and classify only known errors. Unknown errors become `FAILED` with code `UNEXPECTED_WORKER_FAILURE` and a redacted diagnostic.

- [ ] **Step 4: Implement bounded polling**

`index.ts`:

- creates a unique worker ID;
- releases expired leases on startup;
- scans expired/cancelled encrypted MFA continuations, releases their Steel sessions and then clears continuation fields;
- claims one job at a time;
- waits with a maximum 2-second poll interval;
- handles `SIGTERM`/`SIGINT`;
- stops claiming new work during shutdown;
- never prints job input or secret-bearing objects.

Add:

```json
"worker:national-life": "tsx workers/national-life/index.ts"
```

- [ ] **Step 5: Run tests and a fixture worker smoke**

Run terminal A:

```bash
pnpm fixture:national-life
```

Run terminal B with test-only environment values and a seeded synthetic job:

```bash
pnpm worker:national-life
```

Expected: the synthetic job reaches `SUCCEEDED`, the Steel session is released and no fixture credential appears in output.

- [ ] **Step 6: Run global gates**

Run:

```bash
pnpm test
pnpm lint
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add workers/national-life package.json pnpm-lock.yaml
git commit -m "feat: run National Life browser sync jobs"
```

---

### Task 9: Manual Case Sync and Operational Status UI

**Files:**
- Modify: `app/agent/cases/[id]/actions.ts`
- Modify: `app/agent/cases/[id]/page.tsx`
- Modify: `app/agent/cases/[id]/CaseWorkspace.tsx`
- Create: `app/agent/integrations/national-life/mfa/[jobId]/page.tsx`
- Create: `app/agent/integrations/national-life/mfa/[jobId]/actions.ts`
- Create: `lib/national-life/sync-access.ts`
- Create: `lib/national-life/sync-access.test.ts`

**Interfaces:**
- Consumes: `enqueueCaseReadSync()`, existing `canAccessCase()`.
- Produces: `requestNationalLifeSync(caseId)`.
- Produces serialized `nationalLifeSync` status in `CaseData`.

- [ ] **Step 1: Write authorization and eligibility tests**

Test:

```ts
it('allows the assigned agent to sync a National Life life case')
it('allows an upline only when the existing scope includes the assigned agent')
it('rejects another organization or out-of-scope agent')
it('rejects non-National-Life cases')
it('rejects non-life/annuity cases')
it('rejects a case without an application or external lookup id')
it('rejects an agent without a healthy saved connection')
it('allows only the owning agent to open or resume an MFA job')
it('rejects an expired MFA continuation')
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
pnpm vitest run lib/national-life/sync-access.test.ts
```

Expected: FAIL because `sync-access.ts` does not exist.

- [ ] **Step 3: Implement eligibility and server action**

Export:

```ts
export function canRequestNationalLifeSync(input: {
  canAccessCase: boolean
  carrier: string | null
  productType: string | null
  hasApplication: boolean
  hasLookupId: boolean
  connectionStatus: string | null
}): { allowed: true } | { allowed: false; reason: string }
```

`requestNationalLifeSync(caseId)` derives the current agent, scope, case, application and credential status server-side, then enqueues. It returns `{ ok, message }` and revalidates the case route.

- [ ] **Step 4: Add case sync UI**

Serialize:

```ts
nationalLifeSync: {
  eligible: boolean
  reason: string | null
  state: BrowserJobState | null
  lastRequestedAt: string | null
  lastSucceededAt: string | null
}
```

In the application section, show:

- **Sincronizar National Life**;
- current state translated to Portuguese;
- last success;
- link to connection setup when credentials are absent/expired;
- no generic URL or selector input.

Disable the button while `QUEUED`, `RUNNING` or `WAITING_FOR_MFA`.

- [ ] **Step 5: Add the owner-only MFA handoff**

The MFA page loads the current agent and a job constrained by `{ id: jobId, agentId: currentAgent.id, state: 'WAITING_FOR_MFA' }`. It decrypts the continuation server-side and renders Steel's `debugUrl` in an iframe with `interactive=true` and `showControls=false`; the URL is never stored in React state, logs or analytics. Send `Referrer-Policy: no-referrer` and a page-specific CSP whose `frame-src` contains only the configured Steel origin.

Provide:

```ts
export async function resumeNationalLifeMfa(jobId: string): Promise<ActionResult>
export async function cancelNationalLifeMfa(jobId: string): Promise<ActionResult>
```

Both actions re-check exact ownership and state. Resume changes `WAITING_FOR_MFA -> QUEUED`, preserves encrypted continuation for the worker and sets `availableAt=now`. Cancel changes to `CANCELLED`, asks the worker cleanup path to release the Steel session, and clears the continuation only after release. Expired continuation displays **Sessão expirada** and enqueues no work.

- [ ] **Step 6: Run tests and static gates**

Run:

```bash
pnpm vitest run lib/national-life/sync-access.test.ts
pnpm test
pnpm lint
pnpm build
```

Expected: all commands PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/national-life/sync-access.ts lib/national-life/sync-access.test.ts app/agent/cases app/agent/integrations/national-life/mfa
git commit -m "feat: add manual National Life case sync"
```

---

### Task 10: Security Regression Suite and Operations Runbook

**Files:**
- Create: `lib/national-life/security-boundaries.test.ts`
- Create: `docs/operations/national-life-read-sync.md`
- Modify: `.gitignore`
- Modify: `README.md`

**Interfaces:**
- Consumes: all Phase 1 interfaces.
- Produces: deployment contract and assisted real-portal validation checklist.

- [ ] **Step 1: Add cross-boundary security tests**

Create tests that inspect representative serialized action responses, job records and diagnostics:

```ts
it('contains no credential fields in a queued job')
it('contains no plaintext or ciphertext in connection summaries')
it('redacts cookie and authorization values from diagnostics')
it('rejects a redirect from an allowed host to an unlisted origin')
it('performs no carrier write operation in SYNC_CASE_READ')
it('does not create a policy from any Phase 1 observation')
```

- [ ] **Step 2: Run the security suite and verify behavior**

Run:

```bash
pnpm vitest run lib/national-life/security-boundaries.test.ts
```

Expected: all tests PASS. If any test fails, fix the owning task's implementation before continuing.

- [ ] **Step 3: Write the operations runbook**

Document exact setup and checks:

- generate a 32-byte key with `openssl rand -base64 32`;
- configure `NATIONAL_LIFE_CREDENTIAL_KEY_VERSION`, `NATIONAL_LIFE_CREDENTIAL_KEYS`, `NATIONAL_LIFE_PORTAL_ORIGINS`, `NATIONAL_LIFE_PORTAL_LOGIN_URL`, `STEEL_BASE_URL` and optional `STEEL_API_KEY`;
- deploy Steel on a private network and do not expose its debugger publicly;
- run migration and worker as a separate process;
- verify health without printing environment values;
- rotate credential keys by adding a version, making it active, re-encrypting records and only then removing the old version;
- revoke a connection and confirm the session/job cleanup boundary;
- rollback by disabling the worker and UI without deleting audit records.

Add the assisted real-portal checklist:

1. confirm written authorization and portal terms;
2. use an authorized agent account and known permitted life case;
3. save and test the connection;
4. complete MFA manually;
5. trigger one read sync;
6. compare status and requirements with the portal;
7. repeat and verify no duplicates;
8. inspect sanitized logs and session cleanup;
9. verify no write request occurred.

- [ ] **Step 4: Ignore local brainstorming artifacts**

Add only:

```gitignore
.superpowers/
```

Do not add or modify the unrelated `Jenkinsfile`.

- [ ] **Step 5: Update README commands**

Document:

```bash
pnpm fixture:national-life
pnpm worker:national-life
```

Link to the operations runbook and state clearly that the integration is read-only until a later approved implementation phase.

- [ ] **Step 6: Run complete verification**

Run:

```bash
pnpm prisma validate
pnpm test
pnpm lint
pnpm build
git diff --check
git status --short
```

Expected:

- every command PASS;
- `.superpowers/` absent from status;
- `Jenkinsfile` remains untouched/untracked;
- only intended Phase 1 files appear in the implementation diff.

- [ ] **Step 7: Perform the assisted real-portal smoke**

Follow `docs/operations/national-life-read-sync.md`. Record only:

- job ID;
- adapter version;
- safe result code;
- normalized status/requirement counts;
- confirmation that repeat sync created no duplicates;
- confirmation that the browser session was destroyed.

Do not record credentials, applicant identifiers, screenshots containing personal data or raw portal payloads in Git.

- [ ] **Step 8: Commit**

```bash
git add .gitignore README.md docs/operations/national-life-read-sync.md lib/national-life/security-boundaries.test.ts
git commit -m "docs: operationalize National Life read sync"
```

---

## Completion Gate

Phase 1 is complete only after all automated gates pass and the assisted real-portal smoke verifies:

- agent-owned credentials are encrypted and never returned;
- MFA can pause for human action;
- one permitted National Life life case is found;
- status and requirements match the portal;
- a repeated sync is idempotent;
- cross-agent access is denied;
- browser state is destroyed;
- no carrier write or Fyntra policy creation occurs.

Do not begin application-writing or submission work under this plan. Those capabilities require a separate approved implementation plan built on the verified read-only adapter.
