# Foresight Read Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reutilizar a sessão National Life já autenticada para inventariar casos do Foresight, ler dados de um caso explicitamente selecionado ou vinculado com segurança e baixar PDFs existentes sob demanda, sem usar Rapid Solve ou criar entidades comerciais.

**Architecture:** O fluxo Foresight será uma operação durável própria, com seus próprios runs, jobs, snapshots e progresso, mas compartilhará a sessão Steel, o browser lock e o worker National Life existentes. A leitura automática abre o SSO uma única vez, lista todos os casos do painel Recent e persiste um inventário; detalhes e PDFs são jobs sequenciais para um caso-alvo validado. Nenhum snapshot será promovido automaticamente para Client, Policy, Application ou Illustration.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Playwright sobre Steel Browser, `steel-sdk`, Zod, Vitest, React.

## Global Constraints

- A primeira fase é somente leitura; não chama Rapid Solve, não cria caso, não cria ou envia application/e-App e não altera dados no carrier.
- Reutilizar o browser Steel vivo criado pelo login National Life.
- O worker aquece `/agent/` antes de atravessar `/agent/sso/foresight` e atravessa o SSO no máximo uma vez por execução.
- O inventário lê todos os casos que o painel Recent devolver, sem abrir cada caso automaticamente.
- Os cinco serviços detalhados só rodam para um caso explicitamente selecionado pelo agente ou já vinculado por chave externa confiável.
- As chamadas Foresight são sequenciais porque o `sessionTokenId` é stateful e muda quando outro caso é aberto.
- Auth0 pausa somente a operação Foresight; o progresso já persistido no sync das nove grades permanece válido.
- Payloads de leitura são redigidos antes de logs, erros, status público ou persistência de diagnóstico.
- A sessão humana não é fechada no fim do job: o cliente Playwright apenas desconecta e não envia `Browser.close` nem libera a sessão Steel.
- Dados do carrier permanecem em staging e não criam automaticamente `Client`, `Policy`, `Application` ou `Illustration`.
- PDFs só são armazenados quando a resposta tem assinatura `%PDF` válida.

---

## File Map

**Schema and migrations**

- Modify: `prisma/schema.prisma` — add Foresight run state/mode, job operations, run relation and staging models.
- Create: `prisma/migrations/20260803170000_add_national_life_foresight_read_sync/migration.sql` — create the enum values, tables, indexes and foreign keys.

**Pure contract and persistence**

- Create: `lib/national-life/foresight-sync.ts` — allowlisted services, case-list parser, safe payload shape, summary extraction and redaction boundary.
- Create: `lib/national-life/foresight-sync.test.ts` — pure parser, service allowlist, redaction, summary and idempotency tests.
- Create: `lib/national-life/foresight-snapshot-service.ts` — scoped upserts for case, service and document snapshots.
- Create: `lib/national-life/foresight-snapshot-service.test.ts` — repository-contract tests for upsert keys and ownership filters.
- Create: `lib/national-life/foresight-run-service.ts` — create/reconcile/progress/status operations for Foresight runs.
- Create: `lib/national-life/foresight-run-service.test.ts` — idempotency, progress and pause/partial transitions.

**Browser adapter and worker**

- Modify: `workers/national-life/adapter.ts` — add Foresight inventory and selected-case reads using the existing browser session.
- Modify: `workers/national-life/adapter.test.ts` — verify frame selection, service order, SSO errors and absence of Rapid Solve calls.
- Modify: `workers/national-life/run-job.ts` — validate and dispatch Foresight read/PDF jobs, update the run, preserve live sessions and map failures.
- Modify: `workers/national-life/run-job.test.ts` — verify operation dispatch, sequential progress, pause behavior and safe live-session disconnect.
- Modify: `workers/national-life/runtime.ts` — wire repositories, snapshot persistence and Foresight run store into the worker.
- Modify: `workers/national-life/runtime.test.ts` — verify the runtime can claim the new operation without changing existing grid ordering.

**Connection trigger and API**

- Modify: `lib/national-life/interactive-connection-service.ts` — enqueue the automatic Foresight inventory in the same successful-login transaction as the existing nine-grid sync.
- Modify: `app/api/agent/integrations/national-life/sync/route.ts` — keep the nine-grid status contract stable and add a separately scoped Foresight status route.
- Create: `app/api/agent/integrations/national-life/foresight/route.ts` — return only the current agent’s Foresight run status and safe case inventory.
- Create: `app/api/agent/integrations/national-life/foresight/[caseId]/route.ts` — request selected-case detail/PDF jobs after server-side ownership validation.

