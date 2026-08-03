# National Life Automatic Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Após um login bem-sucedido, atualizar automaticamente as nove grades de leitura da National Life com uma execução retomável e progresso real na UI.

**Architecture:** Um `NationalLifeSyncRun` agrupa nove `BrowserAutomationJob` de operação `SYNC_NATIONAL_LIFE_GRID`. O serviço de run cria as etapas dentro da mesma transação do login, o claim do worker libera somente a próxima etapa do run, e o status é derivado dos jobs persistidos. O runner de grade será compartilhado pelo worker e pelo script existente.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, TypeScript, Vitest, Testing Library, Tailwind.

## Global Constraints

- O sync automático é somente leitura e usa apenas as nove grades validadas: `NEW_BUSINESS`, `RECENTLY_CLOSED`, `INFORCE_CLIENTS`, `PAID_COMMISSIONS`, `PROJECTED_COMMISSIONS`, `CLIENT_INTELLIGENCE`, `CORRESPONDENCE`, `COMMISSIONS_PAYMENT_PORTAL`, `PIP_PENDING`.
- O login é interativo; nenhuma senha, cookie ou token é recebido pela API do cliente ou armazenado pelo produto.
- Cada query e mutação de run/job deve filtrar `agentId` e `deploymentScope` quando esses campos existirem.
- Uma única sessão de browser continua protegida por `runExclusively`; as etapas nunca rodam em paralelo.
- A barra usa percentual por etapas, nunca por linhas, e não inventa tempo total.
- O cliente consulta o status somente enquanto o run está `QUEUED`, `RUNNING` ou `PAUSED`.
- Mensagens visíveis não podem expor Auth0, códigos internos, cookies, IDs de sessão ou credenciais.
- Toda implementação deve seguir RED-GREEN-REFACTOR: teste falhando observado antes do código de produção.

---

### Task 1: Persistir runs, etapas e o contrato de progresso

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260803140000_add_national_life_sync_runs/migration.sql`
- Create: `lib/national-life/sync-progress.ts`
- Test: `lib/national-life/sync-progress.test.ts`

**Interfaces:**
- Produces `NationalLifeSyncRunState`, `NationalLifeSyncStage`, `NATIONAL_LIFE_SYNC_STAGES`, `syncProgressFromJobs()` and `syncRunStateFromJobs()`.
- The Prisma relation is `BrowserAutomationJob.syncRunId`, `syncStageIndex`, `syncGridKey`, and `NationalLifeSyncRun.jobs`.

- [ ] **Step 1: Write the failing progress tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  NATIONAL_LIFE_SYNC_STAGES,
  syncProgressFromJobs,
  syncRunStateFromJobs,
} from './sync-progress'

describe('National Life sync progress', () => {
  it('has the nine fixed stages in the execution order', () => {
    expect(NATIONAL_LIFE_SYNC_STAGES).toHaveLength(9)
    expect(NATIONAL_LIFE_SYNC_STAGES[0]).toBe('NEW_BUSINESS')
    expect(NATIONAL_LIFE_SYNC_STAGES.at(-1)).toBe('PIP_PENDING')
  })

  it('counts completed stages instead of rows', () => {
    expect(syncProgressFromJobs([
      { state: 'SUCCEEDED', syncStageIndex: 0, syncGridKey: 'NEW_BUSINESS' },
      { state: 'SUCCEEDED', syncStageIndex: 1, syncGridKey: 'RECENTLY_CLOSED' },
      { state: 'RUNNING', syncStageIndex: 2, syncGridKey: 'INFORCE_CLIENTS' },
    ])).toEqual({ completed: 2, total: 9, percent: 22, currentGridKey: 'INFORCE_CLIENTS', failed: 0 })
  })

  it('pauses when a stage requires a new login', () => {
    expect(syncRunStateFromJobs([
      { state: 'SUCCEEDED', syncStageIndex: 0 },
      { state: 'ACTION_REQUIRED', syncStageIndex: 1 },
      { state: 'QUEUED', syncStageIndex: 2 },
    ])).toBe('PAUSED')
  })

  it('finishes partially when all stages are terminal and one failed', () => {
    expect(syncRunStateFromJobs([
      { state: 'SUCCEEDED', syncStageIndex: 0 },
      { state: 'FAILED', syncStageIndex: 1 },
      { state: 'SUCCEEDED', syncStageIndex: 2 },
    ])).toBe('PARTIAL')
  })
})
```

