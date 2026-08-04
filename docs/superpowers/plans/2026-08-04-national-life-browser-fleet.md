# National Life Browser Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral, capacity-controlled browser fleet for National Life login/MFA and read-only Foresight sync, validate it in isolation up to a 100-session projection, and migrate to dedicated private browser servers only after the test is approved.

**Architecture:** The web app remains responsible for agent authorization, durable PostgreSQL state and the authenticated viewer broker. A durable coordinator allocates each agent-owned attempt to a private browser shard through a capacity interface, while a session controller keeps the interactive browser connection alive and bounds reconnects. Steel remains the current adapter and Browserless self-hosted is the first candidate adapter; National Life and Foresight code consume neither vendor directly.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Redis-compatible queue/capacity store, Playwright, Puppeteer/Browserless candidate adapter, self-hosted Chromium browser shards, Vitest, Docker Compose, Coolify only for the isolated test deployment.

## Global Constraints

- Owner credentials and MFA values are entered only in the official National Life/Auth0 page inside private self-hosted browser infrastructure.
- No raw password, MFA value, cookie, token, portal payload, vendor websocket, API key or debug URL reaches the browser client, audit payload or ordinary job result.
- Each agent receives an isolated browser session and profile; no session, storage or in-memory token is shared across agents.
- The Foresight path remains read-only and does not create applications, illustrations, policies or submissions.
- Rapid Solve is not part of the login or Foresight sync path.
- Steel/CDP/browser provider endpoints remain private; only the authenticated viewer broker is public.
- No 100-session load test runs against the shared production `btapps` host.
- Every retry has a bounded delay and terminal outcome; no interactive attempt may busy-loop at one-second cadence.
- Production rollout is disabled until the synthetic test, privacy test and one real owner-controlled pilot pass.

## File Map

- Modify `lib/national-life/env.ts`, `lib/national-life/env.test.ts`, `lib/national-life/constants.ts` — provider, shard, capacity and retry configuration.
- Modify `prisma/schema.prisma` and create a migration — durable attempt scheduling, shard assignment and transport observations.
- Create `workers/national-life/browser-provider.ts` and `.test.ts` — vendor-neutral browser/session interfaces.
- Create `workers/national-life/steel-browser-provider.ts` and `.test.ts` — current Steel implementation behind the interface.
- Create `workers/national-life/browser-provider-factory.ts` and `.test.ts` — exact provider selection and fail-closed configuration.
- Create `workers/national-life/browser-capacity.ts` and `.test.ts` — shard admission, release and heartbeat contract.
- Create `workers/national-life/session-controller.ts` and `.test.ts` — one live interactive controller per attempt with bounded reattach behavior.
- Modify `workers/national-life/run-connection-attempt.ts` and `.test.ts` — use controller state, schedule backoff and terminalize dead sessions safely.
- Modify `workers/national-life/runtime.ts` and `.test.ts` — claim only due attempts, separate interactive capacity from sync jobs, and shut down controllers safely.
- Modify `lib/national-life/connection-attempt-state.ts`, `lib/national-life/interactive-connection-service.ts` and related UI status tests — expose queued/backoff states without leaking internals.
- Modify `app/agent/integrations/national-life/useNationalLifeConnectionAttempt.ts` and `NationalLifeBrowserModal.tsx` — show queue, reconnecting and bounded failure actions.
- Modify `deploy/national-life-runtime.compose.yaml`, `.env.example`, compose tests and Dockerfile tests — exact MFA/Auth0 origins, provider settings and isolated test wiring.
- Create `deploy/national-life-browserless.compose.yaml` — candidate self-hosted Browserless test service; never use this file for the current production host.
- Create `workers/national-life/browser-fleet-fixture.test.ts` and `scripts/national-life-browser-fleet-load.ts` — synthetic login/MFA, failure injection and measured concurrency.
- Create `docs/operations/national-life-browser-fleet-rollout.md` — test evidence, approval gate, dedicated-server rollout and rollback runbook.

---

### Task 1: Close the portal-origin and capacity configuration boundary

**Files:**
- Modify: `lib/national-life/env.ts`
- Test: `lib/national-life/env.test.ts`
- Modify: `lib/national-life/constants.ts`
- Modify: `.env.example`
- Modify: `deploy/national-life-runtime.compose.yaml`
- Test: `deploy/national-life-runtime.compose.test.ts`

