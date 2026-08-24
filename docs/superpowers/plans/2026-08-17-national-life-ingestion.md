# National Life Portfolio Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the National Life sync write the agent's real book into `Client` and `Policy`, replacing a stale one-off CSV import whose face amount is `0.00` on all 9,614 rows.

**Architecture:** Pure planning functions produce a plan; a thin caller applies it with Prisma. This mirrors `lib/national-life/local-connector/raw-ingest.ts`, whose docstring states the rule: *"Pure: the caller owns the write."* Reconciliation reads only what the sync already stored in `NationalLifeInforcePolicy` — it never touches the portal, so it is testable without a browser and re-runnable without network cost.

**Tech Stack:** TypeScript, Prisma (PostgreSQL), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-17-national-life-ingestion-design.md`

## Global Constraints

- `faceAmount` must never be written as `0` to mean "unknown". Unknown is `null`. (Spec D1)
- Client matching keys on `(assignedAgentId, normalized name, dateOfBirth)` and never crosses agents. On ambiguity, create a new `Client` and record it as low confidence — never merge. (Spec D6, D7 risk section)
- Ingestion never deletes. A policy absent from the export is not deleted. (Spec §4)
- Policy upsert key is `('NATIONAL_LIFE', policyNumber)` via the existing `@@unique([sourceProvider, sourceExternalId])`. Existing rows are corrected in place. (Spec D5)
- Do not create `Prospect` or `InsuranceCase`. (Spec §6)
- Scope precedence is by role, not by deployment name: `LOCAL_CONNECTOR` is the official-export slice; any other `deploymentScope` value is the legacy grid slice. Never hardcode `keepr-one-production-v1`.

---

### Task 1: Let `faceAmount` be unknown

Today `Policy.faceAmount` is a required `Decimal`, which is why the CSV import wrote `0` on every row. `0` is not "unknown" — it is a wrong number any screen can sum and display. This task makes unknown representable and clears the existing placeholder.

**Files:**
- Modify: `prisma/schema.prisma` (model `Policy`)
- Create: `prisma/migrations/20260818000000_policy_face_amount_nullable/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `Policy.faceAmount: Decimal?` and `Policy.sourceStatus: String?`, relied on by Tasks 4 and 5.

- [ ] **Step 1: Relax the column and add the carrier's own status**

In `prisma/schema.prisma`, model `Policy`, change `faceAmount  Decimal` to:

```prisma
  // Null means "not known yet", not zero. Face amount is absent from all 33
  // columns of the carrier's official export and exists only on the per-policy
  // detail page, so it arrives by backfill, long after the row itself. The
  // previous required column is why the CSV import wrote 0.00 on all 9,614
  // rows — a wrong number is worse than a missing one.
  faceAmount       Decimal?
  // The carrier's own status string, kept beside the mapped enum. PolicyStatus
  // has no "Pending Lapse", and that is precisely the status worth acting on,
  // so mapping it to INFORCE alone would erase the signal.
  sourceStatus     String?
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260818000000_policy_face_amount_nullable/migration.sql`:

```sql
ALTER TABLE "Policy" ALTER COLUMN "faceAmount" DROP NOT NULL;
ALTER TABLE "Policy" ADD COLUMN "sourceStatus" TEXT;

-- The CSV import satisfied the old NOT NULL with a placeholder. Those zeros are
-- not measurements: no in-force life policy has a face amount of zero. Narrowed
-- to National Life rows so a genuine zero from another source is left alone.
UPDATE "Policy"
SET "faceAmount" = NULL
WHERE "sourceProvider" = 'NATIONAL_LIFE' AND "faceAmount" = 0;
```

- [ ] **Step 3: Verify the client regenerates and the tree still typechecks**

Run: `npx prisma generate && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0. If a call site now fails because `faceAmount` may be null, fix that call site to handle null rather than defaulting to `0` — defaulting reintroduces the bug this task removes.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "Let Policy.faceAmount be unknown instead of zero"
```

---

### Task 2: Reconcile the two slices into one policy view

`NationalLifeInforcePolicy` holds two disjoint slices. The official export carries premium, address and contact but **no date of birth**; the legacy grid carries date of birth and **no premium**. Neither is sufficient alone.