**UI**

- Create: `app/agent/integrations/national-life/NationalLifeForesightProgress.tsx` — poll only an active/paused Foresight run and show real case/service progress.
- Create: `app/agent/integrations/national-life/NationalLifeForesightProgress.test.tsx` — verify terminal polling, paused copy and no sensitive values.
- Modify: `app/agent/integrations/national-life/page.tsx` — load and render Foresight status as a separate progress section.
- Modify: `app/agent/integrations/national-life/data/page.tsx` — query scoped Foresight case/service summaries without shipping raw payloads.
- Create: `app/agent/integrations/national-life/data/ForesightCaseTabs.tsx` — render inventory, selected-case safe fields and actions for detail/PDF.
- Create: `app/agent/integrations/national-life/data/ForesightCaseTabs.test.tsx` — verify labels, empty states, product display and no raw payload rendering.

**Documents**

- Create: `app/api/agent/integrations/national-life/foresight/[caseId]/document/route.ts` — stream an owned Foresight PDF with stored MIME type and safe filename.
- Modify: `lib/national-life/foresight-report.ts` — share report readiness/filename/PDF validation with the new staging document flow.
- Modify: `lib/national-life/illustration-pdf-status.ts` only if shared status formatting is needed; do not change Rapid Solve behavior.

**Existing discovery scripts**

- Modify: `scripts/national-life-describe-foresight-data.ts` — import pure shape/redaction helpers instead of maintaining a second contract implementation.
- Modify: `scripts/national-life-describe-foresight-newcase.ts` — import endpoint classification helpers only; keep the script strictly read-only and discovery-only.
- Modify: `scripts/national-life-describe-foresight-services.ts` — import shared endpoint extraction where applicable; do not add service calls.

---

## Task 1: Add Foresight schema and migration

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260803170000_add_national_life_foresight_read_sync/migration.sql`

**Interfaces:**

- Produces `BrowserJobOperation.SYNC_FORESIGHT_READ` and `BrowserJobOperation.GENERATE_FORESIGHT_PDF`.
- Produces `NationalLifeForesightReadRunState` with `QUEUED`, `RUNNING`, `PAUSED`, `PARTIAL`, `COMPLETED`, `FAILED`.
- Produces `NationalLifeForesightReadMode` with `INVENTORY` and `DETAIL`.
- Produces `NationalLifeForesightReadRun`, `NationalLifeForesightCaseSnapshot`, `NationalLifeForesightServiceSnapshot` and `NationalLifeForesightDocument` models.
- Adds nullable `foresightRunId` and relation to `BrowserAutomationJob`; existing grid jobs continue using `syncRunId`.

- [ ] **Step 1: Add the Prisma schema models**

Use these concrete fields:

```prisma
enum NationalLifeForesightReadRunState {
  QUEUED
  RUNNING
  PAUSED
  PARTIAL
  COMPLETED
  FAILED
}

enum NationalLifeForesightReadMode {
  INVENTORY
  DETAIL
}

model NationalLifeForesightReadRun {
  id                String                               @id @default(cuid())
  agentId           String
  agent             Agent                                @relation(fields: [agentId], references: [id], onDelete: Cascade)
  deploymentScope   String                               @default("SINGLE_DEPLOYMENT")
  provider          String                               @default("NATIONAL_LIFE")
  mode              NationalLifeForesightReadMode
  state             NationalLifeForesightReadRunState    @default(QUEUED)
  targetCaseId      String?
  totalCases        Int                                  @default(0)
  inventoriedCases  Int                                  @default(0)
  totalServices     Int                                  @default(0)
  completedServices Int                                  @default(0)
  currentCaseName   String?
  currentService    String?
  safeErrorCode     String?
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime                             @default(now())
  updatedAt         DateTime                             @updatedAt
  jobs              BrowserAutomationJob[]

  @@index([agentId, deploymentScope, state, createdAt])
}

model NationalLifeForesightCaseSnapshot {
  id              String   @id @default(cuid())
  agentId         String
  agent            Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
  deploymentScope String
  provider        String   @default("NATIONAL_LIFE")
  externalKey     String
  displayName     String
  caseKind        String?
  product         String?
  status          String?
  state           String?
  observedAt      DateTime
  raw             Json
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  services        NationalLifeForesightServiceSnapshot[]
  documents       NationalLifeForesightDocument[]

  @@unique([agentId, deploymentScope, provider, externalKey])
  @@index([agentId, deploymentScope, observedAt])
}