**Interfaces:**
- Produces `NationalLifeEnv.browserProvider`, `browserShardId`, `maxInteractiveSessions`, `maxSessionsPerShard`, `interactiveReconnectBaseDelayMs`, `interactiveReconnectMaxDelayMs`.
- Accepts only `steel` or `browserless` as provider values and rejects zero/negative capacities, invalid delays and wildcard portal origins.

- [ ] **Step 1: Extend the environment tests first.** Add cases proving that `NATIONAL_LIFE_BROWSER_PROVIDER=steel|browserless` parses, capacities are positive, maximum sessions are not below per-shard capacity, retry delays are ordered, and the exact origins include `https://nlg-prod.us.auth0.com` and `https://mfa.nationallife.com`.

- [ ] **Step 2: Run the focused tests to verify the new contract fails.**

Run: `pnpm exec vitest run lib/national-life/env.test.ts deploy/national-life-runtime.compose.test.ts`

Expected: FAIL because the new fields and exact compose origins are absent.

- [ ] **Step 3: Implement the smallest parser/configuration change.** Add the provider and numeric parsers using the existing fail-closed environment style. Set test-safe defaults only for non-secret local configuration; require production capacities explicitly. Add the two observed MFA/Auth0 origins without adding wildcard hosts.

- [ ] **Step 4: Run the focused tests and typecheck.**

Run: `pnpm exec vitest run lib/national-life/env.test.ts deploy/national-life-runtime.compose.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit the configuration boundary.**

```bash
git add lib/national-life/env.ts lib/national-life/env.test.ts lib/national-life/constants.ts .env.example deploy/national-life-runtime.compose.yaml deploy/national-life-runtime.compose.test.ts
git commit -m "feat: configure National Life browser capacity"
```

### Task 2: Add durable attempt scheduling and shard assignment

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260804150000_add_national_life_browser_scheduling/migration.sql`
- Modify: `workers/national-life/runtime.ts`
- Test: `workers/national-life/runtime.test.ts`
- Modify: `workers/national-life/run-connection-attempt.ts`
- Test: `workers/national-life/run-connection-attempt.test.ts`

**Interfaces:**
- Adds `nextPollAt DateTime?`, `reconnectAttemptCount Int @default(0)`, `browserProvider String?`, `browserShardId String?`, and `lastTransportFailureAt DateTime?` to `NationalLifeConnectionAttempt`.
- Adds store operations `scheduleInteractiveRetry(input)` and `assignBrowserShard(input)` with ownership/state predicates.

- [ ] **Step 1: Write failing store/runner tests.** Prove that a transport failure schedules the next attempt in the future, increments the retry count, preserves `AWAITING_LOGIN`/`AWAITING_MFA`, and that the runtime claim excludes attempts whose `nextPollAt` is in the future. Prove that a retry count over the configured budget transitions to `FAILED` with `STEEL_RECONNECT_FAILED` rather than looping forever.

- [ ] **Step 2: Run the focused tests to verify RED.**

Run: `pnpm exec vitest run workers/national-life/runtime.test.ts workers/national-life/run-connection-attempt.test.ts`

Expected: FAIL because the scheduling fields and store methods do not exist.

- [ ] **Step 3: Add the migration and guarded store updates.** Use `updateMany` predicates that include attempt ID, deployment scope, provider, purpose, current state and lease owner. Set `nextPollAt` to `now + min(base * 2^retryCount, maxDelay)` and clear the lease so another runtime replica can claim it only when due.

- [ ] **Step 4: Change the runtime claim query to honor due time.** Keep one in-flight attempt per loop, preserve independent job processing, and do not release an active browser session merely because a poll is not due.

- [ ] **Step 5: Run focused tests and migration validation.**

