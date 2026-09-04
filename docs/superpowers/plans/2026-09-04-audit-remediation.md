# Keepr One Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the production defects and correctness gaps identified in the 4 September 2026 Keepr One main-branch audit, while preserving verified carrier, finance, and human-MFA boundaries.

**Architecture:** Fix each defect at its source of truth: calendar source selection and display contract, reconciled portfolio/ledger reads, retry-safe Stripe requests, and server-side pagination. Keep external actions fail-closed and do not fabricate missing financial or carrier data. Migration is allowed only if an existing persisted invariant cannot represent the repaired behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Prisma/PostgreSQL, Stripe SDK, Google Calendar API.

**Spec:** `/Users/pauloloureiro/.codex/visualizations/2026/09/04/01a06cde-a91c-7f20-a6cc-1438e25a5310/auditoria-keeprone/AUDITORIA-KEEPRONE-MAIN-2026-09-04.md`

## Global Constraints

- Base branch is `origin/main` commit `1a71ad4709440a2c157a0b66a52464693b497365`; do not touch the user's dirty checkout.
- Do not run a carrier sync, create an iGO application, create a booking, charge a card, send a message, or alter production data while implementing.
- MFA remains human-controlled; no fix may turn K-Bot into an autonomous carrier submitter.
- AAP remains anticipated annual premium; do not label it as paid commission, paid premium, or Target Premium.
- Do not turn a partial source into a complete-looking financial or portfolio total.
- Every behavior change gets a failing regression test before production code and targeted tests after it.
- Keep one authoritative definition for each repaired screen; do not duplicate a reconciliation rule in a component.
- Upgrade only to the current patched Next.js Active LTS security floor supported by this application and verify the installed version with the build and production-dependency audit.

---

### Task 1: Repair public scheduling readiness and calendar time-zone contract

**Files:**
- Modify: `lib/calendar/google/freebusy.ts`, `lib/scheduling/availability.ts`, `lib/scheduling/readiness.ts`
- Modify: `components/calendar/server-adapter.ts`, `components/calendar/CalendarEventCard.tsx`, `components/calendar/CalendarEventModal.tsx`, `components/calendar/CalendarWorkspace.tsx`
- Test: `lib/calendar/google/freebusy.test.ts`, `lib/scheduling/availability.test.ts`, `lib/scheduling/readiness.test.ts`, calendar component tests nearest to the changed components

**Interfaces:**
- Consumes `CalendarSource.providerCalendarId`, `visible`, `crmDefault`, `accessRole`, the Google FreeBusy response, and the account display time zone.
- Produces public slot availability that ignores only recognized Google system calendar IDs ending in `@group.v.calendar.google.com` and remains fail-closed for a selected real conflict calendar that cannot be queried.
- Produces one account-display time zone for grid, card, and modal; event source time zone remains stored as provenance.

- [x] **Step 1: Write failing tests for recognized holiday calendars and real conflict calendar errors.**

```ts
it('does not submit a Google holiday calendar to FreeBusy', async () => {
  const result = await getGoogleFreeBusyForUser(input, env, { db, fetch })
  expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    body: expect.not.stringContaining('#holiday@group.v.calendar.google.com'),
  }))
  expect(result.connected).toBe(true)
})

it('rejects availability when a selected non-system calendar returns an error', async () => {
  await expect(getPublicSchedulingAvailability(input, deps)).rejects.toMatchObject({
    code: 'SCHEDULING_UNAVAILABLE',
  })
})
```

- [x] **Step 2: Run the calendar tests and verify the holiday test fails because the current request includes that calendar.**

Run: `pnpm vitest run lib/calendar/google/freebusy.test.ts lib/scheduling/availability.test.ts lib/scheduling/readiness.test.ts`

Expected: the holiday case fails before the implementation change; existing real-calendar error tests remain meaningful.

- [x] **Step 3: Implement a narrow system-calendar predicate and use it before building FreeBusy batches.**

```ts
export function isGoogleSystemCalendarId(providerCalendarId: string) {
  return /@group\.v\.calendar\.google\.com$/i.test(providerCalendarId)
}

const conflictCalendars = integration.calendars.filter(
  (calendar) => !isGoogleSystemCalendarId(calendar.providerCalendarId),
)
```