- [ ] **Step 2: Run the tests and observe the expected failure**

Run: `pnpm exec vitest run lib/national-life/sync-progress.test.ts`

Expected: FAIL because `./sync-progress` does not exist.

- [ ] **Step 3: Add the schema and migration**

Add enum values `SYNC_NATIONAL_LIFE_GRID` to `BrowserJobOperation` and
`QUEUED`, `RUNNING`, `PAUSED`, `COMPLETED`, `PARTIAL`, `FAILED` to a new
`NationalLifeSyncRunState` enum. Add:

```prisma
model NationalLifeSyncRun {
  id              String                  @id @default(cuid())
  agentId         String
  agent           Agent                   @relation(fields: [agentId], references: [id], onDelete: Cascade)
  deploymentScope String                  @default("SINGLE_DEPLOYMENT")
  provider        String                  @default("NATIONAL_LIFE")
  state           NationalLifeSyncRunState @default(QUEUED)
  totalStages     Int
  completedStages Int                     @default(0)
  failedStages    Int                     @default(0)
  currentGridKey  String?
  safeErrorCode   String?
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
  jobs            BrowserAutomationJob[]

  @@index([agentId, deploymentScope, state, createdAt])
}
```

Add `nationalLifeSyncRuns NationalLifeSyncRun[]` to `Agent`, and these optional
fields to `BrowserAutomationJob`:

```prisma
syncRunId      String?
syncRun        NationalLifeSyncRun? @relation(fields: [syncRunId], references: [id], onDelete: Cascade)
syncStageIndex Int?
syncGridKey    String?

@@index([syncRunId, syncStageIndex, state])
```

Write the migration SQL following the existing PostgreSQL migrations: create
the enum, create `NationalLifeSyncRun`, add the three nullable job columns and
foreign key/indexes, and add the new browser operation enum value. Do not run a
database migration against a local database in this environment.

- [ ] **Step 4: Implement the pure progress contract**

`NATIONAL_LIFE_SYNC_STAGES` must be the readonly nine-key tuple. Completed is
the number of `SUCCEEDED` jobs; failed is the number of `FAILED` jobs; current
is the lowest non-terminal stage. `percent` is
`Math.round(completed / total * 100)`. `ACTION_REQUIRED` maps to `PAUSED`; any
non-terminal job maps to `RUNNING`; all terminal jobs map to `COMPLETED` or
`PARTIAL` depending on failures.

- [ ] **Step 5: Generate and validate Prisma, then run the unit test**

Run: `pnpm exec prisma validate && pnpm exec prisma generate && pnpm exec vitest run lib/national-life/sync-progress.test.ts`

Expected: schema validation succeeds and all progress tests pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260803140000_add_national_life_sync_runs/migration.sql lib/national-life/sync-progress.ts lib/national-life/sync-progress.test.ts
git commit -m "persist National Life sync runs and stage progress"
```

### Task 2: Extrair o runner comum das grades

**Files:**
- Create: `lib/national-life/sync-grid.ts`
- Test: `lib/national-life/sync-grid.test.ts`
- Modify: `scripts/national-life-sync-snapshots.ts`

**Interfaces:**
- Produces `syncNationalLifeGrid(input): Promise<GridSyncResult>` and `NationalLifeGridPersistence`.
- Consumes `NATIONAL_LIFE_SYNC_STAGES`, `fetchNationalLifeGrid`, and the three existing persistence services.

- [ ] **Step 1: Write failing tests for allowlisting and persistence routing**

Test that `syncNationalLifeGrid` rejects `PLACEMENT_REPORT`, routes the three
case stages to `persistCaseSnapshots`, `INFORCE_CLIENTS` to
`persistInforcePolicies`, and the five report stages to `persistReportRows`.
Use a fake page and injected `fetchGrid`/persistence functions; assert the
returned `{ recordsTotal, rowsFetched, truncated, snapshots, written }` rather
than mock call counts alone.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm exec vitest run lib/national-life/sync-grid.test.ts`

