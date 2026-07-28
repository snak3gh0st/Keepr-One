# Keepr One National Life Interactive Login Design

Date: 2026-07-28  
Status: Approved

## Purpose

Replace the current Keepr One connection experience that collects and stores a
National Life username and password with an interactive login against the real
National Life Agent Portal.

The agent opens a secure browser window inside Keepr One, enters credentials and
completes MFA directly in the National Life page, and returns automatically to
Keepr One after the carrier confirms authentication. Keepr One stores only the
encrypted authenticated browser state required by the existing National Life
browser adapter. It never stores the National Life password.

This specification supersedes the credential-entry, credential-vault and
per-job password-login portions of
`2026-07-27-national-life-browser-agent-design.md`. The durable job queue,
isolated Steel Browser worker, deterministic adapter, carrier allowlist, audit
rules and National Life source-of-truth boundary remain in force.

## Product Decisions

- The product name is **Keepr One** in all interface text, documentation and
  operational messages.
- The selected layout is a centered, near-full-screen secure browser window.
- The content is the live National Life/Auth0 page rendered by the real isolated
  Steel Browser session. Keepr One does not reproduce or restyle the carrier
  login form.
- The interactive window is available only for initial login, MFA and
  reconnection. It is not a permanent general-purpose carrier browser.
- The window closes automatically only after the worker proves that the browser
  reached an authenticated National Life portal state.
- Keepr One stores encrypted authenticated browser state, never the National
  Life password.
- When the carrier session expires or is invalidated, automation stops and the
  owning agent is asked to reconnect.

## Alternatives Considered

### Existing password vault

Keepr One could keep the current username/password form and use the stored
credential for every new browser session. This supports unattended relogin but
requires Keepr One to retain a high-value carrier password and does not provide
the requested trust experience. Rejected.

### Interactive login with encrypted session state

The agent authenticates directly in the live remote browser. Keepr One retains
only encrypted cookies and supported origin/profile state, then restores that
state for authorized adapter jobs. This minimizes secret handling and gives the
agent direct visibility into the official portal. Selected.

### Official SSO or carrier API

An authorized National Life SSO, delegated OAuth flow or supported carrier API
would be preferable to browser adaptation. The current product must not assume
that capability exists, but the connector boundary must allow it to replace the
browser transport later without changing Keepr One case workflows.

## User Experience

### Not connected

The National Life integration page shows:

- carrier name and connection purpose;
- status `Não conectada`;
- primary action `Conectar National Life`;
- concise assurance that login occurs directly on the official carrier page
  and that Keepr One does not store the password.

The existing Keepr One username and password fields are removed.

### Opening the portal

Selecting `Conectar National Life` creates a single-use, agent-owned connection
attempt. The centered browser window opens with:

- title `Entrar na National Life`;
- a Keepr One security bar outside the remote page;
- the verified current origin, restricted to approved National Life and Auth0
  origins;
- a visible `Sessão segura e isolada` indicator;
- a countdown for the connection attempt;
- a close action that cancels and destroys the attempt.

The address display is read-only. It must not accept arbitrary navigation.

### Login and MFA

Keyboard and pointer input are delivered to the live remote browser. Credentials
and MFA values are submitted directly to the carrier page inside that browser.
Keepr One must not mirror input values into application state, analytics, logs,
screenshots, recordings or support tooling.

The same window remains open when Auth0 or National Life presents MFA. Keepr One
does not bypass MFA or CAPTCHA.

### Successful connection

The worker recognizes a deterministic authenticated carrier marker and verifies
that the current origin remains allowlisted. It then:

1. captures only the browser state required to resume the authenticated session;
2. encrypts and binds it to the agent, organization and provider;
3. destroys the interactive Steel session;
4. closes the browser window;
5. refreshes the integration page to `Conectada`.

The connected summary shows last connection time, last successful use and a
`Desconectar` action. It may show a carrier-provided masked agent identity only
when that value can be collected without expanding sensitive-data scope.

### Reconnection