Run: `pnpm exec vitest run workers/national-life/runtime.test.ts workers/national-life/run-connection-attempt.test.ts && pnpm exec prisma validate && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the durable scheduling boundary.**

```bash
git add prisma/schema.prisma prisma/migrations workers/national-life/runtime.ts workers/national-life/runtime.test.ts workers/national-life/run-connection-attempt.ts workers/national-life/run-connection-attempt.test.ts
git commit -m "feat: bound National Life interactive retries"
```

### Task 3: Introduce the provider-neutral browser contract

**Files:**
- Create: `workers/national-life/browser-provider.ts`
- Test: `workers/national-life/browser-provider.test.ts`
- Create: `workers/national-life/steel-browser-provider.ts`
- Test: `workers/national-life/steel-browser-provider.test.ts`
- Create: `workers/national-life/browser-provider-factory.ts`
- Test: `workers/national-life/browser-provider-factory.test.ts`
- Modify: `workers/national-life/steel-session.ts`

**Interfaces:**
- `InteractiveBrowserProvider.create(input): Promise<InteractiveBrowserHandle>`
- `InteractiveBrowserProvider.attach(handle): Promise<ManagedInteractiveBrowser>`
- `InteractiveBrowserProvider.health(): Promise<BrowserProviderHealth>`
- `InteractiveBrowserProvider.release(handle): Promise<void>`
- `ManagedInteractiveBrowser` exposes `page`, `context`, `browserSessionId`, `viewerTarget`, `disconnect`, and `release` without exposing vendor SDK types to the adapter.

- [ ] **Step 1: Write contract tests with a fake provider.** Prove that the contract can create, attach, disconnect without release, release exactly once, report health and reject a handle owned by a different deployment scope.

- [ ] **Step 2: Run the contract tests to verify RED.**

Run: `pnpm exec vitest run workers/national-life/browser-provider.test.ts workers/national-life/steel-browser-provider.test.ts workers/national-life/browser-provider-factory.test.ts`

Expected: FAIL because the provider modules do not exist.

- [ ] **Step 3: Wrap the current Steel lifecycle without changing adapter behavior.** Move the existing Steel create/attach/release mechanics behind the new contract. Preserve the navigation guard, headful 1600x1000 profile, no recording patches and the local-only disconnect semantics.

- [ ] **Step 4: Make provider selection fail closed.** `browser-provider-factory.ts` must return only the configured provider and reject an unknown provider at startup; it must never silently fall back from Browserless to Steel in production.

- [ ] **Step 5: Run provider tests and the existing Steel suite.**

Run: `pnpm exec vitest run workers/national-life/browser-provider.test.ts workers/national-life/steel-browser-provider.test.ts workers/national-life/browser-provider-factory.test.ts workers/national-life/steel-session.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the provider boundary.**

```bash
git add workers/national-life/browser-provider.ts workers/national-life/browser-provider.test.ts workers/national-life/steel-browser-provider.ts workers/national-life/steel-browser-provider.test.ts workers/national-life/browser-provider-factory.ts workers/national-life/browser-provider-factory.test.ts workers/national-life/steel-session.ts
git commit -m "refactor: isolate National Life browser provider"
```

### Task 4: Add shard admission and independent capacity

**Files:**
- Create: `workers/national-life/browser-capacity.ts`
- Test: `workers/national-life/browser-capacity.test.ts`
- Modify: `workers/national-life/runtime.ts`
- Test: `workers/national-life/runtime.test.ts`
- Modify: `lib/national-life/env.ts`

**Interfaces:**
- `BrowserCapacity.reserve(input): Promise<{ granted: boolean; shardId: string | null }>`
- `BrowserCapacity.heartbeat(input): Promise<boolean>`
- `BrowserCapacity.release(input): Promise<void>`
- `BrowserCapacity.health(): Promise<BrowserCapacitySnapshot>`

- [ ] **Step 1: Write failing capacity tests.** Cover fair shard selection, per-shard cap, global cap, lease expiry, release after failure and no allocation when the provider health check is false.

- [ ] **Step 2: Run the capacity tests to verify RED.**

Run: `pnpm exec vitest run workers/national-life/browser-capacity.test.ts`

Expected: FAIL because the capacity module does not exist.

- [ ] **Step 3: Implement the Redis-backed capacity contract.** Store reservations with attempt ID, agent ID, provider, shard ID and expiry. Use an atomic Lua script or transaction so two runtime replicas cannot reserve the same slot. Do not store credentials or browser content in Redis.

- [ ] **Step 4: Wire admission before browser creation.** Attempts that cannot reserve a slot remain queued with no Steel/Browserless session. Release reservations in every terminal path and renew them during interactive heartbeats.

- [ ] **Step 5: Run capacity/runtime tests.**