Only recognized Google system IDs are excluded. If no non-system conflict calendar remains, return disconnected/unavailable. Preserve the current error handling for every remaining selected calendar. Events already synchronized from excluded sources remain local busy intervals; this prevents the hotfix from treating an existing local event as free.

- [x] **Step 4: Write a failing UI/server-adapter test for a São Paulo event displayed by a New York account.**

```ts
expect(formatCalendarEventTime(event, 'America/New_York')).toContain('12:00')
expect(formatCalendarEventTime(event, 'America/Sao_Paulo')).toContain('13:00')
```

The public UI expectation is the account display time zone, so card, modal and grid must assert `12:00` for this fixture.

- [x] **Step 5: Pass the account display time zone through the view model and format all human-facing event times with it.**

Keep `event.timeZone` as source provenance. Do not mutate `startsAt`/`endsAt`. Add an optional `displayTimeZone` to event cards and pass the account time zone from all workspace/today/upcoming/case callers; modal detail labels use its existing account `timeZone` prop. Do not change all-day semantics or event instants during edit.

- [x] **Step 6: Run targeted tests and commit.**

Run: `pnpm vitest run lib/calendar/google/freebusy.test.ts lib/scheduling/availability.test.ts lib/scheduling/readiness.test.ts components/calendar`

Expected: all selected tests pass, including the system-calendar and cross-time-zone regressions.

- [x] **Step 7: Commit.**

```bash
git add lib/calendar components/calendar
git commit -m "fix: restore public scheduling availability and timezone consistency"
```

### Task 2: Make portfolio and commission data canonical, idempotent, and recoverable

**Files:**
- Modify: `app/agent/policies/page.tsx`, the existing current-portfolio query/service under `lib/national-life/`
- Modify: `lib/csv/import-service.ts`, `lib/csv/schemas.ts`
- Modify: `app/admin/production/page.tsx`, and extract a focused production-read service if that avoids repeating carrier parsing
- Test: `lib/csv/import-service.test.ts`, `lib/csv/schemas.test.ts` if absent, policy-page/current-portfolio tests, admin production tests

**Interfaces:**
- Consumes the reconciled current National Life portfolio for visible current counts and explicit historical policy records for history-only views. A current snapshot with no local `Policy` remains visible as an explicitly sourced, non-clickable row rather than being dropped to force a total match.
- Consumes commission rows with optional provider transaction IDs and produces immutable ledger rows plus legacy aggregate rows whose totals equal the ledger total for the same direct/override semantics.
- Produces a terminal `ImportBatch` state for malformed, row-invalid, and database-failed data without a partially written row.

- [x] **Step 1: Write failing tests that compare the same reconciled portfolio scope in Today and Apólices.**

```ts
expect(policyListSummary.current.total).toBe(todayMetrics.total)
expect(policyListSummary.current.byStatus.INFORCE).toBe(todayMetrics.byStatus.INFORCE)
expect(policyListSummary.history.total).toBeGreaterThanOrEqual(policyListSummary.current.total)
```

The UI must label historical rows as history rather than silently mixing them into “current”.

- [x] **Step 2: Write failing commission import tests for payment aggregation, renamed-file idempotency, invalid dates/months, and row rollback.**

```ts
await importCommissions(twoPaymentsCsv, uploader, 'payments.csv')
expect(await directAggregate(policy, agent, '2026-09')).toEqual(150)

await importCommissions(twoPaymentsCsv, uploader, 'renamed.csv')
expect(await ledgerTotal(policy, agent, '2026-09')).toEqual(150)

expect(CommissionRowSchema.safeParse({ ...row, period: '2026-13' }).success).toBe(false)
expect(PolicyRowSchema.safeParse({ ...policyRow, effectiveDate: 'not-a-date' }).success).toBe(false)
```

Use a simulated transaction failure after one row write and assert that row has no persisted ledger/aggregate effects and that the batch becomes `COMPLETED_WITH_ERRORS` or `FAILED`, never remains `PROCESSING`.

- [x] **Step 3: Implement deterministic fallback source identity and per-row atomic import.**

