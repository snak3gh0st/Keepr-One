# National Life Illustration + iGO via Keepr One

Status: approved design, pending implementation plan  
Date: 2026-08-26  
Base: `origin/main` at `925d3f07925cd50ab51c6c1beb34f62d98793092`

## Objective

Make Keepr One the agent's control surface for National Life Illustration and
iGO e-App work while the local KeeproneConnect extension executes against the
agent's own authenticated Chrome session.

The agent should be able to:

1. review the exact case, insured, product and financial inputs in Keepr One;
2. create an official Foresight Illustration from Keepr One;
3. receive the official PDF, carrier identifiers and execution receipt in
   Keepr One;
4. prepare and save a reviewable iGO draft from the matching case;
5. see application status, requirements and documents in Keepr One; and
6. eventually submit from Keepr One through a separate, strongly confirmed
   action after the draft flow is proven.

The carrier remains authoritative for illustration output, application
validation, signature and submission.

## Current evidence

- The prior National Life sync and document work is already merged into
  `main` through `925d3f0`.
- Keepr One already models `Illustration`, `IllustrationScenario`,
  `Application`, `ApplicationRequirement`, connector commands, confirmations,
  events and browser jobs.
- The shared command contract already names `GENERATE_ILLUSTRATION`,
  `PREPARE_APPLICATION_DRAFT`, `UPLOAD_APPLICATION_DOCUMENT` and
  `SUBMIT_APPLICATION`, with risk-based confirmation requirements.
- KeeproneConnect `0.1.25` executes only `READ_GRID`, `READ_PAGE` and
  `READ_EXPORT`; Foresight and iGO commands are not executable locally yet.
- An authenticated read-only probe on 2026-08-26 opened Foresight at
  `/NWI/Main/Layout.aspx` and showed Illustration release `v26.0.1`, the
  `New Illustration` activity, recent cases and case-management lists.
- A second authenticated read-only probe on 2026-08-26 disproved the current
  Keepr One policy-page statement that National Life does not provide face
  amount or per-policy premium. The carrier policy detail showed Total Face
  Amount and Net Death Benefit under Coverage, plus Planned Periodic Payment,
  payment frequency, Anticipated Annual Premium, minimum premiums and CTP under
  Payments. The bulk All Clients table still omits those detail fields.
- The same session followed `/agent/sso/igo-eapp` to
  `igoforms2.ipipeline.com/CossEnterpriseSuite/SilentSignIn.aspx`, where the
  controlled Chrome reported `ERR_BLOCKED_BY_CLIENT`.
- The current extension manifest grants host access only to
  `www.nationallife.com` and Keepr One. It has no iPipeline host permissions or
  content scripts.
- The observed iGO chain includes National Life, `pipepasstoigo.ipipeline.com`
  and `igoforms2.ipipeline.com`. Older evidence also observed
  `federate.ipipeline.com`. Each origin must be authorized deliberately and
  verified before use.

## Product decisions

### Correct policy-data provenance before expanding automation

The sentence `Capital segurado e prêmio por apólice não vêm do portal` is
obsolete and must be removed. It confuses a limitation of the bulk All Clients
source with a limitation of the National Life portal as a whole.

The correct product statement is:

- the bulk All Clients table/export may omit face amount and may leave some
  premium columns empty;
- the authenticated per-policy detail exposes coverage and payment values;
- Keepr One does not yet normalize that detail source for every policy; and
- a missing Keepr One value therefore means `not synced from policy detail`,
  not `National Life does not provide it`.

The implementation must replace the stale warning and add field-level
provenance for carrier values. At minimum, the policy-detail acquisition maps:

- total face amount;
- net death benefit;
- next scheduled payment date;
- planned periodic payment;
- payment frequency;
- anticipated annual premium;
- minimum monthly and guaranteed premium;
- CTP;
- MEC and guideline premium limits; and
- carrier source timestamp.

Policy detail is an on-demand source first: fetch it when the agent opens or
refreshes a Keepr One policy, then cache the normalized result. A bounded
background backfill may follow, but the daily priority sync must not perform
approximately eleven thousand detail navigations.

### Keepr One owns orchestration

The user starts, reviews and monitors every operation in Keepr One. Carrier
tabs are execution surfaces, not the user's primary workflow.