Run: `pnpm exec vitest run workers/national-life/browser-capacity.test.ts workers/national-life/runtime.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit admission control.**

```bash
git add workers/national-life/browser-capacity.ts workers/national-life/browser-capacity.test.ts workers/national-life/runtime.ts workers/national-life/runtime.test.ts lib/national-life/env.ts
git commit -m "feat: add National Life browser admission control"
```

### Task 5: Keep the interactive connection alive through a session controller

**Files:**
- Create: `workers/national-life/session-controller.ts`
- Test: `workers/national-life/session-controller.test.ts`
- Modify: `workers/national-life/run-connection-attempt.ts`
- Test: `workers/national-life/run-connection-attempt.test.ts`
- Modify: `workers/national-life/runtime.ts`
- Test: `workers/national-life/runtime.test.ts`

**Interfaces:**
- `InteractiveSessionController.start(attempt): Promise<void>`
- `InteractiveSessionController.observe(attempt): Promise<InteractiveObservation>`
- `InteractiveSessionController.stop(attemptId, reason): Promise<void>`
- `InteractiveSessionController.shutdown(): Promise<void>`

- [ ] **Step 1: Write failing controller tests.** Prove that one controller is reused for repeated observations, the browser connection is not disconnected after every poll, a transient transport error schedules backoff, a dead browser becomes terminal after the retry budget, and shutdown releases only sessions owned by that controller.

- [ ] **Step 2: Run tests to verify RED.**

Run: `pnpm exec vitest run workers/national-life/session-controller.test.ts workers/national-life/run-connection-attempt.test.ts`

Expected: FAIL because the controller does not exist and the runner still disconnects after every observation.

- [ ] **Step 3: Implement the in-process controller with durable handles.** Keep the live `ManagedInteractiveBrowser` in a map keyed by attempt ID within the assigned shard worker. Persist the provider handle and shard in PostgreSQL so a replacement worker can reattach using the bounded retry schedule. Never store the Playwright object itself in the database.

- [ ] **Step 4: Change the attempt runner to observe through the controller.** `OPENING_PORTAL` starts the controller, `AWAITING_LOGIN`/`AWAITING_MFA` observes it, authenticated completion hands off the live session to the job/session layer, and terminal/cancel/expiry calls `stop`.

- [ ] **Step 5: Run focused connection/runtime tests.**

Run: `pnpm exec vitest run workers/national-life/session-controller.test.ts workers/national-life/run-connection-attempt.test.ts workers/national-life/runtime.test.ts`

Expected: PASS with no one-second reconnect loop.

- [ ] **Step 6: Commit session ownership changes.**

```bash
git add workers/national-life/session-controller.ts workers/national-life/session-controller.test.ts workers/national-life/run-connection-attempt.ts workers/national-life/run-connection-attempt.test.ts workers/national-life/runtime.ts workers/national-life/runtime.test.ts
git commit -m "feat: keep National Life interactive sessions controlled"
```

### Task 6: Expose queued and reconnecting states to agents

**Files:**
- Modify: `lib/national-life/connection-attempt-state.ts`
- Modify: `lib/national-life/interactive-connection-service.ts`
- Test: `lib/national-life/interactive-connection-service.test.ts`
- Modify: `app/agent/integrations/national-life/useNationalLifeConnectionAttempt.ts`
- Modify: `app/agent/integrations/national-life/NationalLifeBrowserModal.tsx`
- Test: `app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx`

**Interfaces:**
- Add `WAITING_FOR_BROWSER` and `RECONNECTING` as non-terminal states with safe labels.
- Preserve `AWAITING_LOGIN` and `AWAITING_MFA` as the only viewer states.

- [ ] **Step 1: Add failing UI/service tests.** Prove that queued attempts do not request a viewer bootstrap, reconnecting attempts retain the explanatory status and cancel action, and terminal failure offers a fresh connection without hiding the reason.

- [ ] **Step 2: Run focused tests to verify RED.**

Run: `pnpm exec vitest run lib/national-life/interactive-connection-service.test.ts app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx`

Expected: FAIL because the new states and labels are absent.

- [ ] **Step 3: Implement state labels and polling behavior.** Poll at a modest status interval, stop issuing bootstrap requests outside viewer states, and keep the official viewer open while the user is in MFA. Display queue position only if it is safe and derived from server state; never display shard IDs or vendor errors.

- [ ] **Step 4: Run UI/service tests and lint.**

Run: `pnpm exec vitest run lib/national-life/interactive-connection-service.test.ts app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx && pnpm exec eslint app/agent/integrations/national-life/useNationalLifeConnectionAttempt.ts app/agent/integrations/national-life/NationalLifeBrowserModal.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the user-visible capacity states.**

