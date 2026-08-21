# National Life Accurate Portal Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete, read-only, reconciled National Life source and action contract before enabling new collectors or carrier writes.

**Architecture:** Treat portal discovery, domain ingestion, Illustration, and Application as separate evidence tracks sharing one versioned source catalogue. The authenticated sweep records field names, filters, identifiers, counts, transport and action risk; later projects implement only contracts proven by that evidence.

**Tech Stack:** Next.js 16, TypeScript, Prisma/PostgreSQL, Vitest, KeeproneConnect/WXT, National Life portal, Foresight ASMX, iPipeline iGO.

**Spec:** `docs/superpowers/specs/2026-08-20-national-life-product-contract.md`

## Global Constraints

- Do not connect to the portal until Tasks 1-3 are reviewed.
- The first authenticated sweep is read-only.
- Do not create, save, copy or run a Foresight illustration.
- Do not prepare, upload to, message from or submit an iGO application.
- Do not put PII, health data, credentials, cookies or raw customer values in documentation or logs.
- Preserve raw source records before normalization.
- Never represent missing numeric values as zero.
- A run/stage completion is not domain-ingestion proof.
- Preserve the user's existing uncommitted commission-detail work.

---

### Task 1: Freeze the KeeprOne product contract

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-national-life-product-contract.md`
- Read: `prisma/schema.prisma`
- Read: `app/agent/page.tsx`
- Read: `app/agent/clients/page.tsx`
- Read: `app/agent/policies/page.tsx`
- Read: `app/agent/policies/[id]/page.tsx`
- Read: `app/agent/cases/[id]/CaseWorkspace.tsx`
- Read: `app/agent/illustrations/IllustrationsWorkspace.tsx`
- Read: `app/agent/commissions/page.tsx`

**Interfaces:**
- Consumes: current product surfaces and Prisma domain models.
- Produces: approved field groups, destinations, priorities and prohibited assumptions for every later task.

- [ ] **Step 1: Review every product surface against the spec tables**

Confirm that Clients, Policies, Cases, Requirements, Illustrations, Commissions,
Documents, Dashboard and Promotion each have a named input in the spec.

- [ ] **Step 2: Record every model mismatch explicitly**

The review must include at least: nullable premium, person roles, external
identity, policy values, carrier documents, commission join, official
illustration, application sections, sensitive data retention and submission
receipt.

- [ ] **Step 3: Run a placeholder scan**

Run:

```bash
rg -n 'T[B]D|T[O]DO|implement[[:space:]]+later|similar[[:space:]]+to|appropriate[[:space:]]+error[[:space:]]+handling' docs/superpowers/specs/2026-08-20-national-life-product-contract.md
```

Expected: no matches.

- [ ] **Step 4: Commit the reviewed contract**

```bash
git add docs/superpowers/specs/2026-08-20-national-life-product-contract.md
git commit -m "docs: define National Life product contract"
```

### Task 2: Version the 30-source evidence ledger

**Files:**
- Create: `docs/operations/national-life-source-ledger-2026-08-20.md`
- Modify: `lib/national-life/read-coverage.ts`
- Test: `lib/national-life/read-coverage.test.ts`

**Interfaces:**
- Consumes: `NATIONAL_LIFE_READ_COVERAGE` and the states defined in the spec.
- Produces: one row per source with `implementation`, `evidenceState`, route,
  fields, filters, total, transport, destination, dedupe group and open questions.

- [ ] **Step 1: Write a failing test for catalogue/ledger parity**

Add a test that extracts source keys from the ledger and asserts exact equality
with `NATIONAL_LIFE_READ_COVERAGE.map(source => source.key)`.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
npx vitest run lib/national-life/read-coverage.test.ts
```

Expected: failure because the ledger does not exist yet.

- [ ] **Step 3: Create all 30 ledger rows**

Each row starts `NOT_VISITED`; prior observations may be placed in a separate
`historicalEvidence` column but must not be marked current.

- [ ] **Step 4: Run the focused test**

```bash
npx vitest run lib/national-life/read-coverage.test.ts
```