### The initiating click is the confirmation

For a user-initiated action, the clearly labelled Keepr One button is the
explicit confirmation. There is no redundant second modal for:

- `Generate Illustration at National Life`; or
- `Prepare iGO draft`.

The screen must show the exact target and material inputs before the click. The
server records the actor, payload hash and timestamp as the confirmation.

`Submit application` remains a distinct action with a strong review screen and
fresh confirmation because it creates a binding carrier submission. It is not
enabled in the first live release.

### No autonomous carrier writes

Background execution may continue after the user leaves the Keepr One page,
but it may not originate a new Illustration, draft or submission without a
recorded user action. Schedules may refresh read-only status and documents.

### No credential vault

Keepr One and KeeproneConnect do not collect or store National Life username,
password, MFA codes, trusted-device cookies or browser profiles.

The implementation reuses the carrier's `Remember this device` state while it
is valid. That is a carrier-controlled convenience, not an authentication
guarantee.

## Architecture

```text
Keepr One review screen
  -> server-owned command + immutable input hash
  -> user click records approval
  -> KeeproneConnect polls for the approved command
  -> extension verifies auth and exact carrier target
  -> Foresight or iGO executes in the agent's Chrome session
  -> signed, ordered events + artifact receipt
  -> Keepr One persists PDF/status/external IDs
  -> case timeline and operation UI update
```

### Server responsibilities

- Scope every command by agent, deployment and connector device.
- Build a versioned immutable execution snapshot from server-owned records.
- Hash the canonical snapshot and include the hash in the command.
- Issue an idempotency key for the exact effect, not only the HTTP request.
- Record the initiating user action as approval for Illustration/draft
  commands.
- Expose only approved, unexpired commands to the assigned connector device.
- Validate ordered events and reject mismatched run IDs, hashes or sequences.
- Persist carrier receipts, documents and external references transactionally.
- Pause instead of failing when user authentication is required.

### Extension responsibilities

- Independently validate the command envelope, capability, target and input
  hash.
- Execute only capabilities included in its local allowlist.
- Use only explicitly allowed carrier origins and known navigation paths.
- Verify authentication before any carrier write.
- Verify the visible/current carrier case immediately before any write whose
  endpoint relies on server-side current-case state.
- Emit ordered progress, auth, completion and failure events.
- Never log secrets, full health answers, cookies, HTML dumps or screenshots
  containing sensitive values.
- Keep operating while the Keepr One tab is closed, as long as Chrome and the
  extension are running.

### Command payload

The command carries identifiers and a SHA-256 `inputHash`. The complete,
versioned execution snapshot is fetched through the authenticated command
endpoint and independently hashed by the extension before use.

This avoids an open-ended `Record<string, unknown>` in the executable command
parser while still allowing product-specific fields to evolve under a schema
version. A command cannot be approved for one payload and execute another.

The first Illustration snapshot contains only the fields required by the
observed Foresight product flow, including:

- Keepr One illustration and case identifiers;
- insured name, date of birth and jurisdiction;
- product and product code;
- solve method and amount;
- gender/rate class where applicable;
- death-benefit option, allocation strategy and selected riders;
- report options; and
- a deterministic carrier case name containing the Keepr One reference.

The first iGO draft snapshot contains the exact, reviewed non-clinical case,
insured, owner, beneficiary, payor, producer, product and payment fields that
Keepr One already owns. Detailed medical answers are not silently copied into
generic JSON or logs. Unmapped or sensitive sections remain visibly
outstanding until a dedicated encrypted intake and retention policy exists.

## Authentication and resumption

1. The extension performs the cheapest same-origin authenticated probe before
   crossing Foresight or iGO SSO.
2. A trusted-device session may allow the carrier to skip MFA.
3. Auth0, Foresight and iPipeline can expire independently; success on one does
   not prove the others.
4. Login, MFA, challenge or an untrusted origin produces `AUTH_REQUIRED` or
   `MFA_REQUIRED`, never an invented carrier failure.
5. The command remains paused with its immutable input and safe checkpoint.
6. Keepr One shows a persistent `Renew National Life login` action and the
   extension may open only the official carrier login page.
7. After the user completes login, the extension re-probes and resumes from the
   last safe step.
8. A write that may already have reached the carrier is reconciled by carrier
   ID/case fingerprint before retry; it is never blindly repeated.