```bash
git add lib/national-life/connection-attempt-state.ts lib/national-life/interactive-connection-service.ts lib/national-life/interactive-connection-service.test.ts app/agent/integrations/national-life/useNationalLifeConnectionAttempt.ts app/agent/integrations/national-life/NationalLifeBrowserModal.tsx app/agent/integrations/national-life/NationalLifeBrowserModal.test.tsx
git commit -m "feat: show National Life browser queue states"
```

### Task 7: Add the Browserless candidate adapter and isolated compose service

**Files:**
- Create: `workers/national-life/browserless-provider.ts`
- Test: `workers/national-life/browserless-provider.test.ts`
- Create: `deploy/national-life-browserless.compose.yaml`
- Test: `deploy/national-life-browserless.compose.test.ts`
- Modify: `Dockerfile.national-life-runtime`
- Modify: `.env.example`

**Interfaces:**
- Implements the exact `InteractiveBrowserProvider` contract from Task 3.
- Uses only private endpoint configuration and returns a broker-safe viewer target; no Browserless API token leaves the runtime.

- [ ] **Step 1: Write adapter tests against a fake Browserless HTTP/WebSocket API.** Cover create, attach, viewer target, explicit reconnect/persist behavior, release, provider health and provider errors without exposing credentials.

- [ ] **Step 2: Run adapter tests to verify RED.**

Run: `pnpm exec vitest run workers/national-life/browserless-provider.test.ts deploy/national-life-browserless.compose.test.ts`

Expected: FAIL because the candidate adapter and compose contract do not exist.

- [ ] **Step 3: Implement the adapter using the candidate’s private session API.** Use the supported persistence/reconnect mode for the selected client library. If the selected mode requires Puppeteer, keep that dependency inside the provider adapter and return the application’s provider-neutral managed browser interface; do not convert the National Life adapter in this task.

- [ ] **Step 4: Add an isolated compose file.** Pin the candidate image, keep it on a private network, set explicit memory/pid/shm limits, expose no public CDP port and require a separate test environment file. Do not add this service to the current production compose until the test gate passes.

- [ ] **Step 5: Run adapter, compose and type tests.**

Run: `pnpm exec vitest run workers/national-life/browserless-provider.test.ts deploy/national-life-browserless.compose.test.ts && pnpm exec tsc --noEmit`

Expected: PASS.

- [ ] **Step 6: Commit the candidate backend.**

```bash
git add workers/national-life/browserless-provider.ts workers/national-life/browserless-provider.test.ts deploy/national-life-browserless.compose.yaml deploy/national-life-browserless.compose.test.ts Dockerfile.national-life-runtime .env.example
git commit -m "feat: add isolated Browserless candidate"
```

### Task 8: Build the synthetic fleet fixture and load harness

**Files:**
- Modify: `scripts/national-life-fixture-server.ts`
- Test: `workers/national-life/browser-fleet-fixture.test.ts`
- Create: `scripts/national-life-browser-fleet-load.ts`
- Create: `docs/operations/national-life-browser-fleet-rollout.md`

**Interfaces:**
- Fixture routes model portal login, MFA redirect, allowed/blocked origins, delayed navigation, authenticated Foresight landing and browser failure injection.
- Load harness accepts `--sessions`, `--duration-seconds`, `--provider`, `--failure-rate` and writes only aggregate metrics: success, terminal failure, queue delay, attach latency, RSS, CPU, pids and reconnect count.

- [ ] **Step 1: Write fixture tests for the full synthetic flow.** Prove isolated credentials markers never cross sessions, MFA transitions are recognized, blocked origins are logged only as origins, and a browser kill affects only one attempt.

- [ ] **Step 2: Run fixture tests to verify RED.**

Run: `pnpm exec vitest run workers/national-life/browser-fleet-fixture.test.ts`

Expected: FAIL because the fixture scenarios and harness do not exist.