**Files:**
- Create: `lib/national-life/portfolio-reconcile.ts`
- Test: `lib/national-life/portfolio-reconcile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type InforceRow`, `type ReconciledPolicy`, `function reconcileInforceRows(rows: InforceRow[]): ReconcileResult`, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `lib/national-life/portfolio-reconcile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reconcileInforceRows, type InforceRow } from './portfolio-reconcile'

function row(overrides: Partial<InforceRow>): InforceRow {
  return {
    deploymentScope: 'LOCAL_CONNECTOR',
    policyNumber: 'LS1',
    policyStatus: 'Active',
    policyIssueDate: '06/02/2023',
    productName: 'Indexed Universal Life',
    insuredClientName: 'ENRICO ABDALLA',
    insuredDob: null,
    insuredEmail: null,
    insuredPhoneNumber: null,
    insuredZipcode: null,
    ownerClientName: 'ENRICO ABDALLA',
    anticipatedAnnualPremium: null,
    ...overrides,
  }
}

describe('reconcileInforceRows', () => {
  it('takes premium from the export slice and date of birth from the legacy slice', () => {
    const { policies } = reconcileInforceRows([
      row({ deploymentScope: 'LOCAL_CONNECTOR', anticipatedAnnualPremium: '1200.00' }),
      row({ deploymentScope: 'keepr-one-production-v1', insuredDob: '01/15/1980' }),
    ])

    expect(policies).toHaveLength(1)
    expect(policies[0]?.premium).toBe(1200)
    expect(policies[0]?.insuredDateOfBirth).toEqual(new Date(Date.UTC(1980, 0, 15)))
  })

  it('treats any scope other than LOCAL_CONNECTOR as the legacy grid slice', () => {
    // The legacy scope is a deployment name and will change. Precedence must key
    // on the role of the slice, never on that string.
    const { policies } = reconcileInforceRows([
      row({ deploymentScope: 'some-future-deployment', insuredDob: '01/15/1980' }),
      row({ deploymentScope: 'LOCAL_CONNECTOR', anticipatedAnnualPremium: '900' }),
    ])

    expect(policies[0]?.premium).toBe(900)
    expect(policies[0]?.insuredDateOfBirth).toEqual(new Date(Date.UTC(1980, 0, 15)))
  })

  it('discards the export footer rows instead of ingesting them as policies', () => {
    // The XLSX trailer arrives as data: two rows whose status is the export
    // banner. Ingested blind, they become a client named "Exported By".
    const { policies, discarded } = reconcileInforceRows([
      row({ policyNumber: '', policyStatus: 'Exported On: 08/17/2026' }),
      row({ policyNumber: 'LS1' }),
    ])

    expect(policies.map((p) => p.policyNumber)).toEqual(['LS1'])
    expect(discarded).toEqual([{ reason: 'MISSING_POLICY_NUMBER', policyStatus: 'Exported On: 08/17/2026' }])
  })

  it('maps carrier statuses to the enum while keeping the carrier string', () => {
    const { policies } = reconcileInforceRows([row({ policyStatus: 'Pending Lapse' })])

    expect(policies[0]?.status).toBe('INFORCE')
    expect(policies[0]?.sourceStatus).toBe('Pending Lapse')
  })

  it('maps every status the live book contains', () => {
    const cases: [string, string][] = [
      ['Active', 'INFORCE'],
      ['Issued', 'APPROVED'],
      ['Pending Lapse', 'INFORCE'],
      ['Lapsed', 'LAPSED'],
      ['Not Active', 'CANCELLED'],
    ]
    for (const [carrier, expected] of cases) {
      const { policies } = reconcileInforceRows([row({ policyStatus: carrier })])
      expect(policies[0]?.status, carrier).toBe(expected)
    }
  })

  it('never invents a premium or a date of birth that no slice carried', () => {
    const { policies } = reconcileInforceRows([row({})])

    expect(policies[0]?.premium).toBeNull()
    expect(policies[0]?.insuredDateOfBirth).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/national-life/portfolio-reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "./portfolio-reconcile"`.

- [ ] **Step 3: Implement the module**

Create `lib/national-life/portfolio-reconcile.ts`:

