# K-Bot iGO Application Add-on Implementation Plan

> **For Paulo:** This plan is executed inline in the isolated `feat/kbot-igo-application` worktree. Each slice stays reviewable and is committed separately.

**Goal:** Deliver a paid, tenant-safe K-Bot Application lane that gathers a complete client dossier in KeeprOne, prepares a reviewed iGO draft, and submits only after a second explicit confirmation without interrupting sync or illustrations.

**Architecture:** KeeprOne is the server authority for entitlement, intake snapshots, documents, command issuance, and audit receipts. The Chrome extension is a device-bound executor with an explicit capability registry and one serialized Application queue, while the existing sync engine and illustration queue remain independent. iGO remains the carrier authority; unexpected fields pause Application and become requirements in KeeprOne.

**Tech Stack:** Next.js App Router, React 19, Prisma/PostgreSQL, Stripe subscriptions/webhooks, WXT Chrome MV3, Zod, Vitest.

**Spec:** `docs/specs/kbot-igo-application-addon.md`

---

### Task 1: Make connector dispatch fail closed

**Files:**
- Modify: `apps/keeprone-connect/entrypoints/background.ts`
- Create: `apps/keeprone-connect/lib/command-executor.ts`
- Test: `apps/keeprone-connect/lib/command-executor.test.ts`

- [ ] Write a failing registry test showing `PREPARE_APPLICATION_DRAFT` cannot fall through to policy detail.
- [ ] Add an explicit mapping for the currently implemented executors only.
- [ ] Return `CAPABILITY_NOT_IMPLEMENTED` for declared-but-unimplemented capabilities.
- [ ] Preserve the command event and local error behavior.
- [ ] Run the new test and the extension suite.

### Task 2: Persist paid Application entitlement

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*_application_addon/migration.sql`
- Create: `lib/application-addon/entitlement.ts`
- Create: `lib/application-addon/entitlement.test.ts`
- Modify: `lib/stripe/platform-subscription.ts`
- Modify: `app/api/webhooks/stripe/route.ts`

- [ ] Add a commercial capability/add-on subscription model with exactly one agent or agency subject.
- [ ] Resolve active/trialing entitlement with paid-period bounds and fail closed for missing/canceled/expired rows.
- [ ] Read dedicated Stripe product/price IDs without exposing secrets.
- [ ] Sync matching Stripe subscriptions from webhook metadata.
- [ ] Test individual, agency owner/member, cancellation, wrong product, and cross-tenant denial.

### Task 3: Build the versioned Application dossier

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/*_application_dossier/migration.sql`
- Create: `lib/application-addon/dossier-contract.ts`
- Create: `lib/application-addon/dossier-service.ts`
- Test: `lib/application-addon/dossier-contract.test.ts`
- Test: `lib/application-addon/dossier-service.test.ts`

- [ ] Add intake version, draft state, snapshot hash, review/consent timestamps, carrier draft ID, and receipt metadata to `Application`.
- [ ] Define strict field contracts for identity, contact, address, owner, beneficiary, product intent, replacement indication, and documents.
- [ ] Compute readiness from required fields without treating blank/zero/unknown as complete.
- [ ] Persist updates only after case ownership and add-on entitlement checks.
- [ ] Freeze a reviewed snapshot hash so later edits invalidate prior approval.

### Task 4: Deliver the agent intake and review UX

**Files:**
- Modify: `app/agent/cases/[id]/page.tsx`
- Modify: `app/agent/cases/[id]/CaseWorkspace.tsx`
- Modify: `app/agent/cases/[id]/actions.ts`
- Create: `app/agent/cases/[id]/ApplicationDossier.tsx`
- Test: `app/agent/cases/[id]/ApplicationDossier.test.tsx`
- Test: `app/agent/cases/[id]/actions.test.ts`

- [ ] Replace the generic five-item checklist with a guided completeness view.
- [ ] Show missing data in plain language and preserve fields as a draft.
- [ ] Show add-on activation instead of a working button when not entitled.
- [ ] Present the exact reviewed snapshot and consent before K-Bot is enabled.
- [ ] Lock duplicate clicks immediately and display one durable active job.

### Task 5: Issue and persist iGO draft commands

**Files:**
- Create: `lib/application-addon/command-service.ts`
- Test: `lib/application-addon/command-service.test.ts`
- Create: `app/api/agent/applications/[applicationId]/prepare/route.ts`
- Create: `app/api/agent/applications/[applicationId]/status/route.ts`
- Modify: `lib/national-life/local-connector/command-dispatch-service.ts`