Expected: FAIL because `sync-grid.ts` does not exist.

- [ ] **Step 3: Implement the shared runner**

Export the nine-key allowlist from the module and reject any other
`NationalLifeGridKey` with `GRID_NOT_ALLOWED`. Fetch once, map rows with the
existing normalizers, persist with `agentId`, `deploymentScope`, `gridKey` and
the same `fetchedAt`, and return counts. A truncated result is still persisted
but is surfaced to the caller; do not prune rows in this path.

- [ ] **Step 4: Refactor the script to call the runner**

Remove its duplicated grid arrays/routing function and import the shared
allowlist and runner. Keep CLI selection of known registered paths for the
diagnostic script, but make the default selection exactly the shared nine
stages. Preserve its per-grid error logging and session refresh behavior.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm exec vitest run lib/national-life/sync-grid.test.ts && pnpm exec tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/national-life/sync-grid.ts lib/national-life/sync-grid.test.ts scripts/national-life-sync-snapshots.ts
git commit -m "share National Life grid sync between script and worker"
```

### Task 3: Criar o run automaticamente e garantir ordem das etapas

**Files:**
- Create: `lib/national-life/sync-run-service.ts`
- Test: `lib/national-life/sync-run-service.test.ts`
- Modify: `lib/national-life/job-service.ts`
- Modify: `lib/national-life/job-service.test.ts`
- Modify: `workers/national-life/runtime.ts`
- Modify: `lib/national-life/interactive-connection-service.ts`

**Interfaces:**
- Produces `startNationalLifeSync(tx, input)`, `getNationalLifeSyncStatus(agentId)`, and `reconcileNationalLifeSync(tx, runId)`.
- `startNationalLifeSync` returns `{ runId, duplicate }` and accepts a Prisma transaction client so login and enqueue are atomic.

- [ ] **Step 1: Write failing service tests**

Cover these behaviors with a transaction-shaped fake repository:

```ts
it('creates one run and one ordered job for each fixed grid', async () => {
  const result = await startNationalLifeSync(fakeTx, {
    agentId: 'agent-1', deploymentScope: 'scope-1', now: now,
  })
  expect(result).toEqual({ runId: 'run-1', duplicate: false })
  expect(fakeTx.jobs.map((job) => [job.syncStageIndex, job.syncGridKey])).toEqual([
    [0, 'NEW_BUSINESS'], [1, 'RECENTLY_CLOSED'], [2, 'INFORCE_CLIENTS'],
    [3, 'PAID_COMMISSIONS'], [4, 'PROJECTED_COMMISSIONS'], [5, 'CLIENT_INTELLIGENCE'],
    [6, 'CORRESPONDENCE'], [7, 'COMMISSIONS_PAYMENT_PORTAL'], [8, 'PIP_PENDING'],
  ])
})

it('does not create a second active run for the same agent and scope', async () => {
  fakeTx.activeRun = { id: 'run-existing', state: 'RUNNING' }
  await expect(startNationalLifeSync(fakeTx, input)).resolves.toEqual({
    runId: 'run-existing', duplicate: true,
  })
  expect(fakeTx.jobs).toHaveLength(0)
})
```

- [ ] **Step 2: Run the tests and observe the failure**

Run: `pnpm exec vitest run lib/national-life/sync-run-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement idempotent creation and status reconciliation**

Search active states `QUEUED`, `RUNNING`, `PAUSED` with exact agent/scope/provider
filters. Create the run and all jobs in one transaction. Job idempotency keys
must include run id and stage index. `reconcileNationalLifeSync` reads child
states and updates counts/current stage/state; it sets `startedAt` on first
running stage and `completedAt` only for `COMPLETED`, `PARTIAL` or `FAILED`.

- [ ] **Step 4: Gate sync job claims by stage order**

In `claimNextAvailable`, when a candidate has `syncRunId`, query earlier jobs in
that run. Exclude the candidate if an earlier stage is not terminal. This keeps
one stage active even with multiple worker processes. `FAILED` is terminal and
allows later read-only stages to continue; `ACTION_REQUIRED` blocks the run.

- [ ] **Step 5: Hook both login completion transactions**