model NationalLifeForesightServiceSnapshot {
  id              String   @id @default(cuid())
  caseSnapshotId  String
  caseSnapshot    NationalLifeForesightCaseSnapshot @relation(fields: [caseSnapshotId], references: [id], onDelete: Cascade)
  serviceName     String
  payloadShape    Json
  payload         Json
  validationState String
  observedAt      DateTime
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([caseSnapshotId, serviceName])
  @@index([caseSnapshotId, observedAt])
}

model NationalLifeForesightDocument {
  id              String   @id @default(cuid())
  caseSnapshotId  String
  caseSnapshot    NationalLifeForesightCaseSnapshot @relation(fields: [caseSnapshotId], references: [id], onDelete: Cascade)
  reportKey       String
  filename        String
  mimeType        String
  byteSize        Int
  contentHash     String
  bytes           Bytes
  renderState     String
  safeErrorCode   String?
  fetchedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([caseSnapshotId, reportKey])
  @@index([caseSnapshotId, createdAt])
}
```

Add the corresponding relation arrays to `Agent`, the Foresight run relation to `BrowserAutomationJob`, and the two enum operations without changing existing enum values. The schema itself is the contract test: every new staging model must include `agentId`, `deploymentScope` and `provider`.

- [ ] **Step 2: Generate and inspect the migration**

Run `pnpm exec prisma migrate dev --name add_national_life_foresight_read_sync` in the development database, inspect that the migration contains only the new enums/tables/relations/indexes, then run `pnpm exec prisma generate`.

- [ ] **Step 3: Run the schema/type checks**

Run `pnpm exec tsc --noEmit` and `git diff --check`. Expected: both pass with no changes to existing migrations.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Foresight read sync storage"
```

## Task 2: Build the pure Foresight contract boundary

**Files:**

- Create: `lib/national-life/foresight-sync.ts`
- Create: `lib/national-life/foresight-sync.test.ts`
- Modify: `scripts/national-life-describe-foresight-data.ts`
- Modify: `scripts/national-life-describe-foresight-newcase.ts`
- Modify: `scripts/national-life-describe-foresight-services.ts`

**Interfaces:**

```ts
export const FORESIGHT_READ_SERVICES: readonly string[]

export type ForesightCaseListing = {
  externalKey: string
  displayName: string
  caseKind: string | null
  product: string | null
}

export type ForesightServiceObservation = {
  serviceName: string
  payloadShape: unknown
  payload: unknown
  validationState: 'VALID' | 'INVALID'
}

export function parseForesightCaseListings(documentHtml: string): ForesightCaseListing[]
export function describeForesightShape(value: unknown, depth?: number): unknown
export function redactForesightPayload(value: unknown): unknown
export function summarizeForesightCase(value: unknown): Pick<ForesightCaseListing, 'caseKind' | 'product'>
export function isForesightReadService(value: string): boolean
```

- [ ] **Step 1: Write failing pure tests**

Cover these fixtures:

```ts
expect(parseForesightCaseListings(
  '<a id="lnkCaseName0">RP-Silva-QQ-08032026</a><a id="lnkCaseName1">Maria Silva</a>',
)).toEqual([
  { externalKey: 'RP-Silva-QQ-08032026', displayName: 'RP-Silva-QQ-08032026', caseKind: 'QUICK_QUOTE', product: null },
  { externalKey: 'Maria Silva', displayName: 'Maria Silva', caseKind: 'CASE', product: null },
])
expect(isForesightReadService('WidgetService.asmx/GetQuickCalcData')).toBe(true)
expect(isForesightReadService('PageService.asmx/RenderReports')).toBe(false)
expect(redactForesightPayload({ email: 'person@example.com', tokenId: 'secret', premium: 250 })).toEqual({
  email: '[REDACTED]',
  tokenId: '[REDACTED]',
  premium: 250,
})
expect(describeForesightShape({ rows: [{ premium: 250 }] })).toEqual({ rows: { array: 1, of: { premium: 'number' } } })
```

Also assert that unknown services are rejected, strings are length-truncated, arrays are depth-limited, and a missing `id` falls back to the visible case label without claiming that label is a commercial identity.

- [ ] **Step 2: Implement the allowlist and parsers**