Expected: pass with 30 unique source keys.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/national-life-source-ledger-2026-08-20.md lib/national-life/read-coverage.ts lib/national-life/read-coverage.test.ts
git commit -m "docs: add National Life source evidence ledger"
```

### Task 3: Define the reconciliation worksheet and acceptance rules

**Files:**
- Create: `docs/operations/national-life-reconciliation-2026-08-20.md`
- Modify: `docs/operations/national-life-sync-runbook.md`

**Interfaces:**
- Consumes: source ledger keys and receipt fields from Prisma.
- Produces: per-source chain `portal -> raw -> normalized -> domain -> UI` and
  the exact evidence required to mark a source trustworthy.

- [ ] **Step 1: Add the reconciliation columns**

For every source record:

```text
portalTotal
filterState
receivedRaw
writtenNormalized
duplicateCount
rejectedCount
distinctBusinessKeys
promotedRows
visibleRows
freshnessAt
differenceReason
```

- [ ] **Step 2: Define pass/fail equations**

```text
receivedRaw == portalTotal
writtenNormalized + duplicateCount + rejectedCount == receivedRaw
promotedRows <= distinctBusinessKeys
visibleRows == promotedRows for domain surfaces
```

Any intentional exception must have a named reason and sample evidence.

- [ ] **Step 3: Add the sample matrix from the spec**

Include IUL, Term, Pending Lapse, Lapsed/Not Active, Action Required,
Recently Closed, documents, direct commission, override and unlinked commission.

- [ ] **Step 4: Review the runbook language**

Remove any wording that equates stage completion with product completeness.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/national-life-reconciliation-2026-08-20.md docs/operations/national-life-sync-runbook.md
git commit -m "docs: define National Life reconciliation gates"
```

### Task 4: Execute the read-only core portal sweep

**Files:**
- Modify: `docs/operations/national-life-source-ledger-2026-08-20.md`
- Modify: `docs/operations/national-life-reconciliation-2026-08-20.md`
- Modify: `docs/operations/national-life-portal-contract.md`

**Interfaces:**
- Consumes: reviewed ledger, worksheet and one authenticated tab.
- Produces: current evidence for Home, All Clients, Client Detail, Policy Detail,
  New Business, Recently Closed and Correspondence.

- [ ] **Step 1: Authenticate in one tab and prove portal state**

Record authenticated page title, route, timestamp and presence of profile/logout.
Do not record user names or credentials.

- [ ] **Step 2: Measure Home and All Clients**

Record dashboard benchmarks, default filters, column chooser options, maximum
page size, total entries, export controls and the shape of client/policy links.

- [ ] **Step 3: Measure the required policy samples**

For each sample record field labels from Policy, Values, Payments and Documents.
Do not copy customer values into docs.

- [ ] **Step 4: Measure New Business and detail surfaces**

Record columns, filters, totals, external ids, status, action-required,
requirements, communications and document controls.

- [ ] **Step 5: Reconcile observed totals with the latest raw/normalized receipts**

Do not trigger a sync in this task. Use the most recent completed data as a
comparison and label it stale if timestamps differ.

- [ ] **Step 6: Commit current evidence**

```bash
git add docs/operations/national-life-source-ledger-2026-08-20.md docs/operations/national-life-reconciliation-2026-08-20.md docs/operations/national-life-portal-contract.md
git commit -m "docs: record National Life core portal evidence"
```

### Task 5: Execute the read-only commission and report sweep

**Files:**
- Modify: `docs/operations/national-life-source-ledger-2026-08-20.md`
- Modify: `docs/operations/national-life-reconciliation-2026-08-20.md`
- Modify: `docs/operations/national-life-commissions-data.md`

**Interfaces:**
- Consumes: source ledger and the existing commission-detail worktree without changing it.
- Produces: proven period range, statement/detail relationship, chargeback
  contract, payee/writer mapping and dedupe decisions.

- [ ] **Step 1: Measure every commission date selector**

Record earliest/latest accepted dates, default range and whether historical
months load without writing anything.

- [ ] **Step 2: Measure overview, paid, earning, policy history, payable and pending**

Record field names, natural keys, totals and links to child detail.

- [ ] **Step 3: Measure one direct, one override and one unlinked policy row**

No personal values enter docs; record only join outcome and field presence.

- [ ] **Step 4: Measure chargeback statement and debt detail fields**

Navigation and reading only. Do not initiate a payment or carrier action.

- [ ] **Step 5: Close the three-level total equation**

Transaction detail must reconcile to statement/pay date and then to dashboard
for the same filter period.

- [ ] **Step 6: Commit evidence only**

```bash
git add docs/operations/national-life-source-ledger-2026-08-20.md docs/operations/national-life-reconciliation-2026-08-20.md docs/operations/national-life-commissions-data.md
git commit -m "docs: record National Life commission evidence"
```

### Task 6: Map Foresight Illustration without carrier writes

**Files:**
- Create: `docs/operations/national-life-foresight-contract-2026-08-20.md`
- Modify: `docs/operations/national-life-illustration-state-2026-08-18.md`
- Read: `lib/national-life/foresight-sync.ts`
- Read: `lib/national-life/portal-actions.ts`
- Read: `scripts/national-life-describe-foresight-services.ts`

**Interfaces:**
- Consumes: Illustration field/action contract from the spec.
- Produces: service list, payload shapes, case/report identity, PDF contract and
  exact write actions deferred for a separately approved test.

- [ ] **Step 1: Read static Foresight assets**

Map service names, method inputs, response shapes and post-response navigation
without invoking create/save/report/e-App methods.

- [ ] **Step 2: Read existing lists and existing cases**