For a missing carrier transaction ID, derive identity from normalized financial content plus an occurrence index among identical normalized rows in the parsed file; never use filename or original row order. Read the existing ledger transaction inside the row transaction, compute its amount delta, upsert it, and increment/decrement the direct and override aggregates by the change in its signed financial effect. `PAID` credits its absolute amount, `CHARGEBACK` debits its absolute amount, `ADJUSTMENT` carries its supplied sign, and `EXPECTED` remains in the ledger but contributes zero to the realized-commission aggregate. Preserve an explicit carrier transaction ID unchanged. A changed amount with no explicit origin ID is an ambiguous new transaction, not an inferred correction; surface that limitation in import feedback rather than silently merging money.

```ts
const previous = await tx.commissionTransaction.findUnique({ where: sourceKey })
const delta = row.amount - Number(previous?.amount ?? 0)
await tx.commissionTransaction.upsert(/* source identity */)
await incrementCommissionAggregate(tx, directKey, delta)
```

Validate ISO dates and real calendar months before database access. Catch unexpected row failures, record a non-sensitive row error, and complete the batch state in a `finally`-equivalent path.

- [x] **Step 4: Implement one current portfolio projection for the policy list and explicitly expose history.**

The default list and summary must consume the same reconciled current set as Today. If historical records are shown, use a deliberate history filter/section and label its totals. Do not discard source status such as Pending Lapse.

- [x] **Step 5: Make administrative production consume a documented carrier/reconciled source.**

Build a dedicated global production reader from canonical National Life commission rows: canonicalize, audit, deduplicate globally by earning identity, and map direct production through `WritingAgtNumber -> Agent.npn`. Do not reuse a connector-owner view that duplicates team rows. Keep override out of direct-production ranking and never silently assign a row with no matching NPN. Keep legacy `CommissionRecord` only as an intentional disclosed fallback where no carrier source exists; never add it to the same carrier total. Define policy production period by UTC `effectiveDate`; rows without that business date belong in visible coverage, not in the month of import.

- [x] **Step 6: Run focused financial tests and commit.**

Run: `pnpm vitest run lib/csv app/agent/policies app/admin/production app/agent/commissions lib/national-life/current-portfolio*`

Expected: regression tests pass; previous imports with explicit source IDs retain their identity.

- [x] **Step 7: Commit.**

```bash
git add app/agent/policies app/admin/production lib/csv lib/national-life
git commit -m "fix: reconcile portfolio and commission reporting"
```

### Task 3: Repair checkout retries, upload transport limits, and the known Next.js security floor

**Files:**
- Modify: `app/api/billing/checkout/route.ts`, `app/api/billing/checkout/route.test.ts`
- Modify: `app/api/billing/application-addon/checkout/route.ts`, `app/api/billing/application-addon/checkout/route.test.ts`
- Modify: `next.config.ts`, `package.json`, `pnpm-lock.yaml`
- Test: the two checkout route tests and a focused config/size regression test if an existing config test pattern supports it

**Interfaces:**
- Same logical checkout attempt sends byte-identical Stripe creation parameters for a reused idempotency key; the optional random `integration_identifier` is removed because no application behavior consumes it.
- A new logical checkout attempt has a new key; no retry must create a charge or entitlement before Stripe confirms it.
- The application accepts an uploaded 10 MiB file plus multipart overhead while rejecting an oversized file with the existing friendly validation.

- [ ] **Step 1: Write failing retry tests for both checkout routes.**

```ts
await POST(request)
await POST(request)
const [firstParams, firstOptions] = createCheckout.mock.calls[0]
const [secondParams, secondOptions] = createCheckout.mock.calls[1]
expect(secondOptions.idempotencyKey).toBe(firstOptions.idempotencyKey)
expect(secondParams).toEqual(firstParams)
```

- [ ] **Step 2: Run those tests and confirm they fail because `integration_identifier` is random on each retry.**

Run: `pnpm vitest run app/api/billing/checkout/route.test.ts app/api/billing/application-addon/checkout/route.test.ts`

- [ ] **Step 3: Build Stripe parameters deterministically from the persisted local subscription/add-on identity.**

Remove the random value or replace it with a stable, documented identifier derived from the persisted local ID. Keep the existing time-window idempotency key only if all parameters inside that window are stable. Apply the same rule to the invitation checkout helper when it can retry with the same key.

- [ ] **Step 4: Add the Server Action body size configuration and regression assertion.**

```ts
experimental: {
  cpus: 2,
  serverActions: { bodySizeLimit: '12mb' },
},
```

The 12 MiB transport limit intentionally accommodates multipart overhead above the 10 MiB product limit; it is not a new product upload limit.