Move the existing five service names and shape behavior from `scripts/national-life-describe-foresight-data.ts` into the shared module. Parse only anchors whose id contains `lnkCaseName`; trim text and classify `-QQ-` names as `QUICK_QUOTE`. Do not parse arbitrary links as cases.

- [ ] **Step 3: Implement redaction and safe summary extraction**

Run all payloads through a Foresight-specific key policy that redacts `password`, `secret`, `token`, `authorization`, `cookie`, `session`, `ssn`, `social`, `health`, `username`, `email`, `phone`, `dob`, `dateofbirth` and `address`, truncates strings to 2,000 characters, and limits nested depth to 8. Extract product/status/case-kind only from explicit carrier keys; leave absent values `null`.

- [ ] **Step 4: Point discovery scripts at the shared helpers**

Keep the scripts read-only. They may continue to report endpoint names and shapes, but they must not add a new service call, render a report, create a case or import Rapid Solve code.

- [ ] **Step 5: Run focused tests and commit**

Run `pnpm exec vitest run lib/national-life/foresight-sync.test.ts scripts/national-life-describe-foresight-data.test.ts scripts/national-life-describe-foresight-newcase.test.ts scripts/national-life-describe-foresight-services.test.ts`. Expected: all pass.

```bash
git add lib/national-life/foresight-sync.ts lib/national-life/foresight-sync.test.ts scripts/national-life-describe-foresight-*.ts
git commit -m "feat: define Foresight read contract"
```

## Task 3: Add Foresight snapshot and run services

**Files:**

- Create: `lib/national-life/foresight-snapshot-service.ts`
- Create: `lib/national-life/foresight-snapshot-service.test.ts`
- Create: `lib/national-life/foresight-run-service.ts`
- Create: `lib/national-life/foresight-run-service.test.ts`

**Interfaces:**

```ts
export type ForesightRunStore = {
  start(input: {
    agentId: string
    deploymentScope: string
    mode: 'INVENTORY' | 'DETAIL'
    targetCaseId?: string
    now: Date
  }): Promise<{ runId: string; jobId: string; duplicate: boolean }>
  updateProgress(input: {
    runId: string
    agentId: string
    deploymentScope: string
    patch: {
      totalCases?: number
      inventoriedCases?: number
      totalServices?: number
      completedServices?: number
      currentCaseName?: string | null
      currentService?: string | null
    }
  }): Promise<void>
  reconcile(input: { runId: string; agentId: string; deploymentScope: string }): Promise<void>
  getStatus(agentId: string, deploymentScope: string): Promise<ForesightReadStatus | null>
}

export type ForesightReadStatus = {
  runId: string
  mode: 'INVENTORY' | 'DETAIL'
  state: 'QUEUED' | 'RUNNING' | 'PAUSED' | 'PARTIAL' | 'COMPLETED' | 'FAILED'
  totalCases: number
  inventoriedCases: number
  totalServices: number
  completedServices: number
  currentCaseName: string | null
  currentService: string | null
  percent: number
  shouldPoll: boolean
  completedAt: Date | null
}

export function upsertForesightCaseSnapshot(input: ForesightCaseSnapshotInput): Promise<{ id: string }>
export function upsertForesightServiceSnapshot(input: ForesightServiceSnapshotInput): Promise<void>
export function upsertForesightDocument(input: ForesightDocumentInput): Promise<void>
```

- [ ] **Step 1: Write failing repository tests**

Use an in-memory fake repository matching the Prisma methods. Assert that the case key is `[agentId, deploymentScope, provider, externalKey]`, the service key is `[caseSnapshotId, serviceName]`, and a document key is `[caseSnapshotId, reportKey]`. Assert that an update for one agent cannot match another agent’s case.

- [ ] **Step 2: Implement scoped snapshot upserts**

Persist only the shared-module output: safe case summary, `raw` redacted payload, service `payloadShape`, redacted `payload`, validation state and timestamps. Never return raw payloads from a status function.

- [ ] **Step 3: Write failing run-service tests**

Cover: duplicate active inventory run returns the existing run/job; a completed run allows a new run; progress calculates `percent` from `inventoriedCases + completedServices` with a denominator of `totalCases + totalServices`, returning `0` when the denominator is zero; `PAUSED` and terminal runs stop polling; all queries include `agentId` and `deploymentScope`.

- [ ] **Step 4: Implement run creation, progress and reconciliation**