```ts
/// The carrier's book reaches us in two disjoint slices and neither is complete.
/// The official export carries premium, address and contact but no date of birth;
/// the legacy grid carries date of birth and no premium. Reconciling is therefore
/// per field, not per slice — there is no winning source, only a winning value.

const EXPORT_SCOPE = 'LOCAL_CONNECTOR'

export type InforceRow = {
  deploymentScope: string
  policyNumber: string
  policyStatus: string | null
  policyIssueDate: string | null
  productName: string | null
  insuredClientName: string | null
  insuredDob: string | null
  insuredEmail: string | null
  insuredPhoneNumber: string | null
  insuredZipcode: string | null
  ownerClientName: string | null
  anticipatedAnnualPremium: string | null
}

export type PolicyStatusName = 'PENDING' | 'APPROVED' | 'INFORCE' | 'LAPSED' | 'CANCELLED'

export type ReconciledPolicy = {
  policyNumber: string
  status: PolicyStatusName
  sourceStatus: string | null
  productName: string | null
  issueDate: Date | null
  premium: number | null
  insuredName: string | null
  insuredDateOfBirth: Date | null
  insuredEmail: string | null
  insuredPhone: string | null
  ownerName: string | null
}

export type DiscardedRow = { reason: 'MISSING_POLICY_NUMBER'; policyStatus: string | null }

export type ReconcileResult = { policies: ReconciledPolicy[]; discarded: DiscardedRow[] }

/// `Pending Lapse` has no home in PolicyStatus, and it is the one status with money
/// still recoverable behind it. It maps to INFORCE so the policy reads as live, and
/// `sourceStatus` keeps the carrier's own word so the signal survives.
const STATUS_BY_CARRIER_LABEL: Record<string, PolicyStatusName> = {
  active: 'INFORCE',
  issued: 'APPROVED',
  'pending lapse': 'INFORCE',
  lapsed: 'LAPSED',
  'not active': 'CANCELLED',
}

function mapStatus(carrier: string | null): PolicyStatusName {
  return STATUS_BY_CARRIER_LABEL[(carrier ?? '').trim().toLowerCase()] ?? 'PENDING'
}

/// The carrier writes dates as MM/DD/YYYY. Parsed into UTC so a birthday does not
/// drift a day for an agent in a negative offset.
function parseCarrierDate(value: string | null): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? '').trim())
  if (!match) return null
  const [, month, day, year] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  return Number.isNaN(date.getTime()) ? null : date
}

function parseMoney(value: string | null): number | null {
  const cleaned = (value ?? '').replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const amount = Number(cleaned)
  return Number.isFinite(amount) ? amount : null
}

function text(value: string | null): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

/// `??` rather than `||` throughout: a legitimately empty value must not be
/// overwritten by a later slice just because it is falsy.
function coalesce<T>(current: T | null, incoming: T | null): T | null {
  return current ?? incoming
}

export function reconcileInforceRows(rows: InforceRow[]): ReconcileResult {
  const byPolicy = new Map<string, ReconciledPolicy>()
  const discarded: DiscardedRow[] = []

  // The export's trailing banner rows ("Exported On:", "Exported By:") arrive in
  // the same shape as data. They carry no policy number, which is what separates
  // them from a real row.
  for (const row of rows) {
    const policyNumber = text(row.policyNumber)
    if (!policyNumber) {
      discarded.push({ reason: 'MISSING_POLICY_NUMBER', policyStatus: row.policyStatus })
      continue
    }

    const isExport = row.deploymentScope === EXPORT_SCOPE
    const existing = byPolicy.get(policyNumber)
    const incoming: ReconciledPolicy = {
      policyNumber,
      status: mapStatus(row.policyStatus),
      sourceStatus: text(row.policyStatus),
      productName: text(row.productName),
      issueDate: parseCarrierDate(row.policyIssueDate),
      premium: parseMoney(row.anticipatedAnnualPremium),
      insuredName: text(row.insuredClientName),
      insuredDateOfBirth: parseCarrierDate(row.insuredDob),
      insuredEmail: text(row.insuredEmail),
      insuredPhone: text(row.insuredPhoneNumber),
      ownerName: text(row.ownerClientName),
    }

    if (!existing) {
      byPolicy.set(policyNumber, incoming)
      continue
    }

    // Status, product and contact come from the export when it has them; date of
    // birth only ever comes from the legacy grid, so it is merged either way.
    byPolicy.set(policyNumber, {
      policyNumber,
      status: isExport ? incoming.status : existing.status,
      sourceStatus: isExport ? incoming.sourceStatus : existing.sourceStatus,
      productName: isExport ? coalesce(incoming.productName, existing.productName) : coalesce(existing.productName, incoming.productName),
      issueDate: coalesce(existing.issueDate, incoming.issueDate),
      premium: isExport ? coalesce(incoming.premium, existing.premium) : coalesce(existing.premium, incoming.premium),
      insuredName: coalesce(existing.insuredName, incoming.insuredName),
      insuredDateOfBirth: coalesce(existing.insuredDateOfBirth, incoming.insuredDateOfBirth),
      insuredEmail: isExport ? coalesce(incoming.insuredEmail, existing.insuredEmail) : coalesce(existing.insuredEmail, incoming.insuredEmail),
      insuredPhone: isExport ? coalesce(incoming.insuredPhone, existing.insuredPhone) : coalesce(existing.insuredPhone, incoming.insuredPhone),
      ownerName: coalesce(existing.ownerName, incoming.ownerName),
    })
  }

  return { policies: [...byPolicy.values()], discarded }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/national-life/portfolio-reconcile.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/portfolio-reconcile.ts lib/national-life/portfolio-reconcile.test.ts
git commit -m "Reconcile the two National Life inforce slices into one policy view"
```

---

### Task 3: Resolve client identity without merging distinct people

Sixteen names in the live book appear with more than one date of birth. Matching on name alone would fuse distinct people, and the agent would see one client's policy on another's record. Merging is irreversible and visible; duplicating is neither.

**Files:**
- Create: `lib/national-life/portfolio-identity.ts`
- Test: `lib/national-life/portfolio-identity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ClientCandidate`, `type IdentityMatch`, `function normalizeClientName(value: string): string`, `function matchClient(candidate: ClientCandidate, existing: ClientCandidate[]): IdentityMatch`, consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Create `lib/national-life/portfolio-identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { matchClient, normalizeClientName, type ClientCandidate } from './portfolio-identity'

const dob = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))

describe('normalizeClientName', () => {
  it('ignores case, padding and doubled spaces so the carrier and the app agree', () => {
    expect(normalizeClientName('  ENRICO   ABDALLA ')).toBe('enrico abdalla')
  })
})

describe('matchClient', () => {
  it('matches an existing client on name and date of birth', () => {
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: dob(1980, 1, 15) }]
    const match = matchClient({ id: null, name: 'ENRICO ABDALLA', dateOfBirth: dob(1980, 1, 15) }, existing)

    expect(match).toEqual({ kind: 'MATCHED', clientId: 'c1' })
  })

  it('keeps two people who share a name but not a date of birth apart', () => {
    // Sixteen names in the live book do exactly this.
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Maria Silva', dateOfBirth: dob(1980, 1, 15) }]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: dob(1991, 7, 2) }, existing)

    expect(match).toEqual({ kind: 'CREATE' })
  })

  it('matches on name alone when no date of birth is known, and says it is unsure', () => {
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Maria Silva', dateOfBirth: null }]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: null }, existing)

    expect(match).toEqual({ kind: 'MATCHED_LOW_CONFIDENCE', clientId: 'c1' })
  })

  it('refuses to attach a client with no date of birth to one that has a different one', () => {
    // Silently attaching here is the failure that shows one client's policy on
    // another's record. Creating a duplicate is recoverable; this is not.
    const existing: ClientCandidate[] = [{ id: 'c1', name: 'Maria Silva', dateOfBirth: dob(1980, 1, 15) }]
    const match = matchClient({ id: null, name: 'Maria Silva', dateOfBirth: null }, existing)

    expect(match).toEqual({ kind: 'CREATE' })
  })

  it('creates when nothing matches', () => {
    expect(matchClient({ id: null, name: 'Ada Lovelace', dateOfBirth: null }, [])).toEqual({ kind: 'CREATE' })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/national-life/portfolio-identity.test.ts`
