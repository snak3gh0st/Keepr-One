# National Life Browser Fleet Design

**Status:** Proposed for review

**Goal:** Support up to 100 simultaneous, agent-owned National Life login/MFA sessions and subsequent read-only Foresight synchronization without sharing browser state between agents or depending on one overloaded runtime host.

## Decision

Validate a provider-neutral browser fleet in an isolated test environment first. Keep the current Steel deployment as the production fallback during the test. After the test is approved, move the browser fleet to dedicated private infrastructure and enable the multi-session rollout in stages.

The first candidate backend is self-hosted Browserless because it provides browser session APIs, private deployment, session management and debugging capabilities. Steel remains an explicit fallback backend because the current application already uses its viewer and privacy patches. The application must not make the queue, viewer, or National Life adapter depend directly on either vendor.

Browserbase cloud is excluded from the credential-entry path. Owner credentials and MFA are handled only by browsers running inside infrastructure controlled by the deployment.

## Current capacity boundary

The current `btapps` host has 4 vCPUs and approximately 8 GB RAM while also running the main application, databases, monitoring and Coolify services. A single live Steel browser currently consumes roughly 575 MB in this environment. That is an observation, not final sizing, but it proves the current shared host is not the target for 100 concurrent interactive browsers.

No 100-session load test may run against this shared production host. A capacity test must use a disposable or isolated environment and synthetic portal pages first.

## Target architecture

```text
Agent browser
    |
    v
Keepr web app + authenticated viewer broker
    |
    v
Durable attempt/session coordinator
    |                 \
    |                  +--> Redis or equivalent queue/backpressure
    v
Private browser fleet (sharded)
    |-- browser shard A
    |-- browser shard B
    `-- browser shard N
    |
    v
National Life / Auth0 / Foresight