Create one `BrowserAutomationJob` with operation `SYNC_FORESIGHT_READ`, `foresightRunId`, `input: { foresightRunId, mode, targetCaseId }`, and a mode-specific idempotency key. Reconcile `QUEUED`/`RUNNING`/`PAUSED`/terminal state from the job state and stored progress. Map `ACTION_REQUIRED` and `FORESIGHT_SSO_EXPIRED` to `PAUSED` without deleting snapshots.

- [ ] **Step 5: Run focused tests and commit**

Run `pnpm exec vitest run lib/national-life/foresight-snapshot-service.test.ts lib/national-life/foresight-run-service.test.ts`. Expected: all pass.

```bash
git add lib/national-life/foresight-snapshot-service.ts lib/national-life/foresight-snapshot-service.test.ts lib/national-life/foresight-run-service.ts lib/national-life/foresight-run-service.test.ts
git commit -m "feat: persist Foresight read runs and snapshots"
```

## Task 4: Extend the adapter with safe inventory and detail reads

**Files:**

- Modify: `workers/national-life/adapter.ts`
- Modify: `workers/national-life/adapter.test.ts`
- Modify: `workers/national-life/foresight-report.ts` only if a shared adapter helper is extracted; otherwise keep report logic in `adapter.ts`.

**Interfaces:**

```ts
export type ForesightReadResult = {
  cases: ForesightCaseListing[]
  selectedCase: ForesightCaseListing | null
  services: ForesightServiceObservation[]
}

export type NationalLifeJobAdapter = {
  // existing methods remain unchanged
  readForesight(input: { targetCaseKey?: string }): Promise<ForesightReadResult>
  renderForesightReport(caseKey: string): Promise<{ caseName: string; bytes: Buffer; mimeType: string } | null>
}
```

- [ ] **Step 1: Write failing adapter tests**

Add fixture pages containing an outer frame, a `StartPage.aspx` frame and a `$ITAjax` runtime. Assert that `readForesight({})` returns the case inventory without calling any service; `readForesight({ targetCaseKey })` opens only the matching case and calls exactly the five allowlisted services in the order declared by `FORESIGHT_READ_SERVICES`; a missing target throws a safe `FORESIGHT_CASE_NOT_FOUND`; an Auth0 URL throws `FORESIGHT_SSO_EXPIRED`; and a service outside the allowlist is never requested.

- [ ] **Step 2: Implement a single warm SSO/frame helper**

Warm `/agent/`, navigate to `/agent/sso/foresight`, wait for `StartPage.aspx`, and classify Auth0/empty-frame/layout failures before touching a case. Keep the route allowlist enforced by the existing browser session.

- [ ] **Step 3: Implement inventory parsing**

Read only `a[id*="lnkCaseName"]` from the Recent frame and pass the resulting HTML/text through `parseForesightCaseListings`. Do not click a case in inventory mode.

- [ ] **Step 4: Implement selected-case service reads**

Find the requested listing by exact `externalKey`, click its known DOM id, re-find the frame carrying `$ITCommon.sessionTokenId()`, and call one service per `evaluate`. Re-find the frame after each call because a WebForms postback may replace it. Return redacted observations and never invoke `IllustrateCase`, `RenderReports`, e-App controls or Rapid Solve.

- [ ] **Step 5: Preserve existing report behavior**

Refactor the current report path to accept a validated case key from the worker. Keep `SetupReportDisplay`, `RenderReports`, `GetReportProgress` and `%PDF` validation; do not make report generation part of automatic inventory.

- [ ] **Step 6: Run focused tests and commit**

Run `pnpm exec vitest run workers/national-life/adapter.test.ts lib/national-life/foresight-sync.test.ts`. Expected: all pass.

```bash
git add workers/national-life/adapter.ts workers/national-life/adapter.test.ts lib/national-life/foresight-report.ts
git commit -m "feat: read Foresight cases without carrier writes"
```

## Task 5: Dispatch Foresight jobs in the worker

**Files:**

- Modify: `lib/national-life/job-service.ts`
- Modify: `workers/national-life/run-job.ts`
- Modify: `workers/national-life/runtime.ts`
- Modify: `workers/national-life/run-job.test.ts`
- Modify: `workers/national-life/runtime.test.ts`

**Interfaces:**