After `releaseJobsBlockedOnCarrierLogin` in both
`workers/national-life/runtime.ts` and
`lib/national-life/interactive-connection-service.ts`, call
`startNationalLifeSync(transaction, { agentId, deploymentScope, now })`. The
existing login-required queue drain and the automatic first sync must commit or
roll back together. A reconnect with an active run resumes the existing run and
does not create new jobs.

- [ ] **Step 6: Run service, queue and connection tests**

Run: `pnpm exec vitest run lib/national-life/sync-run-service.test.ts lib/national-life/job-service.test.ts lib/national-life/interactive-connection-service.test.ts workers/national-life/runtime.test.ts`

- [ ] **Step 7: Commit**

```bash
git add lib/national-life/sync-run-service.ts lib/national-life/sync-run-service.test.ts lib/national-life/job-service.ts lib/national-life/job-service.test.ts workers/national-life/runtime.ts lib/national-life/interactive-connection-service.ts
git commit -m "start and resume National Life sync runs after login"
```

### Task 4: Executar uma grade no worker e atualizar o run

**Files:**
- Modify: `lib/national-life/job-service.ts`
- Modify: `workers/national-life/run-job.ts`
- Modify: `workers/national-life/adapter.ts`
- Modify: `workers/national-life/runtime.ts`
- Test: `workers/national-life/run-job.test.ts`

**Interfaces:**
- `BrowserJobInput` gains `{ syncRunId: string; gridKey: NationalLifeGridKey }`.
- `NationalLifeJobAdapter` gains `syncGrid(gridKey): Promise<GridSyncResult>`.
- `NationalLifeRunJobDeps` gains `syncRunStore.reconcile(runId): Promise<void>`.

- [ ] **Step 1: Write the failing worker tests**

Add tests proving a valid sync-grid job calls the adapter with the exact
allowlisted key and transitions to `SUCCEEDED` with the returned counts; an
invalid grid payload transitions to `FAILED` with `GRID_NOT_ALLOWED`; and an
`AUTHENTICATION_STATE_INVALID` result pauses the run/job without executing the
grid. Existing adapter fakes must implement `syncGrid` returning a small count
object.

- [ ] **Step 2: Run the tests and observe the failure**

Run: `pnpm exec vitest run workers/national-life/run-job.test.ts`

Expected: FAIL because the new operation and adapter method are absent.

- [ ] **Step 3: Add the worker operation and adapter implementation**

Validate `job.operation === 'SYNC_NATIONAL_LIFE_GRID'`, validate the payload
against the nine-key allowlist, and add the branch beside the existing case,
quote and PDF branches. `NationalLifeAdapter.syncGrid` delegates to
`syncNationalLifeGrid` using its page and the configured portal URL. The runner
gets the persisted session and agent identity from the job.

- [ ] **Step 4: Reconcile the run after every outcome**

After success, failure, or login-required transition, call
`syncRunStore.reconcile(job.syncRunId)`. The worker must never expose raw rows in
the job result; store only counts and `truncated`. Keep the existing context
capture in `finally`, and let `runExclusively` requeue on browser contention.

- [ ] **Step 5: Run focused worker tests and typecheck**

Run: `pnpm exec vitest run workers/national-life/run-job.test.ts && pnpm exec tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add lib/national-life/job-service.ts workers/national-life/run-job.ts workers/national-life/adapter.ts workers/national-life/runtime.ts workers/national-life/run-job.test.ts
git commit -m "run National Life sync stages through the browser worker"
```

### Task 5: Expor o status e mostrar a barra real

**Files:**
- Create: `app/api/agent/integrations/national-life/sync/route.ts`
- Create: `app/agent/integrations/national-life/NationalLifeSyncProgress.tsx`
- Test: `app/api/agent/integrations/national-life/sync/route.test.ts`
- Test: `app/agent/integrations/national-life/NationalLifeSyncProgress.test.tsx`
- Modify: `app/agent/integrations/national-life/page.tsx`
- Modify: `components/CarrierSyncBadge.tsx`
- Modify: `app/api/agent/carrier-sync/route.ts`

