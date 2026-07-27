# National Life Browser Agent Design

## Status

Approved product and architecture design for the first National Life Group browser integration. This specification supersedes the iPipeline/iGO dependency and the browser-automation exclusion in `2026-07-22-fyntra-distribution-os-design.md` for this integration only.

## Objective

Make Fyntra the operating workspace for National Life Group life-insurance business without using iPipeline. An authorized browser worker acts on behalf of the signed-in agent in the National Life Agent Portal to:

- read cases, underwriting status, requirements, communications and documents;
- synchronize that information into the existing Fyntra case timeline;
- later create and complete application drafts, upload documents and submit after explicit human approval.

National Life remains the authoritative source for carrier status, requirements, application acceptance, issue and placement. Fyntra is the operational system of engagement and an audited mirror of carrier data.

## Scope

The initial scope has one carrier and one line of business:

- Carrier: National Life Group.
- Business: life insurance only.
- Agent identity: one National Life credential set per Fyntra agent.
- Initial proof of concept: read-only case synchronization against the real portal.
- Later phase: assisted application preparation and submission.

Annuities, additional carriers, illustration-engine replacement, autonomous underwriting decisions and unattended final submission are out of scope.

## Repository and Runtime Decision

The browser stack is:

- `microsoft/playwright` as the deterministic automation API;
- `steel-dev/steel-browser`, self-hosted, for browser sessions and infrastructure;
- `browserbase/stagehand` only as an optional recovery layer for low-risk page discovery after deterministic selectors fail;
- `daijro/camoufox` only as an optional compatibility fallback if measured portal behavior proves it necessary.

Camoufox is not the default because browser fingerprint evasion adds operational and compliance complexity. Stagehand must never independently decide to submit an application. Browser Use is not part of the core stack because the worker is TypeScript-based and regulated steps require deterministic execution.

## Architecture

The integration consists of four boundaries:

1. The Fyntra web application authenticates the agent, enforces ownership and exposes connection, sync and review workflows.
2. A server-side credential vault encrypts each agent's National Life credentials.
3. A durable TypeScript automation worker consumes authorized jobs and controls Playwright sessions through self-hosted Steel Browser.
4. A National Life adapter converts portal pages and downloads into Fyntra's existing `Application`, `ApplicationRequirement`, `ExternalReference` and `SyncEvent` records.

The browser worker is not exposed directly to the frontend. It accepts structured jobs containing internal identifiers and approved operations, not arbitrary URLs or scripts. Navigation is restricted to an explicit allowlist of verified National Life domains and redirects.

## Connection Experience

Fyntra provides a **Conexão National Life** area for the current agent.

The agent can:

- enter username and password;
- save or replace credentials;
- run a connection test;
- see connection state and last successful use;
- disconnect and delete the stored credential;
- resume a job waiting for MFA.

The password is accepted only over TLS and sent directly to a server action or API endpoint with CSRF protection. It is never returned by an API, rendered after saving, stored in browser storage or included in analytics.

The interface displays masked identity metadata only when useful, such as the National Life username with most characters hidden. Saving credentials does not imply that a connection test succeeded.

## Credential Security

Each credential belongs to exactly one Fyntra agent. Organization administrators can inspect connection status but cannot retrieve or use the plaintext password.

Credential storage uses envelope encryption:

- an authenticated encryption algorithm such as AES-256-GCM;
- a unique nonce or IV for every encryption;
- ciphertext, authentication tag and key version stored server-side;
- the master key supplied through the deployment secret manager or KMS, never committed to source or stored beside ciphertext;
- associated authenticated data binding ciphertext to the agent, organization and provider;
- key rotation supported through the stored key version.

Plaintext exists only in memory for the shortest practical period while creating the authorized browser session. It must not be persisted in job payloads, queue backends, traces, screenshots, exception objects or support tooling.

Credential endpoints require:

- an authenticated agent;
- server-side organization and record-ownership checks;
- runtime request validation;
- CSRF protection for browser-originated mutations;
- rate limiting for save, test and login attempts;
- audit events that contain action, actor, result and timestamp but no secret.

Authentication failures must use generic user-facing messages where additional detail could disclose credential state. Logs apply centralized redaction to password-like fields, cookies, authorization headers, session tokens and sensitive applicant data.

## Browser Session Rules

Every run uses the credential of the agent who owns the case or explicitly initiated the operation. Credentials and authenticated browser state are never shared between agents.

Sessions are:

- short-lived and isolated by agent and job;
- encrypted in transit between Fyntra, the worker and Steel;
- destroyed or invalidated after completion, timeout or disconnect;
- subject to bounded idle and total execution timeouts;
- prevented from navigating to non-allowlisted origins.