No keep-alive repeatedly crosses Auth0 or iPipeline SSO. Read-only portal touch
may keep the portal session warm, but only an actual command crosses the
downstream SSO boundary.

## Foresight Illustration flow

### Extension surfaces

Add an isolated bridge and a narrowly scoped main-world adapter for
`https://www.nationallife.com/NWI/*`. The existing `/agent/*` content scripts
remain responsible for the agent portal.

The Foresight adapter owns selectors and service-call details. The shared
server protocol owns stable capability names, risk and payload validation.

### Execution

1. Open the official National Life Foresight SSO route once.
2. Reject Auth0, `/Unsecure/`, login, challenge or unexpected-origin landings.
3. Open `New Illustration` or the exact carrier case dictated by the command.
4. Discover and validate the expected product/form schema version.
5. Fill the immutable snapshot without saving.
6. Read back the material values and compute a carrier target fingerprint.
7. If the read-back differs, stop in `MANUAL_REVIEW` before writing.
8. Create/save the carrier Illustration once.
9. Reconcile the carrier case name/external key.
10. Run the requested official report once.
11. Download the PDF and verify MIME type, `%PDF-` magic bytes, byte length and
    SHA-256.
12. Upload the artifact through the existing signed chunk/document transport.
13. Persist the official `Illustration`, document metadata, carrier IDs and
    timeline receipt in Keepr One.

Foresight endpoints such as `IllustrateCase`, `RenderReports` and
`SetupEAppLauncher` depend on the current server-side case. The executor must
therefore verify the current case immediately before each such operation and
must serialize Foresight writes per connector session.

## iGO draft flow

### Origin policy

Start with only the origins observed in the authenticated chain. Add another
iPipeline origin only after a diagnostic receipt identifies it. Wildcards such
as `https://*.ipipeline.com/*` are not allowed for the production manifest.

The initial candidates are:

- `https://pipepasstoigo.ipipeline.com/*`;
- `https://igoforms2.ipipeline.com/*`; and
- `https://federate.ipipeline.com/*` only if the live chain uses it.

The `ERR_BLOCKED_BY_CLIENT` seen in the controlled Chrome is a diagnosed
gateway blocker, not proof that the agent's normal Chrome will fail. The
extension build must probe and classify the actual browser path.

### Execution

1. Start from the exact official Foresight Illustration when possible.
2. Verify the Foresight case fingerprint immediately before calling the e-App
   launcher because `SetupEAppLauncher` carries only the session token and
   relies on the current case.
3. Traverse the official SSO/launcher chain without reading or exporting
   session material.
4. Reject unexpected origins and record only safe redirect diagnostics.
5. Discover iGO sections and required-field metadata before filling.
6. Match the returned product/case/insured identity against the command.
7. Fill only fields present in the reviewed execution snapshot.
8. Read back material values and show unmapped/required sections in Keepr One.
9. Save one draft and capture the iGO external application ID and status.
10. Synchronize status, requirements and available documents into the existing
    Keepr One `Application` and `ApplicationRequirement` models.
11. Stop at the reviewable draft boundary.

The first production release does not call final-submit controls. The
`SUBMIT_APPLICATION` capability remains protocol-defined but locally disabled
until draft creation and reconciliation have passed dedicated live validation.

## UX states

The user-visible operation card uses stable, plain-language states:

- Ready to generate
- Waiting for KeeproneConnect
- Working in National Life
- Login required
- Needs review
- Illustration ready
- Preparing iGO draft
- Draft ready for review
- Failed safely

Leaving the page does not cancel work. Reopening the case shows the current
state from the server. Login-required notifications link to the official
National Life login action and never request credentials inside Keepr One.

Each completed operation shows:

- carrier target;
- initiated by / initiated at;
- completed at;
- payload hash prefix;
- carrier external ID;
- PDF/document hash when applicable; and
- a safe error or review reason when incomplete.

## Idempotency and concurrency

- One active Illustration-generation command per agent and Keepr One
  illustration input hash.
- One active iGO-draft command per Keepr One application input hash.
- One carrier-write command at a time per connector/Foresight session.
- A retry first searches for the deterministic case name, external ID or
  completed artifact.
- Duplicate completion events are accepted idempotently; conflicting hashes or
  external IDs go to manual review.