Expected: FAIL — `Failed to resolve import "./portfolio-identity"`.

- [ ] **Step 3: Implement the module**

Create `lib/national-life/portfolio-identity.ts`:

```ts
/// Identity is the one place in this ingestion where a mistake is irreversible and
/// visible: fusing two people puts one client's policy on another's record. The
/// rules below deliberately fail towards creating a duplicate, which an agent can
/// merge later, and never towards a merge, which nobody can undo.
///
/// The caller must scope `existing` to a single agent. These functions never see
/// an agent id and so cannot enforce it.

export type ClientCandidate = {
  id: string | null
  name: string
  dateOfBirth: Date | null
}

export type IdentityMatch =
  | { kind: 'MATCHED'; clientId: string }
  | { kind: 'MATCHED_LOW_CONFIDENCE'; clientId: string }
  | { kind: 'CREATE' }

export function normalizeClientName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false
  return a.getTime() === b.getTime()
}

export function matchClient(
  candidate: ClientCandidate,
  existing: readonly ClientCandidate[],
): IdentityMatch {
  const name = normalizeClientName(candidate.name)
  const sameName = existing.filter((one) => normalizeClientName(one.name) === name)
  if (sameName.length === 0) return { kind: 'CREATE' }

  if (candidate.dateOfBirth) {
    const exact = sameName.find((one) => sameDay(one.dateOfBirth, candidate.dateOfBirth))
    if (exact?.id) return { kind: 'MATCHED', clientId: exact.id }
    // A name match whose date of birth disagrees is evidence of a different
    // person, not of a missing field.
    return { kind: 'CREATE' }
  }

  // Without a date of birth the only safe partner is one that has none either.
  // Attaching to a record that carries a date of birth would be asserting an
  // identity nothing supports.
  const undated = sameName.filter((one) => one.dateOfBirth === null)
  if (undated.length === 1 && undated[0]?.id) {
    return { kind: 'MATCHED_LOW_CONFIDENCE', clientId: undated[0].id }
  }
  return { kind: 'CREATE' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/national-life/portfolio-identity.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/portfolio-identity.ts lib/national-life/portfolio-identity.test.ts
git commit -m "Match National Life clients without fusing distinct people"
```

---

### Task 4: Plan the writes

The plan is a pure value: what to create, what to update, what could not be resolved. Keeping it pure is what makes the ingestion testable without a database and reviewable without running it.

**Files:**
- Create: `lib/national-life/portfolio-plan.ts`
- Test: `lib/national-life/portfolio-plan.test.ts`