```ts
export type ForesightReadJobInput = {
  foresightRunId: string
  mode: 'INVENTORY' | 'DETAIL'
  targetCaseId?: string
}

export type ForesightPdfJobInput = {
  caseSnapshotId: string
  caseKey: string
}

export type ForesightRunWorkerStore = ForesightRunStore & {
  saveInventory(input: {
    runId: string
    agentId: string
    deploymentScope: string
    cases: ForesightCaseListing[]
    observedAt: Date
  }): Promise<Map<string, string>>
  saveService(input: {
    runId: string
    agentId: string
    deploymentScope: string
    caseSnapshotId: string
    observation: ForesightServiceObservation
    observedAt: Date
  }): Promise<void>
  saveDocument(input: {
    agentId: string
    deploymentScope: string
    caseSnapshotId: string
    reportKey: string
    caseName: string
    bytes: Buffer
    mimeType: string
    fetchedAt: Date
  }): Promise<void>
}
```

- [ ] **Step 1: Write failing job-service tests**

Assert that `enqueueForesightRead` rejects URLs, empty mode, unknown target IDs and cross-agent snapshot IDs; returns `duplicate: true` for an active same-scope run; and never creates `GET_RAPID_SOLVE_QUOTE` or `GENERATE_ILLUSTRATION_PDF` for the Foresight read path.

- [ ] **Step 2: Add input validation and job creation**

Extend `BrowserJobInput` with the two Foresight input types. Create `enqueueForesightRead` and `enqueueForesightPdf` using bounded identifiers, exact operation/input agreement and idempotency keys scoped by agent, deployment and target snapshot.

- [ ] **Step 3: Write failing worker tests**

Add cases to `run-job.test.ts` asserting: inventory saves all listings and no service observations; detail updates one service at a time; `FORESIGHT_SSO_EXPIRED` transitions the job to `ACTION_REQUIRED` and run to `PAUSED`; a PDF with non-PDF bytes fails safely; and a reattached live session records `browser:disconnect` without `browser:close` or Steel release.

- [ ] **Step 4: Dispatch the new operations**

In `runNationalLifeJob`, validate `foresightInput` before opening a browser, call `adapter.readForesight` or `adapter.renderForesightReport`, persist snapshots through `ForesightRunWorkerStore`, and update progress after each case/service. Reconcile only the matching Foresight run. Preserve the existing grid, case-read, Rapid Solve and illustration-PDF branches unchanged.

- [ ] **Step 5: Map failure classes**

Map `FORESIGHT_SSO_EXPIRED` to `ACTION_REQUIRED`/`PAUSED`, `FORESIGHT_CASE_NOT_FOUND` and `FORESIGHT_REPORT_FAILED` to safe terminal failure, transient network codes to the existing bounded retry, and layout/schema errors to `MANUAL_REVIEW`. No failure branch may invalidate another agent’s session.

- [ ] **Step 6: Wire runtime dependencies and run tests**

Instantiate the Foresight run/snapshot stores in `workers/national-life/runtime.ts`, pass them to the worker, and add a runtime test that the new operation is claimable while the nine grid jobs remain ordered by `syncRunId`/`syncStageIndex`.

Run `pnpm exec vitest run workers/national-life/run-job.test.ts workers/national-life/runtime.test.ts lib/national-life/job-service.test.ts`. Expected: all pass.

```bash
git add lib/national-life/job-service.ts workers/national-life/run-job.ts workers/national-life/runtime.ts workers/national-life/run-job.test.ts workers/national-life/runtime.test.ts
git commit -m "feat: execute Foresight read jobs safely"
```

## Task 6: Start the inventory after a successful login

**Files:**

- Modify: `lib/national-life/interactive-connection-service.ts`
- Modify: `lib/national-life/foresight-run-service.ts`
- Modify: `lib/national-life/interactive-connection-service.test.ts`
- Modify: `lib/national-life/foresight-run-service.test.ts`

**Interfaces:**

```ts
export async function startForesightInventory(
  tx: Prisma.TransactionClient,
  input: { agentId: string; deploymentScope: string; now: Date },
): Promise<{ runId: string; duplicate: boolean }>
```

- [ ] **Step 1: Write the transaction test**

Extend the successful connection test to assert one transaction creates the existing nine-grid `NationalLifeSyncRun` and one `SYNC_FORESIGHT_READ` inventory run/job for the same agent and deployment scope. A repeated completion must return the existing active Foresight run and must not enqueue a second inventory job.

- [ ] **Step 2: Add the transaction-safe inventory starter**

Create the Foresight run and job through the passed Prisma transaction client. Do not query or mutate any other agent’s active runs. Keep the existing `startNationalLifeSync` call and its nine-stage behavior unchanged.