When an adapter job proves that the carrier session has expired, the job moves
to `ACTION_REQUIRED` without retrying credentials. Keepr One deletes the
unusable session state and shows `Reconectar National Life`. Reconnection uses
the same interactive flow.

## Architecture

### Components

1. **Keepr One connection UI**
   creates, displays and closes an agent-owned connection attempt. It never
   models, reads or stores credential field values.
2. **Connection session service**
   authorizes ownership, enforces one active attempt per agent, creates
   short-lived attempt tokens and manages lifecycle state.
3. **Interactive browser broker**
   exposes only the approved Steel live-view traffic through an authenticated,
   short-lived Keepr One endpoint. It does not expose the raw Steel `debugUrl`
   as durable client state.
4. **Steel Browser session**
   loads the official National Life login path in an isolated context and
   accepts the agent's direct interaction.
5. **Authentication detector**
   uses deterministic origin, URL and portal markers to distinguish login, MFA,
   success and unexpected layout states.
6. **Encrypted session store**
   stores authenticated browser state with envelope encryption and explicit
   expiration metadata.
7. **National Life adapter**
   restores the agent's authenticated state in an isolated browser job and
   continues converting carrier pages into Keepr One domain records.

### Browser broker boundary

The frontend receives an opaque connection-attempt identifier and short-lived
access token. Keepr One proxies the required Steel HTTP and WebSocket live-view
traffic and validates:

- authenticated Keepr One user;
- owning agent and organization;
- matching active connection attempt;
- token expiration and one-session concurrency;
- allowlisted carrier/Auth0 destination;
- allowed live-view protocol operations.

The broker cannot accept an arbitrary URL, Playwright command or script from the
frontend. The raw Steel websocket endpoint, API key and durable debug URL remain
server-side. Encrypted pointer and keyboard events pass through the live-view
transport, but the broker treats them as opaque protocol traffic and does not
inspect, reconstruct, record or persist entered values.

### Session persistence

The persisted record contains:

- agent, organization and provider ownership;
- connection status and timestamps;
- encryption algorithm and key version;
- unique IV/nonce, ciphertext and authentication tag;
- authenticated browser-state format version;
- carrier-session expiration when it can be determined;
- last successful restore/use timestamp.

Associated authenticated data binds ciphertext to its agent, organization,
provider and record purpose. AES-256-GCM remains the required baseline. A
restored session is treated as untrusted until the adapter proves the
authenticated portal marker.

The implementation replaces the existing password ciphertext record. After the
new flow is deployed and verified, legacy National Life password ciphertext,
username values that are no longer required and their obsolete encryption
metadata are purged through an explicit, auditable migration. They are never
converted into the new session record.

## State Model

User-visible connection states are:

- `NOT_CONNECTED` — no reusable carrier session exists;
- `OPENING_PORTAL` — Steel session and broker are being prepared;
- `AWAITING_LOGIN` — live carrier login is ready;
- `AWAITING_MFA` — carrier requires agent interaction;
- `CONNECTED` — encrypted state was saved and restore was proven;
- `SESSION_EXPIRED` — carrier rejected or invalidated restored state;
- `UNAVAILABLE` — temporary Steel, broker or carrier failure.

An agent can have only one active interactive attempt. Closing, timeout,
disconnect, ownership loss or logout transitions the attempt to a terminal state
and releases its Steel session.

## Security and Privacy

- Each browser context and persisted session belongs to exactly one agent.
- Organization administrators may inspect status but cannot open, export or use
  another agent's session.
- National Life/Auth0 credentials and MFA values never enter Keepr One form
  state, business API fields, server actions, database fields, job payloads or
  audit events. Their keystrokes exist only as opaque encrypted live-view
  protocol traffic until the remote browser submits them to the carrier.
- Input and remote page contents are excluded from logging, screenshots,
  session replay and analytics.
- Clipboard integration and file upload are disabled during connection unless a
  real carrier login requirement is separately reviewed and approved.