**Interfaces:**
- Consumes: `reconcileInforceRows`, `ReconciledPolicy` (Task 2); `matchClient`, `ClientCandidate` (Task 3).
- Produces: `type PortfolioIngestPlan`, `function planPortfolioIngest(input: { rows: InforceRow[]; existingClients: ClientCandidate[] }): PortfolioIngestPlan`, consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `lib/national-life/portfolio-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planPortfolioIngest } from './portfolio-plan'
import type { InforceRow } from './portfolio-reconcile'

function row(overrides: Partial<InforceRow>): InforceRow {
  return {
    deploymentScope: 'LOCAL_CONNECTOR',
    policyNumber: 'LS1',
    policyStatus: 'Active',
    policyIssueDate: '06/02/2023',
    productName: 'Indexed Universal Life',
    insuredClientName: 'Enrico Abdalla',
    insuredDob: null,
    insuredEmail: null,
    insuredPhoneNumber: null,
    insuredZipcode: null,
    ownerClientName: 'Enrico Abdalla',
    anticipatedAnnualPremium: '1200.00',
    ...overrides,
  }
}

describe('planPortfolioIngest', () => {
  it('plans a new client and a policy keyed for upsert on the policy number', () => {
    const plan = planPortfolioIngest({ rows: [row({})], existingClients: [] })

    expect(plan.clientsToCreate).toHaveLength(1)
    expect(plan.policies[0]).toMatchObject({
      sourceProvider: 'NATIONAL_LIFE',
      sourceExternalId: 'LS1',
      carrier: 'National Life Group',
      status: 'INFORCE',
      sourceStatus: 'Active',
      premium: 1200,
    })
  })

  it('leaves face amount unknown rather than zero', () => {
    const plan = planPortfolioIngest({ rows: [row({})], existingClients: [] })

    expect(plan.policies[0]?.faceAmount).toBeNull()
    expect(plan.needsFaceAmount).toEqual(['LS1'])
  })

  it('attaches the policy to an existing client instead of duplicating them', () => {
    const plan = planPortfolioIngest({
      rows: [row({ insuredDob: '01/15/1980', deploymentScope: 'legacy' })],
      existingClients: [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: new Date(Date.UTC(1980, 0, 15)) }],
    })

    expect(plan.clientsToCreate).toEqual([])
    expect(plan.policies[0]?.clientRef).toEqual({ kind: 'EXISTING', clientId: 'c1' })
  })

  it('reports a low-confidence match instead of hiding it', () => {
    const plan = planPortfolioIngest({
      rows: [row({})],
      existingClients: [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: null }],
    })

    expect(plan.lowConfidence).toEqual([{ policyNumber: 'LS1', clientId: 'c1', name: 'Enrico Abdalla' }])
  })

  it('passes the discarded footer rows through to the report', () => {
    const plan = planPortfolioIngest({
      rows: [row({ policyNumber: '', policyStatus: 'Exported By: Novaes, Beatriz Moraes' })],
      existingClients: [],
    })

    expect(plan.policies).toEqual([])
    expect(plan.discarded).toHaveLength(1)
  })

  it('plans one client for two policies of the same person', () => {
    const plan = planPortfolioIngest({
      rows: [row({ policyNumber: 'LS1' }), row({ policyNumber: 'LS2' })],
      existingClients: [],
    })

    expect(plan.clientsToCreate).toHaveLength(1)
    expect(plan.policies).toHaveLength(2)
  })

  it('skips a policy whose insured has no name, because a client cannot be identified', () => {
    const plan = planPortfolioIngest({ rows: [row({ insuredClientName: null })], existingClients: [] })

    expect(plan.policies).toEqual([])
    expect(plan.discarded).toEqual([{ reason: 'MISSING_INSURED_NAME', policyStatus: 'Active' }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/national-life/portfolio-plan.test.ts`
Expected: FAIL — `Failed to resolve import "./portfolio-plan"`.

- [ ] **Step 3: Implement the module**

Create `lib/national-life/portfolio-plan.ts`:

```ts
import {
  reconcileInforceRows,
  type DiscardedRow,
  type InforceRow,
  type PolicyStatusName,
} from './portfolio-reconcile'
import { matchClient, normalizeClientName, type ClientCandidate } from './portfolio-identity'

export const NATIONAL_LIFE_PROVIDER = 'NATIONAL_LIFE'
export const NATIONAL_LIFE_CARRIER = 'National Life Group'

export type ClientRef =
  | { kind: 'EXISTING'; clientId: string }
  | { kind: 'NEW'; key: string }

export type PlannedClient = {
  key: string
  name: string
  dateOfBirth: Date | null
  email: string | null
  phone: string | null
}

export type PlannedPolicy = {
  sourceProvider: typeof NATIONAL_LIFE_PROVIDER
  sourceExternalId: string
  policyNumber: string
  carrier: typeof NATIONAL_LIFE_CARRIER
  product: string
  status: PolicyStatusName
  sourceStatus: string | null
  faceAmount: null
  premium: number | null
  effectiveDate: Date | null
  clientRef: ClientRef
}

export type LowConfidenceMatch = { policyNumber: string; clientId: string; name: string }

export type PortfolioIngestPlan = {
  clientsToCreate: PlannedClient[]
  policies: PlannedPolicy[]
  needsFaceAmount: string[]
  lowConfidence: LowConfidenceMatch[]
  discarded: (DiscardedRow | { reason: 'MISSING_INSURED_NAME'; policyStatus: string | null })[]
}

/// Face amount is deliberately absent here, never zero: it does not exist in any of
/// the export's 33 columns and arrives later, per policy, from the detail page.
///
/// `needsFaceAmount` lists every policy this plan touched, not the backfill queue.
/// Planning is pure and cannot know which rows already carry a face amount from an
/// earlier backfill. The backfill stage selects its own work with
/// `faceAmount IS NULL`, which is both simpler and correct; this count exists so the
/// sync can report how much of the book is still unpriced.
export function planPortfolioIngest(input: {
  rows: InforceRow[]
  existingClients: readonly ClientCandidate[]
}): PortfolioIngestPlan {
  const { policies: reconciled, discarded: reconcileDiscarded } = reconcileInforceRows(input.rows)

  const plan: PortfolioIngestPlan = {
    clientsToCreate: [],
    policies: [],
    needsFaceAmount: [],
    lowConfidence: [],
    discarded: [...reconcileDiscarded],
  }

  // Clients planned in this same run must be visible to later policies, or two
  // policies of one person would plan that person twice.
  const plannedByKey = new Map<string, PlannedClient>()

  for (const policy of reconciled) {
    if (!policy.insuredName) {
      plan.discarded.push({ reason: 'MISSING_INSURED_NAME', policyStatus: policy.sourceStatus })
      continue
    }

    const key = `${normalizeClientName(policy.insuredName)}|${policy.insuredDateOfBirth?.toISOString() ?? ''}`
    const alreadyPlanned = plannedByKey.get(key)
    let clientRef: ClientRef

    if (alreadyPlanned) {
      clientRef = { kind: 'NEW', key }
    } else {
      const match = matchClient(
        { id: null, name: policy.insuredName, dateOfBirth: policy.insuredDateOfBirth },
        input.existingClients,
      )
      if (match.kind === 'CREATE') {
        const planned: PlannedClient = {
          key,
          name: policy.insuredName,
          dateOfBirth: policy.insuredDateOfBirth,
          email: policy.insuredEmail,
          phone: policy.insuredPhone,
        }
        plannedByKey.set(key, planned)
        plan.clientsToCreate.push(planned)
        clientRef = { kind: 'NEW', key }
      } else {
        clientRef = { kind: 'EXISTING', clientId: match.clientId }
        if (match.kind === 'MATCHED_LOW_CONFIDENCE') {
          plan.lowConfidence.push({
            policyNumber: policy.policyNumber,
            clientId: match.clientId,
            name: policy.insuredName,
          })
        }
      }
    }

    plan.policies.push({
      sourceProvider: NATIONAL_LIFE_PROVIDER,
      sourceExternalId: policy.policyNumber,
      policyNumber: policy.policyNumber,
      carrier: NATIONAL_LIFE_CARRIER,
      product: policy.productName ?? 'Unknown',
      status: policy.status,
      sourceStatus: policy.sourceStatus,
      faceAmount: null,
      premium: policy.premium,
      effectiveDate: policy.issueDate,
      clientRef,
    })
    plan.needsFaceAmount.push(policy.policyNumber)
  }

  return plan
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/national-life/portfolio-plan.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/portfolio-plan.ts lib/national-life/portfolio-plan.test.ts
git commit -m "Plan the National Life portfolio writes as a pure value"
```