PostgreSQL remains the source of truth for attempts, leases, encrypted context,
agent ownership, sync runs and audit records.
```

### Web and API layer

The existing web application continues to own authentication, agent authorization, attempt creation, viewer bootstrap and user-visible status. It never receives a National Life password or MFA value. The viewer broker remains the only public entry point to an interactive browser and exposes no raw vendor websocket, API key or debug URL.

### Durable session coordinator

Introduce a provider-neutral coordinator between the web/runtime code and the browser backend. It owns:

- one active interactive attempt per agent/provider/scope;
- global admission limits and per-shard capacity;
- a durable assignment of attempt to browser shard and browser session;
- heartbeat and lease renewal;
- exponential reconnect backoff with a bounded retry budget;
- terminal handling for a dead browser instead of an infinite retry loop;
- safe release on cancel, timeout, successful authentication, deployment shutdown and browser failure.

Interactive attempts waiting for a browser slot use an explicit queued state. They do not create a partially initialized Steel/Browserless session.

### Browser fleet

Each interactive attempt receives an isolated browser session and profile. No browser, cookie jar, local storage, session storage, MFA state or in-memory token is shared across agents.

The fleet is sharded. A shard has a configured maximum number of active browsers and a memory/CPU safety margin. The scheduler assigns a new attempt to the least-loaded healthy shard and keeps that assignment sticky until terminal state. A shard restart fails only its own sessions and does not take down the web app or other shards.

The login/MFA pool and the read-only Foresight sync pool are separate capacity domains. Background sync jobs cannot consume the last interactive login slots.

### Data and queue layer

PostgreSQL remains authoritative for durable state. Redis or an equivalent queue is used for fast admission, wake-up and backpressure; losing Redis must not lose an attempt or authenticated session because the durable record remains in PostgreSQL.

The existing encrypted browser-context boundary remains. Raw cookies, storage, tokens, debug URLs and vendor session IDs never reach the browser client, audit payloads or ordinary job results.

## Interactive flow

1. Agent starts a National Life connection.
2. Web service authenticates the agent and creates one durable attempt.
3. Coordinator admits the attempt immediately or places it in a visible queue.
4. Browser provider creates one isolated interactive session on a private shard.
5. Viewer broker issues a short-lived, one-time bootstrap for the owned attempt.
6. User enters National Life credentials and MFA directly in the official portal.
7. A session controller keeps the browser connection alive while the user is active. It does not poll/reconnect every second.
8. Authentication classification runs on a controlled heartbeat and records only safe state/origin information.
9. On success, the coordinator captures encrypted context and hands the authenticated browser/session handle to read-only jobs.
10. On failure, the UI shows a bounded retry/reconnect action and the coordinator releases only the affected browser.

The navigation guard uses exact observed origins, including the National Life MFA/Auth0 hosts required by the real login chain. It never becomes a wildcard allowlist.

## Provider abstraction

The application will consume a small interface rather than vendor-specific SDKs:

```ts
interface InteractiveBrowserProvider {
  create(input: CreateInteractiveBrowserInput): Promise<InteractiveBrowserHandle>
  attach(handle: InteractiveBrowserHandle): Promise<ManagedInteractiveBrowser>
  health(): Promise<BrowserProviderHealth>
  release(handle: InteractiveBrowserHandle): Promise<void>
}
```

The first test adapter will implement this contract for the candidate self-hosted backend. The existing Steel adapter will remain available behind the same contract until the candidate passes the test. The National Life adapter and Foresight jobs will not know which backend is active.

## Test phase

The test phase is not a production load test and does not use owner credentials.

### Test environment

- Isolated browser host or disposable VM, separate from `btapps` production workloads.
- Private browser network with no public CDP/debugger port.
- Synthetic National Life-like portal fixture covering login, MFA, redirects, blocked origins, delayed navigation and an authenticated Foresight-like page.
- Same PostgreSQL schema and encrypted-at-rest/session-boundary rules as production.
- Real viewer broker and authorization path, but synthetic portal content.

### Test gates

1. One session: open viewer, type, submit, complete synthetic MFA, classify authenticated state and persist context.
2. Five sessions: verify strict per-agent isolation and no cross-session navigation or storage.
3. Ten sessions: verify no provider process crash, no unbounded reconnect loop, no queue starvation and clean cancellation.
4. Failure injection: close browser, kill shard, drop CDP, restart coordinator and expire leases. Only affected attempts may fail.
5. Soak: keep ten active sessions for at least 30 minutes with heartbeats and staged user actions.
6. Capacity model: use measured CPU, RSS, pids, websocket count and queue latency to project 25, 50 and 100 sessions. The projection must include 30% headroom and background sync capacity.
7. Privacy: prove no recording/replay artifact, password/MFA value, cookie, token or raw portal payload enters logs, audit records or client responses.

### Approval criteria

The test is approved only if:

- zero cross-agent browser/session access is observed;
- zero coordinator/provider crash occurs during the ten-session test;
- reconnect and shard-failure behavior is bounded and user-visible;
- all sessions are released on cancel, expiry and terminal failure;
- the measured capacity projection supports the planned 100-session target with headroom;
- the privacy and read-only boundaries remain intact;
- one real owner-controlled pilot login succeeds after the synthetic test, without using it as a load test.

## Dedicated production infrastructure after approval

The browser fleet moves to dedicated private nodes only after the test gates pass.

Initial production shape:

- separate web/API deployment;
- managed PostgreSQL with backups, PITR and connection pooling;
- managed Redis or highly available queue service;
- at least two browser shards across failure domains or independent hosts;
- private network between coordinator, browser shards and database;
- public HTTPS only for the web app and authenticated viewer broker;
- browser nodes with no direct public ingress;
- autoscaling and a hard global session cap;
- dedicated observability for active sessions, queue depth, shard health, reconnects, browser RSS, pids, CDP errors and terminal outcomes.

Exact node count and size are determined from the 10-session measurements. We will not choose a server size from a generic browser-memory estimate.

## Rollout and rollback

1. Deploy the provider-neutral coordinator disabled by feature flag.
2. Run synthetic test in the isolated environment.
3. Enable one canary agent and one browser shard.
4. Expand to five and then twenty-five agents while observing error and resource budgets.
5. Expand to the planned 100-session cap only after capacity evidence is recorded.
6. Roll back by disabling new attempts, draining active sessions, preserving encrypted durable context only when safe, and returning the browser provider to the previous adapter.

## Explicit non-goals

- No automated submission of National Life applications, illustrations or policies.
- No Rapid Solve path in the Foresight login/sync flow.
- No shared login or shared browser profile between agents.
- No public Steel/Browserless API or CDP endpoint.
- No cloud credential-entry provider without a separate security and contractual approval.
- No 100-user rollout based only on a successful single-user login.