- Navigation is restricted to verified National Life/Auth0 origins and expected
  redirect paths. An unexpected origin immediately terminates the attempt.
- Attempt creation and reconnect actions require authentication, ownership,
  CSRF protection, rate limits and safe audit events.
- Tokens are short-lived, single-purpose and never placed in analytics or
  referrer-bearing URLs.
- Browser state is encrypted in transit and at rest and is never returned by a
  general application API.
- Disconnect deletes the persisted state and releases active remote sessions.
- Keepr One logout closes an active interactive attempt but does not silently
  transfer its carrier session to another Keepr One user.

Production use still requires confirmation that the organization's National
Life agreement and portal terms authorize the browser access and intended data
handling.

## Error Handling

- Carrier credential errors remain inside the official carrier page. Keepr One
  adds only a neutral instruction and does not infer which credential was wrong.
- MFA timeout closes the interactive session and requires a new connection
  attempt.
- A carrier/Auth0 redirect outside the allowlist immediately cancels the
  attempt and records a redacted security event.
- If carrier authentication succeeds but encryption or persistence fails,
  Keepr One destroys the remote session and remains `NOT_CONNECTED`.
- A lost frontend connection does not mark success. The server retains the
  attempt only until its short deadline, allowing same-agent reconnection to the
  same live session when safe.
- A portal layout change moves the connection or adapter job to manual review;
  it does not trigger blind retries or password collection.
- If a restored session is rejected, the adapter stops before reading or
  changing carrier data, deletes the invalid state and requests reconnection.

## Testing and Acceptance

### Automated

- attempt creation requires the owning authenticated agent;
- cross-agent and cross-organization attempt access is denied;
- only one active attempt exists per agent;
- short-lived broker tokens expire and cannot be replayed;
- non-allowlisted origins and unsupported broker commands are blocked;
- login/MFA values never appear in Keepr One business requests, database
  records, logs or analytics fixtures;
- authenticated state encrypts and decrypts only under matching associated data;
- successful login closes and releases the interactive Steel session;
- failed persistence never reports `CONNECTED`;
- session restore requires a fresh authenticated carrier marker;
- expiration deletes unusable state and produces `SESSION_EXPIRED`;
- disconnect purges state and active sessions;
- adapter jobs cannot fall back to stored passwords;
- status transitions reject impossible or stale updates.

### Authorized real-portal gate

Before production enablement, an authorized National Life agent must prove:

1. the actual carrier login page renders and accepts interaction in the Keepr One
   window;
2. Auth0 redirects and MFA remain within the reviewed allowlist;
3. Keepr One does not collect, inspect, log or store credential values outside
   the opaque encrypted live-view transport;
4. successful login is detected from a deterministic authenticated marker;
5. the encrypted browser state can restore an authenticated session in a new
   worker job;
6. expired state produces reconnection instead of repeated login attempts;
7. closing and disconnecting remove active browser resources and stored state.

If the carrier prevents restoration of authenticated browser state, Keepr One
must request interactive login for each new carrier session rather than
reintroducing password storage.

## Rollout

1. Add the interactive attempt and encrypted browser-session boundaries behind a
   disabled feature flag.
2. Replace the credential form with the approved centered browser flow in a
   non-production environment.
3. Prove broker isolation and complete the authorized real-portal gate.
4. Enable the new flow for a limited set of National Life agents.
5. Confirm adapter syncs restore the new session state successfully.
6. Disable password-based login and purge legacy credential ciphertext through
   an audited migration.
7. Expand availability while monitoring connection success, MFA waits, session
   expiration, restore failures and resource cleanup.

## Non-Goals

- General browsing of the National Life portal inside Keepr One.
- Bypassing CAPTCHA or MFA.
- Capturing or autofilling the agent's National Life password.
- Sharing carrier sessions between agents.
- Reproducing the National Life login UI.
- Treating browser adaptation as an official carrier API.
- Changing the existing case, application, requirement or sync domain model
  beyond what session-based authentication requires.
