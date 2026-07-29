# Keepr One — National Life Interactive Login Rollout

## Scope and non-negotiables

This rollout lets an agent authenticate directly on the real National Life or
Auth0 page inside a temporary, brokered browser modal. Keepr One never
collects, stores, autofills, logs, screenshots, replays, or sends the National
Life password or MFA value through a business API. The modal is only for
login, MFA, and reconnection; it is not a general portal browser.

The feature remains disabled until all gates in this document pass.

## Deploy in stages

1. Back up the production database, then deploy the additive migration and web
   code with `NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED=false`.
2. Deploy `Dockerfile.national-life-runtime` as a dedicated Coolify service.
   Give it private access to the pinned self-hosted Steel instance and expose
   only the public viewer-broker origin. Do not run database migrations in this
   runtime service.
3. Configure unique, non-placeholder values for `STEEL_BASE_URL`,
   `NATIONAL_LIFE_SESSION_SCOPE_ID`, `NATIONAL_LIFE_SESSION_KEY_VERSION`,
   `NATIONAL_LIFE_SESSION_KEYS`, `NATIONAL_LIFE_VIEWER_SIGNING_KEY`,
   `NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN`, `NATIONAL_LIFE_VIEWER_BIND_HOST`,
   `NATIONAL_LIFE_VIEWER_PORT`, `NATIONAL_LIFE_RUNTIME_WORKER_ID`, and
   `BETTER_AUTH_URL`. Keep `STEEL_API_KEY` private to the runtime.
4. Confirm `/health`, database connectivity, a single active runtime worker
   ID, and Steel cleanup after a cancelled attempt.
5. Verify the exact pinned self-hosted Steel image digest, `headless: false`,
   no recorder extension, empty replay-event response, no HLS/MP4 output, no
   screenshots, and retention cleanup using an interactive fixture session.
6. Enable only named pilot agents with
   `NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS`; wildcard access is forbidden.

## Required authorized pilot

Before enabling beyond the pilot, obtain confirmation that the organization's
National Life agreement and portal terms permit this browser access and data
handling. An authorized agent must complete this exact proof:

```text
real portal rendered
-> password entered by agent
-> MFA completed
-> authenticated marker detected
-> modal closes
-> encrypted context restored by a separate read-only job
-> case read succeeds
-> expired session requires reconnect
-> disconnect removes the context and Steel resources
```

For the same pilot session, prove that there are no replay events, recording
playlist, MP4/HLS object, screenshot, or retained viewer artifact. Search app,
runtime, and database evidence for a controlled password test marker; the
expected count is zero. Record authorization confirmation and proof artifacts
without including credentials, cookies, tokens, applicant data, or debug URLs.

## Rollback

Disable the feature, stop new connection attempts, and allow the runtime to
clean active Steel sessions. Keep encrypted browser context only while
investigating. The legacy credential table remains inaccessible to runtime
code; never restore password-based automation as a rollback method.

## Legacy credential purge gate

Do not create or apply the destructive credential-purge migration until all
pilot gates pass and an explicit approval is recorded. First report the exact
legacy credential row count, connected pilot-session count, last successful
context-restore timestamp, backup/retention state, and exact SQL. Only then
may the separately approved migration remove `AgentIntegrationCredential`.

## Current verification boundary

Focused implementation checks passed for the interactive UI, backend, session
restore, runtime, TypeScript, lint scope, and container images. A fixture E2E,
real National Life login, provider authorization, no-recording runtime proof,
and production deployment remain external gates; this document does not claim
they were completed locally.