---

### Task 5: Apply the plan

The thin half. It reads the agent's slices, asks Task 4 for a plan, and writes it. Per-policy transactions so one bad row cannot take the batch down, and no deletes ever.

**Files:**
- Create: `lib/national-life/portfolio-ingest.ts`
- Test: `lib/national-life/portfolio-ingest.test.ts`

**Interfaces:**
- Consumes: `planPortfolioIngest`, `PortfolioIngestPlan` (Task 4).
- Produces: `type IngestReport`, `function ingestNationalLifePortfolio(deps: IngestDeps, input: { agentId: string }): Promise<IngestReport>`, consumed by Task 6.

- [ ] **Step 1: Write the failing tests**

Create `lib/national-life/portfolio-ingest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ingestNationalLifePortfolio, type IngestDeps } from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'

function deps(rows: InforceRow[], existing: { id: string; name: string; dateOfBirth: Date | null }[] = []): {
  deps: IngestDeps
  createdClients: { name: string }[]
  upserted: { sourceExternalId: string; faceAmount: unknown }[]
} {
  const createdClients: { name: string }[] = []
  const upserted: { sourceExternalId: string; faceAmount: unknown }[] = []
  return {
    createdClients,
    upserted,
    deps: {
      loadInforceRows: async () => rows,
      loadClients: async () => existing,
      createClient: async (input) => {
        createdClients.push({ name: input.name })
        return { id: `new-${createdClients.length}` }
      },
      upsertPolicy: async (input) => {
        upserted.push({ sourceExternalId: input.sourceExternalId, faceAmount: input.faceAmount })
      },
    },
  }
}

const row = (overrides: Partial<InforceRow>): InforceRow => ({
  deploymentScope: 'LOCAL_CONNECTOR',
  policyNumber: 'LS1',
  policyStatus: 'Active',
  policyIssueDate: '06/02/2023',
  productName: 'IUL',
  insuredClientName: 'Enrico Abdalla',
  insuredDob: null,
  insuredEmail: null,
  insuredPhoneNumber: null,
  insuredZipcode: null,
  ownerClientName: 'Enrico Abdalla',
  anticipatedAnnualPremium: '1200',
  ...overrides,
})

describe('ingestNationalLifePortfolio', () => {
  it('creates the client, upserts the policy and reports the counts', async () => {
    const harness = deps([row({})])
    const report = await ingestNationalLifePortfolio(harness.deps, { agentId: 'a1' })

    expect(harness.createdClients).toEqual([{ name: 'Enrico Abdalla' }])
    expect(harness.upserted).toEqual([{ sourceExternalId: 'LS1', faceAmount: null }])
    expect(report).toMatchObject({ clientsCreated: 1, policiesUpserted: 1, needsFaceAmount: 1 })
  })

  it('is idempotent: a second run against the same data creates nothing new', async () => {
    const first = deps([row({})])
    await ingestNationalLifePortfolio(first.deps, { agentId: 'a1' })

    const second = deps([row({})], [{ id: 'c1', name: 'Enrico Abdalla', dateOfBirth: null }])
    const report = await ingestNationalLifePortfolio(second.deps, { agentId: 'a1' })

    expect(second.createdClients).toEqual([])
    expect(report.clientsCreated).toBe(0)
    expect(report.policiesUpserted).toBe(1)
  })

  it('keeps going when one policy fails and reports which one', async () => {
    const harness = deps([row({ policyNumber: 'LS1' }), row({ policyNumber: 'LS2' })])
    harness.deps.upsertPolicy = vi.fn(async (input) => {
      if (input.sourceExternalId === 'LS1') throw new Error('boom')
    })

    const report = await ingestNationalLifePortfolio(harness.deps, { agentId: 'a1' })

    expect(report.policiesUpserted).toBe(1)
    expect(report.failed).toEqual([{ policyNumber: 'LS1', reason: 'boom' }])
  })

  it('leaves a policy that vanished from the export untouched instead of removing it', async () => {
    // The carrier may have changed a filter. Absent from the export is not proof
    // the policy stopped existing. LS2 was ingested before and is missing now:
    // the run must simply not mention it, never write against it.
    const harness = deps([row({ policyNumber: 'LS1' })])
    const touched: string[] = []
    harness.deps.upsertPolicy = async (input) => {
      touched.push(input.sourceExternalId)
    }

    const report = await ingestNationalLifePortfolio(harness.deps, { agentId: 'a1' })

    expect(touched).toEqual(['LS1'])
    expect(report.policiesUpserted).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/national-life/portfolio-ingest.test.ts`