- A changed input creates a new command and never mutates an approved command.

## Security and privacy

- Least-privilege host permissions; no iPipeline wildcard.
- Strict origin, path, message-shape, sequence, size and hash checks on both
  sides of the extension boundary.
- No passwords, MFA codes, cookies, authorization headers or session tokens in
  Keepr One storage, command events or diagnostics.
- No persistent raw DOM/HTML or screenshots from iGO.
- Sensitive field values are redacted from logs and error payloads.
- Documents use the existing signed chunk transport, server validation and
  persistent uploads volume.
- Carrier results are scoped by agent/deployment/device and linked to the exact
  Keepr One case.
- Final submission requires a fresh payload hash and cannot reuse draft
  approval.

## Testing strategy

### Automated

- Pure contract tests for command parsing, hashes, risk and confirmation.
- Server tests for ownership, device scope, expiry, idempotency, approval and
  ordered event reconciliation.
- Extension tests for origin/path allowlists and rejection of unknown commands.
- DOM/service fixtures for Foresight form discovery, read-back verification,
  current-case mismatch and PDF validation.
- iGO gateway/section fixtures covering redirect classification, required
  fields, draft save, status sync and blocked origins.
- State-machine tests for auth pause/resume and uncertain-write reconciliation.
- UI tests showing click-as-confirmation, background progress, login required,
  review and receipts.
- Typecheck, lint and targeted app/worker/extension suites during iteration;
  the full relevant suites before release.

### Authorized live smoke

The user authorized creation of one synthetic Foresight Illustration at the
end of implementation. The default test data is:

- insured: `KeeprOne Test`;
- date of birth: `01/01/1990`;
- jurisdiction: Florida;
- product: FlexLife;
- face amount: USD 100,000;
- rate: standard non-tobacco where the product requires it;
- no optional riders unless the carrier requires a default; and
- carrier case name prefixed with `KEEPRONE-TEST-20260826`.

The smoke must prove:

1. initiation from Keepr One;
2. no redundant confirmation dialog;
3. background continuation after leaving the page;
4. exact target read-back before save;
5. one and only one carrier Illustration;
6. official PDF returned, byte/hash validated and rendered in Keepr One;
7. receipt and timeline persistence; and
8. safe handling of an auth interruption if one occurs.

The smoke does not create an iGO application, save an iGO draft or submit
anything. A separate explicit authorization and synthetic application dataset
are required for the first live iGO write.

## Delivery sequence

1. Correct the stale policy-data warning and add on-demand policy-detail
   acquisition/provenance.
2. Local command transport and auth pause/resume.
3. Foresight executor and official Illustration persistence.
4. Keepr One Illustration UX and receipts.
5. iGO origin probe and gateway bridge.
6. iGO form discovery, reviewed prefill and draft persistence.
7. Status/requirements/document reconciliation.
8. Automated validation and the authorized live Illustration smoke.
9. Controlled rollout with submission still disabled.
10. Separate review before enabling final iGO submission.

## Acceptance criteria

- The entire supported workflow is started and monitored in Keepr One.
- KeeproneConnect uses the agent's current National Life session and never
  stores carrier credentials.
- Trusted-device login is used opportunistically and expired authentication is
  surfaced honestly with resumable work.
- A user click is sufficient authorization for its exact Illustration or draft
  payload; no duplicate modal is shown.
- No carrier write occurs from an unapproved background trigger.
- Every write verifies the exact carrier target immediately beforehand.
- Retries cannot create duplicate Illustrations or applications.
- The official PDF and its provenance are available in Keepr One.
- Keepr One no longer claims that National Life lacks face amount or premium;
  policy-detail values retain their carrier source and freshness.
- iGO draft status and requirements are linked to the correct Keepr One case.
- Sensitive application data does not appear in logs, diagnostics or raw DOM
  snapshots.
- Final iGO submission remains disabled until separately validated and
  approved.

## Out of scope for the first release

- Storing National Life or iPipeline credentials.
- Bypassing MFA, CAPTCHA or carrier risk controls.
- Automated final iGO submission.
- Unattended creation of carrier artifacts.
- Broad `*.ipipeline.com` host access.
- Full medical-questionnaire storage without a dedicated encrypted data model,
  access policy and retention decision.