**Interfaces:**
- `GET /api/agent/integrations/national-life/sync` returns a safe status scoped to the current agent or `{ run: null }`.
- `NationalLifeSyncProgress` receives an optional initial status and polls only active/paused runs.
- The compact badge displays `Atualizando X/9` while an active run exists and preserves the existing action state when login is required.

- [ ] **Step 1: Write failing route and component tests**

Route tests must verify the current agent is used and another agent's run is not
returned. Component tests must render `0 de 9 áreas atualizadas`, an intermediate
`3 de 9 áreas atualizadas` with a native progress value of `33`, stop polling
after `COMPLETED`, and show a safe partial message without internal error text.

- [ ] **Step 2: Run the tests and observe the failure**

Run: `pnpm exec vitest run app/api/agent/integrations/national-life/sync/route.test.ts app/agent/integrations/national-life/NationalLifeSyncProgress.test.tsx`

Expected: FAIL because the route and component do not exist.

- [ ] **Step 3: Implement the scoped status route**

Use `getCurrentAgent()` and `getNationalLifeEnv().sessionScopeId`; never accept
agent, scope, run or grid identifiers from query parameters. Return only the
safe progress contract, friendly `currentGridLabel`, and a boolean indicating
whether polling should continue.

- [ ] **Step 4: Implement the integration-page progress UI**

Add the client component near the connection card. Use `<progress>` with
`value`/`max`, visible `Atualizando dados da seguradora`, `X de 9 áreas
atualizadas`, and the current friendly area. Use a bounded interval while the
run is active/paused; clear it on terminal state and unmount. In `PAUSED`, show
`Conecte a National Life para continuar.` without the internal code.

- [ ] **Step 5: Extend the top badge**

Extend the existing carrier-sync API to include the latest active sync run
progress, still filtered by agent/provider. Update `CarrierSyncBadge` to show
`Atualizando X/9` and refresh only while that response says polling is needed.
Do not remove the existing `Precisa de você` behavior.

- [ ] **Step 6: Run UI tests and lint**

Run: `pnpm exec vitest run app/api/agent/integrations/national-life/sync app/agent/integrations/national-life/NationalLifeSyncProgress.test.tsx components/CarrierSyncBadge.test.tsx app/api/agent/carrier-sync/route.test.ts && pnpm exec eslint app/api/agent/integrations/national-life/sync app/agent/integrations/national-life components/CarrierSyncBadge.tsx app/api/agent/carrier-sync/route.ts`

- [ ] **Step 7: Commit**

```bash
git add app/api/agent/integrations/national-life/sync app/agent/integrations/national-life/NationalLifeSyncProgress.tsx app/agent/integrations/national-life/NationalLifeSyncProgress.test.tsx components/CarrierSyncBadge.tsx app/api/agent/carrier-sync/route.ts
git commit -m "show real National Life sync progress in the app"
```

### Task 6: Verificação integrada e handoff

**Files:**
- Modify: `docs/operations/national-life-portal-contract.md` only if implementation evidence changes the documented contract.

- [ ] **Step 1: Validate schema and generated types**

Run: `pnpm exec prisma validate && pnpm exec prisma generate && pnpm exec tsc --noEmit`

- [ ] **Step 2: Run the full test suite**

Run: `pnpm exec vitest run`

- [ ] **Step 3: Run lint and build**

Run: `pnpm exec eslint app components lib workers && pnpm build`

- [ ] **Step 4: Inspect the final diff**

Run: `git diff main...HEAD --stat && git diff --check && git status --short`

Confirm there are no credentials, raw carrier rows in API responses, unscoped
queries, or accidental inclusion of SSO/PDF/write operations.

- [ ] **Step 5: Commit any documentation-only correction and report**

Report separately: local commits, pushed branch, migration deployment status,
and whether live National Life execution was performed. A passing local build
does not prove the carrier session or production migration is live.

## Self-Review

The spec's automatic post-login trigger is covered in Task 3; the nine-stage
allowlist and shared persistence are covered in Tasks 1 and 2; sequential,
resumable worker execution is covered in Tasks 3 and 4; real progress and
limited polling are covered in Task 5; agent/scope isolation and safe copy are
repeated as global constraints and tested in Tasks 3 and 5. No SSO downstream,
document download, entity inference or write operation is included.