Expected: FAIL — `Failed to resolve import "./portfolio-ingest"`.

- [ ] **Step 3: Implement the module**

Create `lib/national-life/portfolio-ingest.ts`:

```ts
import { planPortfolioIngest, type PlannedPolicy } from './portfolio-plan'
import type { InforceRow } from './portfolio-reconcile'

/// The writes arrive as injected functions rather than a bound Prisma client, for
/// the same reason `raw-ingest.ts` keeps its planning pure: the persist helpers bind
/// the module-level client and cannot run inside a caller's transaction. It also
/// makes this testable without a database.
export type IngestDeps = {
  loadInforceRows: (agentId: string) => Promise<InforceRow[]>
  loadClients: (agentId: string) => Promise<{ id: string; name: string; dateOfBirth: Date | null }[]>
  createClient: (input: {
    agentId: string
    name: string
    dateOfBirth: Date | null
    email: string | null
    phone: string | null
  }) => Promise<{ id: string }>
  upsertPolicy: (input: PlannedPolicy & { agentId: string; clientId: string }) => Promise<void>
}

export type IngestReport = {
  clientsCreated: number
  policiesUpserted: number
  needsFaceAmount: number
  lowConfidence: { policyNumber: string; clientId: string; name: string }[]
  discarded: number
  failed: { policyNumber: string; reason: string }[]
}

export async function ingestNationalLifePortfolio(
  deps: IngestDeps,
  input: { agentId: string },
): Promise<IngestReport> {
  const [rows, existingClients] = await Promise.all([
    deps.loadInforceRows(input.agentId),
    deps.loadClients(input.agentId),
  ])

  const plan = planPortfolioIngest({ rows, existingClients })

  const report: IngestReport = {
    clientsCreated: 0,
    policiesUpserted: 0,
    needsFaceAmount: plan.needsFaceAmount.length,
    lowConfidence: plan.lowConfidence,
    discarded: plan.discarded.length,
    failed: [],
  }

  const createdIdByKey = new Map<string, string>()
  for (const client of plan.clientsToCreate) {
    const created = await deps.createClient({
      agentId: input.agentId,
      name: client.name,
      dateOfBirth: client.dateOfBirth,
      email: client.email,
      phone: client.phone,
    })
    createdIdByKey.set(client.key, created.id)
    report.clientsCreated += 1
  }

  // One policy at a time: a single malformed row must not cost the batch. The
  // failure is reported, never swallowed.
  for (const policy of plan.policies) {
    const clientId =
      policy.clientRef.kind === 'EXISTING'
        ? policy.clientRef.clientId
        : createdIdByKey.get(policy.clientRef.key)
    if (!clientId) {
      report.failed.push({ policyNumber: policy.policyNumber, reason: 'CLIENT_UNRESOLVED' })
      continue
    }
    try {
      await deps.upsertPolicy({ ...policy, agentId: input.agentId, clientId })
      report.policiesUpserted += 1
    } catch (error) {
      report.failed.push({
        policyNumber: policy.policyNumber,
        reason: error instanceof Error ? error.message : 'UNKNOWN',
      })
    }
  }

  return report
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/national-life/portfolio-ingest.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/national-life/portfolio-ingest.ts lib/national-life/portfolio-ingest.test.ts
git commit -m "Apply the National Life portfolio plan without deleting or aborting"
```

---

### Task 6: Bind the Prisma implementations

Only here does the module know about the database. Kept separate so Tasks 2–5 stay runnable in a plain test process.

**Files:**
- Create: `lib/national-life/portfolio-ingest-prisma.ts`
- Test: `lib/national-life/portfolio-ingest-prisma.test.ts`

**Interfaces:**
- Consumes: `IngestDeps` (Task 5); `PlannedPolicy` (Task 4).
- Produces: `function prismaIngestDeps(prisma: PrismaClient): IngestDeps`.

- [ ] **Step 1: Write the failing test**