MFA and CAPTCHA are human-intervention boundaries. The worker pauses in `WAITING_FOR_MFA`, surfaces a time-limited continuation to the owning agent and resumes only after that agent completes the challenge. Fyntra does not attempt to bypass CAPTCHA or automate an MFA factor.

## Read-Only Synchronization

The first proof of concept performs:

1. The agent starts a manual sync for an existing Fyntra case.
2. Fyntra authorizes access and creates an idempotent sync job.
3. The worker opens an isolated National Life session and authenticates.
4. If required, the run pauses for agent-completed MFA.
5. The worker searches by approved case identifiers.
6. The adapter extracts case status, underwriting status, outstanding requirements, carrier communications and available documents.
7. Payloads are validated and normalized.
8. Fyntra upserts external references, application state and requirements, and appends timeline-visible sync events.
9. The run records completion time, source and a redacted operational summary.

Scheduled synchronization can be added after the manual flow is stable. It runs only for agents with a healthy connection and must respect portal terms, concurrency limits and measured rate limits.

## Data Mapping

The implementation extends the existing integration seams rather than creating duplicate case or policy models:

- `IntegrationConnection` represents National Life connectivity and health.
- A new per-agent secret record stores encrypted credential material because the current provider-level connection is not sufficient for individual identities.
- `Application` stores the National Life application identifier and normalized status.
- `ApplicationRequirement` stores normalized requirement state while retaining the original carrier label.
- `ExternalReference` maps Fyntra records to National Life identifiers.
- `SyncEvent` records each inbound observation or outbound operation, idempotency identity, state and audit metadata.

Raw portal data is retained only when needed for audit or replay, with sensitive-field filtering and an explicit retention period. Carrier labels and source timestamps are retained so normalization never destroys source evidence.

Downloaded documents are validated by expected content type and file signature, size-limited, malware-scanned, stored outside the public web root and served only through authorized download handlers. Filenames from the portal are treated as untrusted metadata.

## Application Preparation and Submission

Write operations are a later phase and use deterministic, checkpointed steps:

1. An agent opens a Fyntra case and requests a National Life application draft.
2. Fyntra validates required case parties, ownership, product context and available applicant data.
3. The worker creates or reopens a draft and fills only explicitly mapped fields.
4. Uploads are validated before being attached.
5. The worker saves the carrier draft and returns a field-level completion summary.
6. Fyntra presents a review screen showing supplied values, missing items, warnings and carrier identifiers.
7. The authorized agent explicitly approves final submission.
8. A dedicated submission job reopens and reconciles the draft before performing the final carrier action.
9. Fyntra records the carrier response and continues read synchronization.

The worker cannot infer applicant answers, attestations, signatures, health facts or replacement answers. Missing or ambiguous fields stop the workflow for human input.

The final submit action cannot be triggered by a scheduler, recovery model or generic retry. It requires a recent, case-specific approval from an authorized agent and an immutable audit record linking the approval to the reviewed draft version.

## Policy Creation Boundary

Submitting or approving an application does not create a Fyntra `Policy`.

A policy is created only when National Life reports an authoritative issued or placed event with sufficient policy identity. The creation operation is idempotent and links the policy to the originating case/application and National Life external identifier.

If status regresses or differs between portal pages, the integration retains the observations and routes the discrepancy to manual review rather than fabricating a policy transition.

## Job State Machine

Browser jobs use explicit states:

- `QUEUED`
- `RUNNING`
- `WAITING_FOR_MFA`
- `WAITING_FOR_REVIEW`
- `RETRYABLE`
- `CREDENTIALS_EXPIRED`
- `MANUAL_REVIEW`
- `SUCCEEDED`
- `FAILED`
- `CANCELLED`

Only one active mutating job may exist for the same National Life application. State changes are append-only audit events even when the current state is also materialized for efficient querying.

Retries use bounded exponential backoff with jitter for transient navigation, network and portal-availability failures. Authentication errors are not retried indefinitely. Deterministic selector failure captures restricted diagnostics and moves the job to manual review.

## Ambiguous Submission Safety

A timeout or browser failure after the final click is an ambiguous result, not a failed submission.

The worker must:

1. mark the job for reconciliation;
2. search National Life using the known draft, applicant and case identifiers;
3. inspect whether a submission identifier or submitted state exists;
4. record the observed outcome;
5. require manual review if the result remains uncertain.

It must never blindly click submit again. Idempotency keys prevent duplicate Fyntra jobs, but carrier-side reconciliation is the required protection when the portal does not provide an idempotent API.