- [ ] **Step 3: Wire after connection commit preparation**

Call `startForesightInventory(transaction, ...)` immediately after `startNationalLifeSync(transaction, ...)` inside `completeOwnedAttempt`. If either creation fails, the connection transaction rolls back and the login is not reported as complete.

- [ ] **Step 4: Run focused tests and commit**

Run `pnpm exec vitest run lib/national-life/interactive-connection-service.test.ts lib/national-life/foresight-run-service.test.ts`. Expected: connection succeeds atomically and no duplicate jobs appear.

```bash
git add lib/national-life/interactive-connection-service.ts lib/national-life/interactive-connection-service.test.ts lib/national-life/foresight-run-service.ts lib/national-life/foresight-run-service.test.ts
git commit -m "feat: start Foresight inventory after login"
```

## Task 7: Expose safe Foresight status and data UI

**Files:**

- Create: `app/api/agent/integrations/national-life/foresight/route.ts`
- Create: `app/api/agent/integrations/national-life/foresight/[caseId]/route.ts`
- Modify: `app/api/agent/integrations/national-life/sync/route.ts` only if shared ownership/status helpers are extracted.
- Create: `app/agent/integrations/national-life/NationalLifeForesightProgress.tsx`
- Create: `app/agent/integrations/national-life/NationalLifeForesightProgress.test.tsx`
- Modify: `app/agent/integrations/national-life/page.tsx`
- Modify: `app/agent/integrations/national-life/data/page.tsx`
- Create: `app/agent/integrations/national-life/data/ForesightCaseTabs.tsx`
- Create: `app/agent/integrations/national-life/data/ForesightCaseTabs.test.tsx`

**Interfaces:**

```ts
GET /api/agent/integrations/national-life/foresight
// { run: ForesightReadStatus | null, cases: ForesightCaseSummary[] }

POST /api/agent/integrations/national-life/foresight/:caseId
// { action: 'DETAIL' | 'PDF' }
// { ok: true, jobId: string, duplicate: boolean } | { ok: false, message: string }
```

- [ ] **Step 1: Write route ownership tests**

Assert the GET returns only the current agent and `sessionScopeId`, omits `safeErrorCode`, raw payloads, cookies, tokens and diagnostic details, and returns `null` when the integration is unavailable. Assert POST rejects a case snapshot owned by another agent or scope.

- [ ] **Step 2: Implement the safe status route**

Use `getCurrentAgent()` and `getNationalLifeEnv().sessionScopeId` on the server. Return display-safe case summary fields: `id`, `displayName`, `caseKind`, `product`, `status`, `state`, `observedAt`, and service count. Never serialize `raw` or service `payload` to the browser.

- [ ] **Step 3: Implement detail/PDF actions**

Validate the route case id against the authenticated agent and scope, then call `enqueueForesightRead({ mode: 'DETAIL', targetCaseId })` or `enqueueForesightPdf({ caseSnapshotId, caseKey })`. Do not accept a carrier URL, case name fragment or session id from the client as authority.

- [ ] **Step 4: Build the progress component**

Poll only while `shouldPoll` is true, stop on `COMPLETED`, `PARTIAL`, `FAILED` or unmount, and display `Foresight: lendo casos`, `Foresight: lendo 2 de 5 serviços` or `Foresight: precisa de você`. Never display Auth0, internal codes, session IDs or a fabricated duration.

- [ ] **Step 5: Add Foresight data to the data page**

Render a separate Foresight section/tab next to the existing portal cases, inforce and commissions. Show case inventory, product/status when present, last observed time, number of service observations and explicit `Ler dados`/`Gerar PDF` actions. Empty and paused states must explain that no carrier write occurred.

- [ ] **Step 6: Run UI/API tests and commit**

Run `pnpm exec vitest run app/api/agent/integrations/national-life app/agent/integrations/national-life/NationalLifeForesightProgress.test.tsx app/agent/integrations/national-life/data/ForesightCaseTabs.test.tsx`. Expected: all pass and no raw payload is rendered.

```bash
git add app/api/agent/integrations/national-life app/agent/integrations/national-life/data/page.tsx
git commit -m "feat: show Foresight read progress and cases"
```

## Task 8: Add the on-demand Foresight PDF document route

**Files:**