Create `lib/national-life/portfolio-ingest-prisma.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { prismaIngestDeps } from './portfolio-ingest-prisma'

describe('prismaIngestDeps', () => {
  it('upserts on the provider and external id pair, so an existing row is corrected in place', async () => {
    const upsert = vi.fn(async () => ({}))
    const deps = prismaIngestDeps({ policy: { upsert } } as never)

    await deps.upsertPolicy({
      agentId: 'a1',
      clientId: 'c1',
      sourceProvider: 'NATIONAL_LIFE',
      sourceExternalId: 'LS1',
      policyNumber: 'LS1',
      carrier: 'National Life Group',
      product: 'IUL',
      status: 'INFORCE',
      sourceStatus: 'Active',
      faceAmount: null,
      premium: 1200,
      effectiveDate: null,
      clientRef: { kind: 'EXISTING', clientId: 'c1' },
    })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceProvider_sourceExternalId: { sourceProvider: 'NATIONAL_LIFE', sourceExternalId: 'LS1' } },
      }),
    )
  })

  it('does not overwrite a known face amount with null on a later sync', async () => {
    // Face amount arrives by backfill, after the row. A sync that runs in between
    // must not undo it.
    const upsert = vi.fn(async () => ({}))
    const deps = prismaIngestDeps({ policy: { upsert } } as never)

    await deps.upsertPolicy({
      agentId: 'a1',
      clientId: 'c1',
      sourceProvider: 'NATIONAL_LIFE',
      sourceExternalId: 'LS1',
      policyNumber: 'LS1',
      carrier: 'National Life Group',
      product: 'IUL',
      status: 'INFORCE',
      sourceStatus: 'Active',
      faceAmount: null,
      premium: 1200,
      effectiveDate: null,
      clientRef: { kind: 'EXISTING', clientId: 'c1' },
    })

    const call = upsert.mock.calls[0]?.[0] as { update: Record<string, unknown> }
    expect(call.update).not.toHaveProperty('faceAmount')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/national-life/portfolio-ingest-prisma.test.ts`
Expected: FAIL — `Failed to resolve import "./portfolio-ingest-prisma"`.

- [ ] **Step 3: Implement the module**

Create `lib/national-life/portfolio-ingest-prisma.ts`:

```ts
import type { PrismaClient } from '@prisma/client'
import type { IngestDeps } from './portfolio-ingest'
import type { InforceRow } from './portfolio-reconcile'

export function prismaIngestDeps(prisma: PrismaClient): IngestDeps {
  return {
    loadInforceRows: async (agentId) =>
      (await prisma.nationalLifeInforcePolicy.findMany({
        where: { agentId },
        select: {
          deploymentScope: true,
          policyNumber: true,
          policyStatus: true,
          policyIssueDate: true,
          productName: true,
          insuredClientName: true,
          insuredDob: true,
          insuredEmail: true,
          insuredPhoneNumber: true,
          insuredZipcode: true,
          ownerClientName: true,
          anticipatedAnnualPremium: true,
        },
      })) as InforceRow[],

    loadClients: async (agentId) =>
      prisma.client.findMany({
        where: { assignedAgentId: agentId },
        select: { id: true, name: true, dateOfBirth: true },
      }),

    createClient: async ({ agentId, name, dateOfBirth, email, phone }) =>
      prisma.client.create({
        data: { assignedAgentId: agentId, name, dateOfBirth, email, phone },
        select: { id: true },
      }),

    upsertPolicy: async (input) => {
      const shared = {
        clientId: input.clientId,
        agentId: input.agentId,
        carrier: input.carrier,
        product: input.product,
        status: input.status,
        sourceStatus: input.sourceStatus,
        premium: input.premium ?? 0,
        effectiveDate: input.effectiveDate,
        sourceUpdatedAt: new Date(),
      }
      await prisma.policy.upsert({
        where: {
          sourceProvider_sourceExternalId: {
            sourceProvider: input.sourceProvider,
            sourceExternalId: input.sourceExternalId,
          },
        },
        // `faceAmount` is absent from `update` on purpose: the backfill owns that
        // column once it has a real number, and a later sync must not erase it.
        update: shared,
        create: {
          ...shared,
          policyNumber: input.policyNumber,
          sourceProvider: input.sourceProvider,
          sourceExternalId: input.sourceExternalId,
          faceAmount: input.faceAmount,
        },
      })
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/national-life/portfolio-ingest-prisma.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npx vitest run lib/national-life && npx tsc --noEmit -p tsconfig.json`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add lib/national-life/portfolio-ingest-prisma.ts lib/national-life/portfolio-ingest-prisma.test.ts
git commit -m "Bind the National Life ingestion to Prisma"
```

---

## Not in this plan

- The face-amount backfill stage itself (`READ_POLICY_DETAIL`): its path allowlist is already written and tested, but it still needs a `policyNumber → id` resolver and a per-product parser. Separate plan.
- Calling the ingestion at the end of a sync run, and the sync UX that reports its counts. Separate plan, because it needs the report shape this plan produces to exist first.
- `premium ?? 0` in Task 6 is a knowing compromise: `Policy.premium` is still a required column. Relaxing it is the same argument as Task 1 and belongs in its own change, with its own migration.