## Portal Change and Recovery Policy

Selectors are versioned within the National Life adapter and prefer stable labels, roles and domain identifiers over visual position. Extracted values pass schema and semantic validation before persistence.

When the portal changes:

- the worker stops before any unsafe or irreversible action;
- it records the failed adapter step and a sanitized DOM/trace reference;
- screenshots and traces redact or avoid credentials, SSNs, health data and session tokens;
- the job enters `MANUAL_REVIEW`;
- a developer updates and verifies the adapter against approved fixtures and an assisted real-portal smoke test.

Stagehand may propose or execute recovery only for explicitly classified low-risk read/navigation steps. It cannot handle credentials, alter applicant answers, approve disclosures, sign or submit.

## Observability and Audit

Every run records:

- organization, owning agent, case and application IDs;
- operation type and adapter version;
- state transitions and timestamps;
- external identifiers discovered;
- counts of normalized records;
- approval identity and reviewed draft version for submission;
- sanitized failure category and diagnostic reference.

Metrics cover queue age, runtime, success rate, MFA waits, credential failures, selector failures, reconciliation outcomes and portal throttling. Alerts must avoid applicant details and secrets.

Audit records are immutable to normal application users. Access to restricted diagnostics is role-limited and itself audited.

## Test Strategy

### Contract and Security Tests

- credential encryption/decryption, wrong associated data and key rotation;
- authorization across agents and organizations;
- response, log, trace and job-payload redaction;
- request validation, CSRF and rate limits;
- allowlisted navigation and redirect rejection;
- idempotency and state-transition rules;
- document type, size, filename and malware-scan handling;
- policy creation only from authoritative issue/placement observations.

Tests use synthetic, redacted fixtures. Real credentials and applicant data never enter source control or test snapshots.

### Simulated Portal Tests

A controlled portal fixture covers:

- login success and failure;
- MFA pause and resume;
- case search and no-result behavior;
- status, requirement, communication and document extraction;
- expired sessions and portal throttling;
- changed selectors and semantic validation failure;
- application drafting, field mapping and upload;
- human review gate;
- successful submission;
- timeout before submission and ambiguous timeout after submission;
- reconciliation that prevents duplicate submission.

### Real Portal Validation

The proof of concept requires an assisted smoke test with an authorized National Life test or agent account:

- authenticate without recording secrets;
- complete MFA manually if presented;
- find a known, permitted case;
- read and compare status and requirements;
- verify Fyntra normalized output and audit records;
- confirm cleanup of browser state.

The read-only proof of concept performs no application submission. Write operations require a separately approved test protocol and safe carrier/account context.

## Delivery Phases

### Phase 1: Read-Only Proof of Concept

- per-agent encrypted National Life connection;
- self-hosted Steel and TypeScript Playwright worker;
- manual login test and MFA handoff;
- manual sync for one known case;
- status, requirements, communications and document metadata;
- audit, redaction and manual-review diagnostics;
- simulated tests plus assisted real-portal verification.

### Phase 2: Operational Read Sync

- scheduled synchronization;
- bounded concurrency and rate controls;
- document download and secure storage;
- timeline alerts for changed status and requirements;
- connection-health and operations views.

### Phase 3: Assisted Application

- mapped application drafting;
- validated uploads;
- field-level review;
- explicit human submission approval;
- ambiguous-result reconciliation;
- continued case and issue synchronization.

### Phase 4: Policy Activation

- authoritative issued/placed detection;
- idempotent policy creation;
- linkage to application and case;
- ongoing in-force synchronization as separately specified.

## Acceptance Criteria for the Proof of Concept

The first phase is complete only when:

- an agent can save, replace, test and delete their encrypted credential without it being returned or logged;
- one authorized real-portal session can pause for MFA and resume;
- a known National Life life-insurance case can be found;
- status and requirements match a human comparison against the portal;
- repeated sync does not duplicate records or timeline events;
- an agent cannot access or execute another agent's connection or case;
- browser state is destroyed after completion;
- security and simulated portal tests pass;
- failures expose actionable sanitized diagnostics;
- no write or submission action occurs.

## Preconditions and External Boundaries

Implementation and production use require confirmation that the organization's National Life agreement and portal terms authorize this automated access and the intended data handling. Portal behavior, MFA methods, available fields and rate limits must be verified with an authorized account.

The design does not promise that browser automation is as stable as a supported carrier API. If National Life provides an authorized API, feed or webhook for a capability, the adapter should prefer it while preserving the same Fyntra domain and audit contract.