- [ ] Require entitlement, ownership, readiness, review, and current snapshot hash.
- [ ] Issue one idempotent `PREPARE_APPLICATION_DRAFT` command per reviewed snapshot.
- [ ] Keep the Application command lane independent from sync and Illustration state.
- [ ] Persist progress, auth/MFA wait, missing-question requirements, carrier draft ID, and read-back result.
- [ ] Reject stale, duplicated, cross-agent, or wrong-device results.

### Task 6: Map and implement authenticated iGO draft execution

**Files:**
- Create: `apps/keeprone-connect/lib/igo-contract.ts`
- Create: `apps/keeprone-connect/lib/igo-executor.ts`
- Create: `apps/keeprone-connect/entrypoints/igo.content.ts`
- Test: `apps/keeprone-connect/lib/igo-contract.test.ts`
- Test: `apps/keeprone-connect/lib/igo-executor.test.ts`
- Modify: `apps/keeprone-connect/entrypoints/background.ts`

- [ ] In an authenticated session, record the Start New Case route, supported initial product/state path, field names, allowed values, validation messages, draft ID, and receipt shape without submitting.
- [ ] Convert the reviewed KeeprOne snapshot to a strict iGO input contract.
- [ ] Fill one page at a time, read values back, and stop on any mismatch.
- [ ] Emit `AUTH_REQUIRED`/`MFA_REQUIRED` without affecting sync or Illustration.
- [ ] Convert an unknown required carrier question into a bounded missing-field receipt.

### Task 7: Transfer reviewed documents safely

**Files:**
- Create: `lib/application-addon/document-service.ts`
- Create: `app/api/agent/applications/[applicationId]/documents/[documentId]/transfer/route.ts`
- Modify: `apps/keeprone-connect/lib/igo-executor.ts`
- Test: `lib/application-addon/document-service.test.ts`

- [ ] Reuse private document storage and allow only approved MIME types and bounded sizes.
- [ ] Bind every transfer to agent, application, command, expiry, and SHA-256.
- [ ] Upload only documents marked reviewed by the agent.
- [ ] Persist the carrier acknowledgement without storing a public document URL.

### Task 8: Add distinct final submission confirmation

**Files:**
- Create: `app/api/agent/applications/[applicationId]/submit/route.ts`
- Modify: `lib/application-addon/command-service.ts`
- Modify: `apps/keeprone-connect/lib/igo-executor.ts`
- Modify: `app/agent/cases/[id]/ApplicationDossier.tsx`
- Test: `lib/application-addon/command-service.test.ts`

- [ ] Require a carrier-read-back draft, no open required item, current entitlement, and unchanged payload hash.
- [ ] Show a final human-readable review and require a new explicit confirmation.
- [ ] Issue one idempotent `SUBMIT_APPLICATION` command.
- [ ] Persist external application ID, receipt, submitted timestamp, and carrier-confirmed values.
- [ ] Prevent any retry from producing a second carrier submission.

### Task 9: Make K-Bot show three truthful independent lanes

**Files:**
- Modify: `components/kbot/KBotCompanion.tsx`
- Modify: `lib/national-life/kbot-activity.ts`
- Modify: `app/api/agent/kbot/activity/route.ts`
- Test: `components/kbot/KBotCompanion.test.tsx`
- Test: `lib/national-life/kbot-activity.test.ts`

- [ ] Add Application activity, ETA, waiting-for-user, completed, and failed copy in plain language.
- [ ] Show sync, Illustration, and Application simultaneously rather than collapsing to one status.
- [ ] Keep the avatar fixed bottom-right and show only the lane needing attention.
- [ ] Respect reduced motion and preserve immediate click feedback.

### Task 10: Prove release boundaries

**Files:**
- Modify: `apps/keeprone-connect/package.json`
- Create: `docs/runbooks/kbot-application-release.md`

- [ ] Run Prisma validation/generation, targeted tests, full tests, lint, typecheck, Next build, and Chrome MV3 build.
- [ ] Run an unentitled server-side denial test.
- [ ] Run authenticated draft-only iGO smoke with a fake test client and record read-back; do not submit.
- [ ] After explicit approval, run one final-submit smoke and retain the carrier receipt.
- [ ] Run sync and Illustration concurrently with the Application lane waiting for user action.
- [ ] Package the new extension, record version/ID/SHA-256, and keep Store publication separate from server deployment evidence.