- [ ] **Step 5: Upgrade Next.js and matching Next ESLint package to the current 16.3.3 Active LTS security floor.**

Run `pnpm up next@16.3.3 eslint-config-next@16.3.3` only after the test changes are green. Do not use an unbounded major-version upgrade.

- [ ] **Step 6: Run checkout tests, typecheck, build, and production dependency audit.**

Run: `pnpm vitest run app/api/billing/checkout/route.test.ts app/api/billing/application-addon/checkout/route.test.ts && pnpm exec tsc --noEmit --incremental false && pnpm build && pnpm audit --prod`

Expected: retry tests pass, build succeeds, and the installed Next version is no longer in the audited advisory range.

- [ ] **Step 7: Commit.**

```bash
git add app/api/billing next.config.ts package.json pnpm-lock.yaml
git commit -m "fix: make checkout retries stable and align upload limits"
```

### Task 4: Make support preview read-only and expired sessions recover to login

**Files:**
- Modify: `proxy.ts`, `lib/require-role.ts`, `app/agent/layout.tsx`
- Modify: `app/agent/mensagens/page.tsx`, `lib/crm/pipeline.ts`, callers in `app/agent/cases/page.tsx` and `app/agent/cases/[id]/page.tsx`
- Test: `lib/require-role.test.ts`, new/nearest proxy tests, messaging page tests, CRM pipeline tests, agent layout tests

**Interfaces:**
- A support-preview GET can read existing resources but must not create a Chatwoot account, pipeline, stages, or backfill data.
- A valid normal user retains lazy setup behavior where the product needs it.
- A stale or invalid session reaches `/login` with a safe next destination, while forbidden and commercial-gate errors retain their current distinct handling.

- [ ] **Step 1: Write failing tests that demonstrate preview-safe reads.**

```ts
await renderMensagensPage({ impersonatedBy: 'admin-1', messagingAccount: null })
expect(provisionAgentInbox).not.toHaveBeenCalled()

await getPipelineForAgent('agent-1', db, { allowInitialization: false })
expect(db.crmPipeline.upsert).not.toHaveBeenCalled()
```

- [ ] **Step 2: Write a failing layout test for the authentication-specific error.**

```ts
await expect(renderAgentLayoutWithNoSession()).rejects.toMatchObject({
  digest: expect.any(String),
})
expect(redirect).toHaveBeenCalledWith('/login?next=%2Fagent')
```

Use the project’s existing Next redirect mocking pattern; do not encode an arbitrary Error string as the public contract.

- [ ] **Step 3: Introduce a typed authentication error and a read-only-preview signal.**

`requireRole` throws `UnauthenticatedError` only when session is absent. The agent layout catches that type and redirects to login. Read-only preview is determined from the authenticated session and passed explicitly to mutation-prone page/service calls, rather than treating every GET as harmless.

- [ ] **Step 4: Split CRM read from CRM initialization and gate messaging provisioning.**

Add an explicit `allowInitialization` option with default `true` for normal product use. Preview callers pass `false`; if no pipeline/inbox exists, return a non-mutating empty/not-configured state that the UI explains. Do not silently create a resource from a preview.

- [ ] **Step 5: Run focused tests and commit.**

Run: `pnpm vitest run lib/require-role.test.ts lib/crm app/agent/mensagens app/agent/cases proxy.test.ts`

Expected: preview has no writes; normal account setup behavior remains covered; no-session route redirects to login.

- [ ] **Step 6: Commit.**

```bash
git add proxy.ts lib/require-role.ts lib/crm app/agent/layout.tsx app/agent/mensagens app/agent/cases
git commit -m "fix: preserve read-only preview and session recovery"
```

### Task 5: Replace silent list truncation and client-side whole-base pagination

**Files:**
- Modify: `app/agent/policies/page.tsx`, `app/agent/policies/PoliciesList.tsx`
- Modify: `app/agent/clients/page.tsx`, `app/agent/clients/ClientsList.tsx`
- Modify: `app/agent/illustrations/page.tsx`; either wire `IllustrationsWorkspace.tsx` as the canonical surface or remove it only after preserving its useful behavior in the active page
- Test: `app/agent/policies/PoliciesList.test.tsx`, new/nearest page query tests, client-list tests, illustration page tests

