# National Life Policy Detail, Illustration and iGO Implementation Plan

> Release scope update (2026-08-26): Tasks 7 and 8 (iGO) are deferred. The
> current release closes the priority sync, policy detail and official Foresight
> Illustration only. No iPipeline permission or executable iGO capability ships.

**Goal:** Make Keepr One the truthful control surface for National Life policy
detail, official Foresight Illustration and a reviewable iGO draft, executed by
KeeproneConnect in the agent's authenticated Chrome session.

**Architecture:** Reuse the existing signed device identity, connector command
ledger, risk classification and document transport. Add a device-scoped command
poll/event API and independent extension validation. Read policy detail on
demand, execute Foresight through a dedicated `/NWI/*` bridge, and add iPipeline
origins one at a time for draft preparation. Carrier writes are serialized,
target-verified and idempotent; auth failures pause and resume.

**Design:**
`docs/superpowers/specs/2026-08-26-national-life-illustration-igo-keeprone-design.md`

---

## Task 1: Correct policy truth and model carrier detail provenance

**Files:**

- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_national_life_policy_detail/migration.sql`
- Create: `lib/national-life/policy-detail.ts`
- Create: `lib/national-life/policy-detail.test.ts`
- Create: `lib/national-life/policy-detail-service.ts`
- Create: `lib/national-life/policy-detail-service.test.ts`
- Modify: `app/agent/policies/[id]/page.tsx`
- Modify: relevant policy-page tests

**TDD:**

1. Add failing parser tests for Coverage and Payments observations containing
   total face amount, net death benefit, planned periodic payment, payment
   frequency, anticipated annual premium, minimum premiums, CTP, next payment
   date, MEC limit and guideline premium limit.
2. Add failure cases for missing labels, malformed money, unexpected policy
   number and a page that is not the policy-detail surface.
3. Add service tests proving ownership scope, field-level provenance, nullable
   values and idempotent upsert by agent/deployment/policy.
4. Implement a typed parser and persistence service with no raw DOM storage.
5. Add nullable policy columns/provenance needed for the product view while
   retaining a typed carrier-detail snapshot for audit/freshness.
6. Replace the false `National Life does not provide` card with a truthful
   freshness/provenance state.
7. Run focused tests, Prisma validation/generation and typecheck.

**Commit:** `fix(national-life): model policy detail provenance`

## Task 2: Complete the signed local command transport

**Files:**

- Modify: `lib/national-life/connector-command-contract.ts`
- Modify: `lib/national-life/connector-command-service.ts`
- Modify: corresponding command tests
- Create: `lib/national-life/local-connector/command-dispatch-service.ts`
- Create: `lib/national-life/local-connector/command-dispatch-service.test.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/commands/next/route.ts`
- Create: route tests
- Create: `app/api/agent/integrations/national-life/local-connector/commands/[commandId]/events/route.ts`
- Create: route tests
- Modify: `apps/keeprone-connect/lib/signed-client.ts`
- Modify: signed-client tests

**TDD:**

1. Prove a device can receive only its agent's approved, unexpired command.
2. Prove write commands remain undispatchable until their exact payload hash is
   approved.
3. Prove another device/agent, expired commands and unsupported protocol
   versions are rejected without leaking existence.
4. Claim commands transactionally so alarm polling and direct wake-up cannot
   execute the same command twice.
5. Accept only ordered, device-owned command events and reconcile terminal
   state idempotently.
6. Add signed empty-body polling support without weakening the path allowlist,
   replay protection or device revocation semantics.
7. Run focused server/route/extension tests and typecheck.

**Commit:** `feat(national-life): add signed connector command transport`

## Task 3: Read policy detail on demand through KeeproneConnect

**Files:**

- Modify: `lib/national-life/connector-command-contract.ts`
- Modify: `apps/keeprone-connect/lib/command-contract.ts`
- Modify: `apps/keeprone-connect/lib/capabilities.ts`
- Modify: capability tests on both trust boundaries
- Modify: `apps/keeprone-connect/lib/messages.ts`
- Modify: message tests
- Modify: `apps/keeprone-connect/entrypoints/nlg-bridge.content.ts`
- Modify: `apps/keeprone-connect/entrypoints/background.ts`
- Modify: background/content tests
- Create: `apps/keeprone-connect/lib/policy-detail.ts`
- Create: `apps/keeprone-connect/lib/policy-detail.test.ts`
- Create: policy refresh server action/API and tests
- Modify: `app/agent/policies/[id]/page.tsx`

**TDD:**

1. Extend `READ_POLICY_DETAIL` with the exact server-authorized policy path and
   independently validate the opaque 32-hex detail ID on both sides.
2. Add fixture tests that extract only the approved coverage/payment labels and
   never return client names, DOB, HTML or unrelated page text.
3. Execute tab navigation with the existing dedicated connector-tab rule; do
   not reuse or replace the user's active carrier tab.
4. Verify the visible policy number matches the command before capture.
5. Send a bounded normalized event; persist it through Task 1's service.
6. Add a `Refresh from National Life` action and show progress/freshness in
   Keepr One. The user may leave the page without cancelling the command.
7. Test auth-required pause and resume without losing the command.

**Commit:** `feat(national-life): sync policy detail on demand`

## Task 4: Add command wake-up, background state and login UX

**Files:**

- Modify: `apps/keeprone-connect/lib/state.ts`
- Modify: state tests
- Modify: `apps/keeprone-connect/entrypoints/background.ts`
- Modify: background tests
- Modify: `apps/keeprone-connect/entrypoints/popup/main.ts`
- Modify: popup copy/tests
- Modify: Keepr One connector bridge/card components and tests
- Reuse/modify: `lib/national-life/local-connector/auth-notification-service.ts`

**TDD:**

1. Store only command IDs, safe checkpoints and user-facing status in extension
   state; never payloads, cookies or credentials.
2. Add direct `START_COMMAND` wake-up from the authenticated Keepr One origin
   plus a background alarm fallback.
3. Keep command polling independent from the daily sync state machine so one
   cannot freeze or overwrite the other.
4. Map login, MFA and challenge paths to `AUTH_REQUIRED`/`MFA_REQUIRED`, leave
   the command resumable and show one deduplicated notification.
5. Resume automatically after a successful auth probe.
6. Show plain-language operation states in Keepr One and the popup.

**Commit:** `feat(national-life): resume connector commands after login`

## Task 5: Implement the Foresight local executor

**Files:**

- Modify: `apps/keeprone-connect/wxt.config.ts`
- Create: `apps/keeprone-connect/entrypoints/foresight-bridge.content.ts`
- Create: `apps/keeprone-connect/entrypoints/foresight-main.content.ts`
- Create: `apps/keeprone-connect/lib/foresight-contract.ts`
- Create: `apps/keeprone-connect/lib/foresight-contract.test.ts`
- Create: `apps/keeprone-connect/lib/foresight-target.ts`
- Create: `apps/keeprone-connect/lib/foresight-target.test.ts`
- Modify: command capability parsing/tests
- Modify: background dispatch/tests

**TDD:**

1. Add `/NWI/*` host/content-script coverage without broadening access beyond
   National Life.
2. Implement `GENERATE_ILLUSTRATION` as a locally executable capability only
   after its approved execution snapshot passes the SHA-256 check.
3. Reject Auth0, `/Unsecure/`, login/challenge pages, unknown release shapes and
   unexpected frames before any write.
4. Discover required Foresight fields and fail closed when the expected product
   schema is missing.
5. Fill without saving, read back material values, and compare a deterministic
   target fingerprint.
6. Serialize writes per Foresight session and verify the exact current case
   immediately before Create/Save/IllustrateCase/RenderReports.
7. Reconcile a deterministic existing test/case before any retry.
8. Emit safe progress/receipt events with no client data in diagnostics.

**Commit:** `feat(national-life): execute Foresight illustrations locally`

## Task 6: Persist official Illustration output and finish Keepr One UX

**Files:**

- Modify: `lib/national-life/illustration-service.ts`
- Modify: illustration-service tests
- Add/modify connector artifact transfer service/tests
- Modify: `app/agent/illustrations/new/actions.ts`
- Modify: `app/agent/illustrations/actions.ts`
- Modify: `app/agent/illustrations/NewIllustrationForm.tsx`
- Modify: `app/agent/illustrations/IllustrationsWorkspace.tsx`
- Modify: illustration pages/tests

**TDD:**

1. Create an immutable execution snapshot from the reviewed Keepr One form and
   bind it to the command input hash.
2. Treat the initiating `Generate Illustration at National Life` click as the
   command approval; assert there is no second confirmation modal.
3. Validate PDF content type, `%PDF-` bytes, bounded size and SHA-256 before
   persistence.
4. Upsert the official Illustration by carrier external ID and never overwrite
   the preliminary quote's provenance.
5. Show progress after navigation away, auth renewal, manual review and the
   final carrier receipt/PDF in Keepr One.
6. Prove duplicate command/event/artifact delivery remains one Illustration and
   one document.

**Commit:** `feat(national-life): deliver official illustrations to Keepr One`

## Task 7: Probe and bridge the iGO gateway with least privilege

**Files:**

- Modify: `apps/keeprone-connect/wxt.config.ts`
- Create: `apps/keeprone-connect/entrypoints/igo-bridge.content.ts`
- Create: `apps/keeprone-connect/lib/igo-origin.ts`
- Create: `apps/keeprone-connect/lib/igo-origin.test.ts`
- Create: `apps/keeprone-connect/lib/igo-gateway.ts`
- Create: `apps/keeprone-connect/lib/igo-gateway.test.ts`
- Modify: background dispatch/tests
- Update: architecture/operations evidence only with verified origins

**TDD:**

1. Allow only individually observed iPipeline origins; reject wildcards and
   every unrecognized redirect.
2. Classify `ERR_BLOCKED_BY_CLIENT`, gateway-without-network, Auth0, MFA,
   unexpected origin and successful iGO landing separately.
3. Support the Foresight e-App launcher only after exact current-case
   verification.
4. Never expose launcher/session tokens in extension state, logs or events.
5. Make the probe read/navigation-only and keep draft/save controls disabled.
6. Validate against the agent's actual Chrome session before enabling Task 8.

**Commit:** `feat(national-life): bridge the iGO gateway safely`

## Task 8: Prepare a reviewable iGO draft

**Files:**

- Extend: connector command contract/tests
- Create: iGO section discovery/fill modules and tests
- Modify: `app/agent/cases/[id]/actions.ts`
- Modify: `app/agent/cases/[id]/CaseWorkspace.tsx`
- Modify: case action/UI tests
- Modify: application persistence/sync services and tests

**TDD:**

1. Build a versioned snapshot from the exact reviewed non-clinical Keepr One
   fields and hash it before approval.
2. Treat the `Prepare iGO draft` click as approval without a second modal.
3. Match carrier case/product/insured identity before filling.
4. Discover current required sections rather than assuming static field names.
5. Fill only mapped values, read them back, and surface every missing required
   or sensitive section as outstanding in Keepr One.
6. Save exactly one draft and reconcile by carrier application ID before retry.
7. Persist status and requirements under the correct `Application` and case
   timeline.
8. Keep `SUBMIT_APPLICATION` locally disabled and assert no submit control is
   invoked.

**Commit:** `feat(national-life): prepare iGO drafts from Keepr One`

## Task 9: Validate the complete implementation

**Files:** all touched files and release documentation

1. Run focused tests after each task.
2. Run Prisma validation/generation.
3. Run app, worker and extension typechecks.
4. Run lint for all touched files.
5. Run the complete relevant app, worker and extension suites.
6. Build Keepr One and KeeproneConnect with production origin settings.
7. Verify the extension manifest contains only intended host permissions and a
   new version.
8. Review the final diff for secrets, raw PII, accidental wildcard origins,
   unrelated files and unsafe retry behavior.

**Commit:** `test(national-life): verify illustration and iGO workflows`

## Task 10: Controlled live smoke and release report

1. Deploy the branch to a controlled environment before production merge.
2. Reload the exact built extension and verify its version/ID.
3. Confirm the National Life session read-only.
4. From Keepr One, create the authorized synthetic Illustration using the test
   dataset in the design spec.
5. Leave the Illustration page and prove background continuation.
6. Verify one carrier artifact, official PDF bytes/hash, Keepr One rendering,
   external ID, timeline and receipt.
7. Do not create or save an iGO application during this smoke.
8. Record exact per-layer evidence: branch SHA, tests, build, deployment,
   extension, carrier result, database result and user-visible result.
9. Open a PR for review; merge only after the evidence-backed go-live report.

**No automatic commit:** live evidence and release report are committed only
after they contain no secrets or client identifiers.
