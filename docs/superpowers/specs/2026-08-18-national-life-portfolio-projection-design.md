# National Life portfolio projection — design

## Problem

Keepr One already has agent-facing pages (`/agent/policies`, `/agent/clients`)
reading from the canonical `Policy`/`Client` models. Those models already carry
`sourceProvider`/`sourceExternalId`/`sourceUpdatedAt` fields meant for
carrier-sourced data. But the only rows with `sourceProvider = 'NATIONAL_LIFE'`
today (9,614 policies, 8,824 clients) came from a **one-time manual CSV import
on 2026-07-30** (`lib/csv/import-service.ts`) — frozen in time.

Meanwhile the live KeeproneConnect sync (local browser connector) has been
running continuously and keeps `NationalLifeInforcePolicy` (19,382 rows, last
write 2026-08-18 00:07) and `NationalLifeCaseSnapshot` (1,638 New
Business/Recently Closed rows) fresh — but nothing reads those tables into the
models the UI actually renders. The two paths have never been connected.

Goal: every time a National Life sync run finishes, the fresh data lands in
`Policy`/`Client` automatically, so the existing pages show current data with
no new UI work.

## Non-goals (this design)

- **Commissions.** `PAID_COMMISSIONS` / `COMMISSIONS_EARNING_REPORT` rows are
  payee-level pay-run summaries, not per-policy line items — their dollar
  amounts sit inside unparsed HTML anchors (`<a href='...'>$0.00</a>`) with no
  numeric field and no policy reference. There is nothing safe to project into
  `CommissionTransaction` yet. This needs its own collector work first and is
  out of scope here.
- **`CLIENT_DETAIL` / `POLICY_DETAIL` on-demand collectors.** Redundant —
  `NationalLifeInforcePolicy` already carries full per-policy detail
  (cash value, addresses, phones) via the bulk export.
- New UI. `PoliciesList`/`ClientsList` already render whatever `Policy`/
  `Client` contain; this design only makes sure real rows get there.

## Data flow

```
NationalLifeConnectorRun reaches state=COMPLETED (local-connector/run-service.ts)
        │
        ▼
projectNationalLifePortfolio(agentId, deploymentScope)   [new: lib/national-life/portfolio-projection.ts]
        │
        ├─ reads NationalLifeInforcePolicy  (in-force + lapsed + pending-lapse policies)
        ├─ reads NationalLifeCaseSnapshot   (gridKey IN NEW_BUSINESS, RECENTLY_CLOSED)
        │
        ▼
   upsert Client  (keyed "<agentId>:<clientName>", same convention as import-service.ts)
        │
        ▼
   upsert Policy  (keyed by @@unique([sourceProvider, sourceExternalId]))
```

### Trigger point

`completeLocalConnectorStage` in `lib/national-life/local-connector/run-service.ts`
already computes `completed: boolean` (true exactly when the run transitions
to `COMPLETED`, after `terminal && failedGrids.length === 0`). The caller —
`app/api/agent/integrations/national-life/local-connector/runs/[runId]/stages/[gridKey]/complete/route.ts`
— gets that result today and just returns it. After the response is
built, when `completed === true`, call
`projectNationalLifePortfolio({ agentId, deploymentScope })`. Fire it after
the response, not inside the run-service transaction — projection is a
downstream concern and must not make the sync's own commit slower or
fail together with it. A projection failure is logged and does not fail the
sync run (the run already succeeded; projection can retry on the next run).

### Field mapping — `NationalLifeInforcePolicy` → `Policy`

| Policy field | Source |
|---|---|
| `policyNumber` | `policyNumber` |
| `carrier` | literal `"National Life"` |
| `product` | `productName` |
| `faceAmount` | not present on `NationalLifeInforcePolicy` today — leave unset only if the model requires a default; **flag during implementation**, `Policy.faceAmount` is non-nullable `Decimal`. If no reliable source column exists, use `0` and let `premiumIsKnown`-style guards in the UI treat `sourceProvider`-backed zero as "not supplied" (mirrors the existing premium pattern in `app/agent/policies/page.tsx`). |
| `premium` | `anticipatedAnnualPremium`, parsed from the `"$1,234.56"`-style text column |
| `status` | mapped from `policyStatus` (see below) |
| `effectiveDate` | `policyIssueDate` |
| `lastPaymentDate` | not available on this table — leave `null` |
| `statusChangedAt` | `lastStatusChangeDate` |
| `sourceProvider` | `"NATIONAL_LIFE"` |
| `sourceExternalId` | `policyNumber` |
| `sourceUpdatedAt` | `fetchedAt` |