**Interfaces:**
- List query parameters are validated server-side: `page`, text query, status/filter, owner, and sort only accept known bounded values.
- Server returns `items`, `total`, page metadata and aggregates for the same filter; clients render only that page.
- Illustration history is discoverable beyond 100 records, with visible pagination/total and no unlabelled hard cap.

- [ ] **Step 1: Write failing page/query tests for scoped server pagination.**

```ts
expect(prisma.policy.findMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ agentId: { in: ['agent-1'] } }),
  take: 25,
  skip: 25,
}))
expect(screen.getByText('26–50 de 9.939')).toBeInTheDocument()
```

Write equivalent client and illustration cases; include invalid page/filter values falling back to page 1/default rather than reaching Prisma unvalidated.

- [ ] **Step 2: Run the list tests and confirm the existing pages load all records before applying `slice`.**

Run: `pnpm vitest run app/agent/policies/PoliciesList.test.tsx app/agent/clients app/agent/illustrations`

- [ ] **Step 3: Move filters, sorting, counts, and pagination to page-level queries.**

Use a shared bounded page size per list, `Promise.all` for count and rows, and precise selects. Preserve current client-side interactions through GET form controls or router-backed search parameters. Do not fetch every row merely to calculate a display count.

- [ ] **Step 4: Make the active illustration page paginate the complete history.**

Remove `take: 100` only as part of a real paginated query. Use the active table or wire the workspace deliberately; do not leave a second unused implementation. Existing detail, PDF, and application-start links must remain scoped to the agent.

- [ ] **Step 5: Run focused UI/page tests and commit.**

Run: `pnpm vitest run app/agent/policies app/agent/clients app/agent/illustrations`

Expected: page two does not receive page one’s full dataset, filters preserve scope, and the 101st illustration can be reached through the normal UI.

- [ ] **Step 6: Commit.**

```bash
git add app/agent/policies app/agent/clients app/agent/illustrations
git commit -m "fix: paginate portfolio, clients, and illustration history"
```

### Task 6: Update operational documentation and perform full integration verification

**Files:**
- Modify: `README.md` and the relevant operations runbook under `docs/operations/`
- Test/verify: full application and extension suite, lint, typecheck, build, dependency audit, static route checker, and a read-only production verification after deployment is separately approved

**Interfaces:**
- Documentation accurately describes the protected optional credential vault, current deployment topology at a high level without secrets, public booking readiness, data-source semantics, and the required carrier smoke sequence.

- [ ] **Step 1: Write documentation assertions/checklist before changing documentation.**

```md
- [ ] States that carrier credentials are optional, encrypted, and human MFA remains required.
- [ ] Separates current reconciled portfolio from historical policy records.
- [ ] Requires public scheduling slot verification before calling a link published.
- [ ] States that a green build/healthcheck does not prove carrier or billing completion.
```

- [ ] **Step 2: Update the docs to meet every checklist item without including credentials, customer data, host secrets, or an instruction to bypass MFA.**

- [ ] **Step 3: Run complete fresh verification.**

Run:

```bash
pnpm test
pnpm connector:typecheck
pnpm connector:test
pnpm connector:build
pnpm lint
pnpm exec tsc --noEmit --incremental false
pnpm build
pnpm audit --prod
```

Also run the static route/link checker from the audit evidence against the changed source. Review the final diff for accidental secrets and verify `git status --short` contains only this branch’s intentional changes.

- [ ] **Step 4: Commit.**

```bash
git add README.md docs/operations docs/superpowers/plans
git commit -m "docs: align operations guidance with audited behavior"
```

## Plan self-review

| Audit requirement | Task |
|---|---|
| A01 public scheduling | 1 |
| A02 time-zone consistency | 1 |
| A03 current versus historical portfolio | 2 |
| A04 CSV integrity, validation and partial failures | 2 |
| A05 checkout retry | 3 |
| A06 upload transport size | 3 |
| A07 patched Next floor | 3 |
| A08 production financial source | 2 |
| A09 support preview mutations | 4 |
| A10 stale session recovery | 4 |
| A11 server-side pagination | 5 |
| A12 illustration history cap | 5 |
| Documentation/runtime truth | 6 |

No requirement is intentionally deferred. The only actions intentionally outside this plan are production deployment, real carrier work, payment creation, booking creation, and message delivery; those require a reviewed branch and, for carrier/payment actions, a deliberate authorized smoke.