- [ ] **Step 3: Implement the fixture and aggregate-only harness.** Use deterministic synthetic data and never place real credentials, cookies, tokens or portal customer data in output. Measure one, five and ten active sessions first.

- [ ] **Step 4: Run the isolated test ladder.**

```bash
pnpm exec vitest run workers/national-life/browser-fleet-fixture.test.ts
pnpm exec tsx scripts/national-life-browser-fleet-load.ts --sessions 1 --duration-seconds 60 --provider browserless
pnpm exec tsx scripts/national-life-browser-fleet-load.ts --sessions 5 --duration-seconds 300 --provider browserless
pnpm exec tsx scripts/national-life-browser-fleet-load.ts --sessions 10 --duration-seconds 1800 --provider browserless --failure-rate 0.1
```

Expected: no provider/coordinator crash, no cross-session access, bounded retries, complete cleanup and aggregate metrics sufficient to project 25/50/100 sessions with 30% headroom.

- [ ] **Step 5: Record the evidence and commit the harness.**

```bash
git add scripts/national-life-fixture-server.ts workers/national-life/browser-fleet-fixture.test.ts scripts/national-life-browser-fleet-load.ts docs/operations/national-life-browser-fleet-rollout.md
git commit -m "test: measure National Life browser fleet capacity"
```

### Task 9: Run the real owner-controlled pilot and approval gate

**Files:**
- Modify: `docs/operations/national-life-browser-fleet-rollout.md`
- Test/evidence: isolated deployment logs, database aggregate state, provider health and viewer checks

- [ ] **Step 1: Deploy only the candidate provider to the isolated host.** Use a separate environment file and feature flag. Confirm migrations, private networking, runtime health, queue health and browser provider health before creating an attempt.

- [ ] **Step 2: Run one real owner-controlled pilot.** The owner enters credentials and MFA in the official viewer. Validate login classification, encrypted context persistence, one read-only Foresight inventory and clean session handoff. Do not run concurrent real-owner tests.

- [ ] **Step 3: Verify privacy and cleanup.** Search only aggregate logs/metadata for forbidden password/MFA markers, confirm no browser recording/replay artifact, confirm viewer access is revoked on terminal state and confirm the browser provider releases only the pilot session.

- [ ] **Step 4: Present the capacity result for approval.** Include measured resource use, projected shard count for 25/50/100, queue behavior, failure rate, reconnect rate and remaining risks. Do not enable the 100-session cap without explicit approval.

- [ ] **Step 5: Commit the completed rollout evidence.**

```bash
git add docs/operations/national-life-browser-fleet-rollout.md
git commit -m "docs: record National Life browser fleet pilot"
```

### Task 10: Migrate to dedicated private servers after approval

**Files:**
- Modify: `deploy/national-life-runtime.compose.yaml`
- Create/modify: dedicated browser shard deployment manifests
- Modify: `docs/operations/national-life-browser-fleet-rollout.md`

- [ ] **Step 1: Provision separate private browser nodes.** Use at least two independent shards, private networking, no public CDP ingress, encrypted disks, centralized metrics and separate deploy credentials. Size nodes from Task 8 measurements, not generic estimates.

- [ ] **Step 2: Deploy the coordinator and browser fleet with a hard global cap.** Start below the measured limit, verify shard health and confirm that sync workers cannot consume interactive slots.

- [ ] **Step 3: Canary the rollout.** Enable one agent, then five, then twenty-five. Observe queue latency, browser RSS, pids, CDP errors, provider restarts and successful Foresight syncs.

- [ ] **Step 4: Expand to 100 only after the recorded gates remain green.** Keep a rollback flag that disables new attempts and drains active sessions without deleting encrypted context prematurely.

- [ ] **Step 5: Verify production and document final capacity.** Confirm database backups/PITR, Redis durability, viewer authorization, shard isolation, alerting and the final approved concurrency cap.

---

## Final verification commands

```bash
pnpm exec vitest run workers/national-life lib/national-life deploy app/agent/integrations/national-life
pnpm exec tsc --noEmit
pnpm exec eslint workers/national-life lib/national-life app/agent/integrations/national-life deploy
git diff --check
```

Production evidence must separately report source commit, migration status, container health, provider health, test metrics and real pilot result. A passing build or push is not evidence that 100 live browsers are supported.