- Create: `app/api/agent/integrations/national-life/foresight/[caseId]/document/route.ts`
- Modify: `workers/national-life/adapter.ts`
- Modify: `workers/national-life/run-job.ts`
- Modify: `lib/national-life/foresight-report.ts`
- Create: `app/api/agent/integrations/national-life/foresight/[caseId]/document/route.test.ts`
- Modify: `workers/national-life/run-job.test.ts`

**Interfaces:**

```ts
export function buildForesightDocumentFilename(caseName: string, at: Date): string
export function isPdfPayload(bytes: Uint8Array): boolean
```

- [ ] **Step 1: Write failing PDF tests**

Assert `%PDF` bytes are accepted only above the existing minimum size, HTML with HTTP 200 is rejected, filenames strip accents/unsafe characters and route access is scoped to the current agent.

- [ ] **Step 2: Implement PDF persistence**

Use the selected snapshot’s validated `externalKey`, render the existing Foresight case, store `bytes`, MIME type, size, hash, filename and `fetchedAt` in `NationalLifeForesightDocument`, and upsert by `[caseSnapshotId, reportKey]`. Do not create an `Illustration`.

- [ ] **Step 3: Implement the document route**

Query an owned document by `caseSnapshotId`, set `Content-Type` from the stored MIME type, set a safe `Content-Disposition`, and return 404 for a missing/cross-agent document. Never expose the carrier session URL.

- [ ] **Step 4: Run focused tests and commit**

Run `pnpm exec vitest run lib/national-life/foresight-report.test.ts workers/national-life/run-job.test.ts app/api/agent/integrations/national-life/foresight/[caseId]/document/route.test.ts`. Expected: invalid documents never reach storage.

```bash
git add app/api/agent/integrations/national-life/foresight lib/national-life/foresight-report.ts workers/national-life/adapter.ts workers/national-life/run-job.ts
git commit -m "feat: fetch Foresight PDFs on demand"
```

## Task 9: Full verification and controlled rollout

**Files:**

- Modify only files exposed by failing verification; no unrelated cleanup.

- [ ] **Step 1: Run the complete focused suite**

```bash
pnpm exec vitest run \
  lib/national-life/foresight-sync.test.ts \
  lib/national-life/foresight-snapshot-service.test.ts \
  lib/national-life/foresight-run-service.test.ts \
  workers/national-life/adapter.test.ts \
  workers/national-life/run-job.test.ts \
  workers/national-life/runtime.test.ts \
  app/api/agent/integrations/national-life \
  app/agent/integrations/national-life/NationalLifeForesightProgress.test.tsx \
  app/agent/integrations/national-life/data/ForesightCaseTabs.test.tsx
pnpm exec tsc --noEmit
pnpm exec eslint lib/national-life workers/national-life app/api/agent/integrations/national-life app/agent/integrations/national-life
git diff --check
```

Expected: all tests pass, TypeScript and ESLint pass, and no Rapid Solve test or implementation is changed by the Foresight path.

- [ ] **Step 2: Verify migration and build boundaries**

Run `pnpm exec prisma migrate status`, inspect the generated Prisma client, and build the dedicated National Life runtime with the production env file. Verify that the runtime source commit and both National Life containers are healthy before asking for a new login.

- [ ] **Step 3: Perform one controlled live validation**

Only after deployment and when the account owner is ready, use one fresh login. Validate in one browser-lock-held run: portal warm-up, one Foresight SSO crossing, inventory count, one explicitly selected case’s five service calls, refreshed context persistence, and safe transport disconnect. Do not run the old probe scripts that call `session.close()` against the human-owned live session.

- [ ] **Step 4: Commit verification notes**

Record the runtime commit, migration result, test totals, Foresight inventory result and any safe error code in the rollout note. Do not record names, policy numbers, cookies, tokens, raw payloads or PDFs in the repository.

## Plan self-review

- The approved scope is covered by Tasks 1–8: storage, contract, adapter, worker, post-login trigger, status/data UI and on-demand PDF.
- Rapid Solve remains an existing independent operation and is not called, renamed or reused by the new Foresight operations.
- Detail reads have a concrete target rule: explicit agent selection or an existing trusted external-key link; inventory does not click every case.
- The worker’s existing live-session distinction is preserved: reused sessions disconnect the Playwright transport, while job-owned fallback sessions may still be closed/released by the existing path.
- Auth0/SSO failure is mapped to the Foresight run only, so the nine-grid sync remains independently observable.
- All public routes derive agent and scope server-side and omit raw payloads and sensitive diagnostics.
- No step requires a second login during implementation; live validation is a single final controlled pass after deployment.
