# Keepr One — National Life Interactive Login Rollout

## Scope and non-negotiables

This rollout lets an agent authenticate directly on the real National Life or
Auth0 page inside a temporary, brokered browser modal. Keepr One never
collects, stores, autofills, logs, screenshots, replays, or sends the National
Life password or MFA value through a business API. The modal is only for
login, MFA, and reconnection; it is not a general portal browser.

The feature remains disabled until all gates in this document pass.

This document describes the remote interactive-login runtime. The local K-Bot
credential broker is a separate, opt-in path documented in
`kbot-credential-broker-runbook.md`. The remote runtime still never receives or
autofills credentials. The local path may perform one device-bound submission
only after explicit Settings consent; it cannot handle MFA/CAPTCHA and cannot
drive a general browser session. Do not share Vault identities, rollout flags,
containers or session material between these two architectures.

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
6. Use either a named pilot allowlist through
   `NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS`, or set
   `NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS=true` with an empty allowlist
   to let every authenticated agent connect only their own National Life
   account. Wildcards remain forbidden.

## Coolify deployment artifact

Import `deploy/national-life-runtime.compose.yaml` as a separate Coolify Docker
Compose service from the same Keepr One revision. It creates two Keepr One-owned
services on the private `coolify` network:

- `national-life-steel` is the isolated Steel Browser. It has no public route;
  its HTTP and CDP ports are reachable only by Docker service name.
- `national-life-runtime` is the broker/worker. Only this service receives the
  public TLS route `https://national-life-viewer.keeprone.com`.

Before starting the service, create the DNS record for the viewer hostname and
set these Coolify service secrets: `DATABASE_URL`, `BETTER_AUTH_URL`,
`NATIONAL_LIFE_SESSION_SCOPE_ID`, `NATIONAL_LIFE_SESSION_KEY_VERSION`,
`NATIONAL_LIFE_SESSION_KEYS`, `NATIONAL_LIFE_VIEWER_SIGNING_KEY`, and a unique
`NATIONAL_LIFE_RUNTIME_WORKER_ID`. Do not set `STEEL_API_KEY` for this private
self-hosted deployment unless the reviewed Steel build is explicitly configured
to require it.

The checked-in Steel image is an immutable digest, with headful sessions and
all known Steel logging switches disabled. That is defence in depth only: it
does not replace the mandatory no-recording fixture proof below. Keep
`NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED=false` in this service and in the web
application until every production gate passes. When enabling every agent,
set `NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS=true` and leave
`NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS` empty.

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

## Viewer quality profile (1600×1000 / JPEG 92)

Existing connection attempts retain their original Steel dimensions. After deployment, cancel any old attempt and start a new one.

1. On `btapps`, update the dedicated runtime source to the merged commit and rebuild the `national-life-steel` and `national-life-runtime` services with the `keeprone-national-life` Compose project.
2. Confirm both containers are running and the runtime reaches `http://national-life-steel:3000` only on the private network.
3. Start a new Keepr One connection. Confirm the complete National Life/Auth0 page is sharp, centered, and uncropped; small viewports must scale down proportionally.
4. Click username, password, and Login controls to verify pointer mapping. The agent enters credentials and MFA only in the carrier page.
5. Confirm `AUTHENTICATED`, modal closure, encrypted session persistence, and a successful read-only worker reuse.

Rollback: revert the viewer-quality PR, rebuild the same dedicated services, and use a new connection attempt. Existing encrypted contexts are unaffected.