`policyStatus` → `PolicyStatus` enum mapping:

| National Life value | `PolicyStatus` |
|---|---|
| `Active` | `INFORCE` |
| `Issued` | `APPROVED` |
| `Lapsed` | `LAPSED` |
| `Pending Lapse` | `LAPSED` (closest existing state; no PENDING_LAPSE enum value) |
| `Not Active` | `CANCELLED` |
| anything else / unrecognized | **skip the row**, do not guess |

**Known data quality issue to filter, not map:** two junk rows were found in
production with `policyStatus` values `"Exported By: Novaes, Beatriz Moraes"`
and `"Exported On: 08/17/2026"` — export-footer text that leaked into the grid
as if it were a data row. The projector must reject any row whose
`policyStatus` doesn't match the table above (the "skip unrecognized" rule
above already covers this), and this should be logged distinctly so it's
visible if the raw-ingest layer needs a real fix instead of a downstream
workaround.

### Client mapping

- Match key: `insuredClientName` (fall back to `ownerClientName` when insured
  is blank), assigned to `assignedAgentId = agentId`.
- `email`: `insuredEmail` (fallback `ownerEmail`).
- `phone`: `insuredPhoneNumber` (fallback `ownerPhoneNumber`).
- Same upsert-by-derived-id convention as `import-service.ts`
  (`id: "${agentId}:${clientName}"`) so re-running the projector never
  duplicates a client.

### New Business / Recently Closed (`NationalLifeCaseSnapshot`)

Same target (`Policy`), same upsert key. `status` is fixed per grid
(`RECENTLY_CLOSED` → carrier status text needs the same mapping table above,
applied to `carrierStatus`; `NEW_BUSINESS` rows in flight map to `PENDING`
unless `carrierStatus` says otherwise). `policyNo` is the sourceExternalId.
Field coverage is thinner here (no cash value, no full address) — that's
fine, `NationalLifeInforcePolicy` will supersede a case snapshot's row once
the policy goes in-force and the same `policyNumber` reappears there.

### Conflict rule

Carrier data never overwrites a manually-entered policy. Concretely: if a
`Policy` row already exists with the same `policyNumber` but a different
`sourceProvider` (i.e. `MANUAL_IMPORT` or `null`), the projector skips it —
`policyNumber` is globally unique, so there is no way to have both a manual
and a carrier row for the same number, and manual data wins. This mirrors how
carrier sync is described elsewhere in the codebase memory: automation
augments, it doesn't overwrite an agent's own record-keeping.

### Idempotency

Before writing, compare the incoming `fetchedAt` against the existing row's
`sourceUpdatedAt`. Skip the upsert when the incoming value is not newer —
running the projector twice for the same sync (e.g. a retried API call) must
not cause needless writes or bump `updatedAt`/audit timestamps.

## Error handling

- Malformed/unmappable source rows (bad status, missing policy number) are
  skipped individually and counted; one bad row must not abort the whole
  projection.
- The projector returns a summary (`{ policiesUpserted, policiesSkipped,
  clientsUpserted }`) that gets logged. No new DB table for run history in
  this design — `console.error`/structured log is enough; this isn't a
  user-facing status yet.
- If the projector throws, it's caught at the call site (post-sync hook) and
  logged — it must never surface as a sync failure to the agent, since the
  sync itself already succeeded.

## Testing

- Unit tests for the status-mapping function (table above, including the two
  known junk values and an unrecognized value).
- Unit tests for the upsert logic against a fake Prisma client covering:
  new policy insert, existing carrier policy update (newer `fetchedAt`),
  existing carrier policy no-op (same/older `fetchedAt`), existing manual
  policy skip.
- An integration-style test seeding `NationalLifeInforcePolicy` rows and
  asserting the resulting `Policy`/`Client` rows, run against the test DB
  used by the rest of `lib/national-life/*.test.ts`.

## Rollout

No backfill migration needed as a separate step — the next time the agent's
KeeproneConnect completes a full sync (which happens routinely), the
projector runs and upserts against the full current `NationalLifeInforcePolicy`
table, which already covers all 19,382 rows. A one-off manual invocation
against the already-synced data is also fine to unstick this immediately
without waiting for the next automatic run.