Inventory Case List, Folder List, Unsaved Cases and Contact List. Opening an
existing case is navigation; creating or changing one remains prohibited.

- [ ] **Step 3: Map one existing case's read services**

Capture only field names and payload shapes for quick calc, insured information,
state, policy information and e-App status.

- [ ] **Step 4: Map existing report metadata and PDF retrieval**

Do not run a report. Read only already-generated artifacts.

- [ ] **Step 5: Classify every Foresight action**

The document must mark each as `READ_ONLY`, `NAVIGATION_ONLY`,
`GENERATES_CARRIER_ARTIFACT` or `WRITES_CARRIER_DRAFT` and state its confirmation gate.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/national-life-foresight-contract-2026-08-20.md docs/operations/national-life-illustration-state-2026-08-18.md
git commit -m "docs: define Foresight illustration contract"
```

### Task 7: Map iGO Application without creating a draft

**Files:**
- Create: `docs/operations/national-life-igo-contract-2026-08-20.md`
- Modify: `docs/architecture/national-life-igo-eapp.md`
- Read: `lib/national-life/connector-command-contract.ts`
- Read: `lib/national-life/portal-actions.ts`

**Interfaces:**
- Consumes: Application field/action contract from the spec.
- Produces: origins, sections, required/conditional fields, validation lists,
  draft boundary, upload boundary, submission boundary and post-submit reads.

- [ ] **Step 1: Read the complete static launcher implementation**

Determine the destination after `SetupEAppLauncher` without calling it.

- [ ] **Step 2: Inventory form sections and validation metadata read-only**

Record field labels, required flags, option codes and conditional dependencies.
Do not record customer values.

- [ ] **Step 3: Map the draft lifecycle**

Identify create, save, resume, review, upload and abandon boundaries without
executing them.

- [ ] **Step 4: Map the final submission boundary**

Identify the final control, payload/receipt shape and confirmation requirements.
Do not submit.

- [ ] **Step 5: Document sensitive-data policy decisions still required**

Include health data, identity, banking/payment, signatures, retention,
encryption, access and deletion.

- [ ] **Step 6: Commit**

```bash
git add docs/operations/national-life-igo-contract-2026-08-20.md docs/architecture/national-life-igo-eapp.md
git commit -m "docs: define iGO application contract"
```

### Task 8: Reconcile findings and split implementation projects

**Files:**
- Modify: `docs/superpowers/specs/2026-08-20-national-life-product-contract.md`
- Modify: `docs/operations/national-life-source-ledger-2026-08-20.md`
- Modify: `docs/operations/national-life-reconciliation-2026-08-20.md`
- Create: `docs/superpowers/plans/2026-08-20-national-life-domain-truth.md`
- Create: `docs/superpowers/plans/2026-08-20-national-life-policy-details-documents.md`
- Create: `docs/superpowers/plans/2026-08-20-national-life-commission-ledger.md`
- Create: `docs/superpowers/plans/2026-08-20-national-life-foresight-illustration.md`
- Create: `docs/superpowers/plans/2026-08-20-national-life-igo-draft.md`

**Interfaces:**
- Consumes: completed source ledger, reconciliation and both action contracts.
- Produces: five independent, testable implementation plans. Submission remains
  outside the iGO draft plan.

- [ ] **Step 1: Mark source states from evidence only**

No source can be `COUNT_RECONCILED` without both portal total and receipt chain.

- [ ] **Step 2: Produce the data precedence matrix**

For every duplicated field, name primary source, fallback source, freshness and
conflict behavior.

- [ ] **Step 3: Produce the schema-gap matrix**

Include nullable premium, person roles, policy values, native commission detail,
carrier documents, official Illustration and Application draft/receipt.

- [ ] **Step 4: Write the five implementation plans**

Each plan must have its own failing tests, migration boundaries, UI consumer,
verification gates and rollback-safe deployment order.

- [ ] **Step 5: Self-review all plans**

Run:

```bash
rg -n 'T[B]D|T[O]DO|implement[[:space:]]+later|similar[[:space:]]+to|appropriate[[:space:]]+error[[:space:]]+handling' docs/superpowers/plans/2026-08-20-national-life-*.md
```

Expected: no matches.

- [ ] **Step 6: Run documentation and catalogue checks**

```bash
npx vitest run lib/national-life/read-coverage.test.ts lib/national-life/acquisition-catalog.test.ts lib/national-life/portal-actions.test.ts
git diff --check
```

Expected: all tests pass; no whitespace errors.

- [ ] **Step 7: Commit the reviewed project split**

```bash
git add docs/superpowers/specs/2026-08-20-national-life-product-contract.md docs/operations/national-life-source-ledger-2026-08-20.md docs/operations/national-life-reconciliation-2026-08-20.md docs/superpowers/plans/2026-08-20-national-life-*.md
git commit -m "docs: split National Life delivery into verified projects"
```
