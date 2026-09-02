# K-Bot Credential Broker Design

## Status

Proposed design for an opt-in National Life credential capability used only by
K-Bot. This design supersedes the current product copy and local-connector rule
that Keepr One never stores or sends a National Life password. It does not
change the separate rule that MFA, CAPTCHA, consent, signature and final carrier
submission remain human-controlled boundaries.

Production activation remains gated by an explicit carrier/compliance decision.
The code ships disabled and is enabled first for an agent allowlist.

## Goal

Allow K-Bot to restore a dropped National Life login with an agent-owned
username and password, continue the exact sync, illustration or iGO draft that
was already in progress, and ask the user for help only when National Life
requires MFA or another human challenge.

## Product contract

- The credential is stored for K-Bot, not exposed as a user password-manager
  vault.
- There is one National Life credential record per Keepr One agent.
- The agent must explicitly consent and re-enter the current Keepr One password
  before saving or replacing the National Life credential.
- Keepr One never offers a reveal, copy, export or administrative retrieval
  action for the stored username or password.
- K-Bot may request a credential only for an active, device-bound National Life
  operation that is durably waiting at a recognized login page.
- One authentication episode permits one automatic credential submission. A
  rejected password disables automatic login until the credential is replaced.
- MFA and CAPTCHA are never read, generated, submitted, retried or bypassed by
  K-Bot. They produce a clear user notification and leave the same operation
  waiting for manual completion.
- A successful authenticated-session probe, not the login button click, is the
  proof that login succeeded.
- The existing manual-login path remains the fallback when the feature is off,
  no credential is configured, Vault is unavailable, the device is not ready,
  or the page contract is not recognized exactly.

## Architecture decision

Vaultwarden is not part of the design. HashiCorp Vault Transit is used as an
external cryptographic service; PostgreSQL remains the system of record for the
ciphertext and operational metadata.

The solution has four boundaries:

1. **Keepr One web application** authenticates the agent, verifies the current
   Keepr One password, accepts consent and sends the credential to Vault using
   an encrypt-only identity. It cannot decrypt a stored credential.
2. **PostgreSQL** stores Vault ciphertext, masked identity metadata, consent,
   status and a lease ledger. It never stores the plaintext credential or a
   device-decryptable envelope.
3. **K-Bot Credential Broker** is a separate private runtime with a decrypt-only
   Vault identity. It verifies the existing signed device protocol, proves the
   requesting device owns an active operation waiting for authentication,
   decrypts the credential and immediately seals it to that device.
4. **K-Bot extension** owns a non-extractable RSA-OAEP private key in IndexedDB.
   It opens a short-lived sealed envelope only in the service worker, hands the
   values to an isolated content script on an exact approved login page, submits
   once and discards all references.

The existing ECDSA P-256 device key remains the request-signing identity. A
separate RSA-OAEP key is added for credential delivery so signing and encryption
keys never share purposes.

```text
Settings form
  -> Keepr One reauthentication
  -> Vault Transit encrypt-only API
  -> PostgreSQL Vault ciphertext

Active K-Bot job reaches login
  -> signed device lease request
  -> Keepr One bounded private proxy
  -> Credential Broker verifies device + job + auth epoch + rate limit
  -> Vault Transit decrypt-only API
  -> AES-GCM credential envelope, AES key wrapped to device RSA-OAEP key
  -> K-Bot opens in memory and submits exact login form once
  -> authenticated / MFA required / rejected result
```

## Threat model

### Protected assets

- National Life username and password.
- Vault encrypt and decrypt identities.
- Device signing and credential-decryption private keys.
- Authenticated National Life session state.
- The ability to trigger a carrier login attempt.

### In-scope threats

- Database read or backup disclosure.
- Cross-agent IDOR and agency-admin overreach.
- A revoked or unpaired extension requesting a credential.
- Replay of a previously signed device request or credential lease.
- A compromised Keepr One web process attempting to decrypt the credential.
- Password leakage through React props, API responses, logs, analytics, traces,
  exception messages, audit records or browser storage.
- Login retry loops causing a National Life account lockout.
- A changed or lookalike login page receiving the credential.
- Service-worker eviction causing the same authentication episode to submit
  twice.

### Explicit limitations

- A compromised, currently paired K-Bot extension can act as that device. The
  server limits this risk to active authentication-bound operations, one lease
  per authentication epoch, rate limits and immediate device revocation.
- The National Life page necessarily receives the plaintext value when the
  isolated content script fills the form. No browser automation can submit a
  password without the target page receiving it.
- A full compromise of both the Credential Broker and its Vault decrypt identity
  can expose credentials. The broker therefore runs separately from the web app,
  has no public ingress, uses a narrow Vault policy and receives no arbitrary
  decrypt endpoint.

## Vault Transit contract

Use one non-exportable, non-deletable `aes256-gcm96` Transit key configured with
key derivation. Every encrypt/decrypt operation supplies the same canonical,
base64-encoded context and associated data:

```json
{
  "agentId": "<agent id>",
  "formatVersion": 1,
  "provider": "NATIONAL_LIFE",
  "purpose": "PORTAL_CREDENTIAL"
}
```

The plaintext is a strict canonical JSON value:

```json
{
  "formatVersion": 1,
  "password": "<password>",
  "username": "<username>"
}
```

Vault ciphertext such as `vault:v3:...` is stored in PostgreSQL. The key version
is parsed for diagnostics and rotation, but Keepr One never manipulates Vault
key material. Rotation uses Transit `rotate` followed by `rewrap`; it does not
decrypt and re-encrypt credentials in application code.

Vault identities are intentionally split:

- `keeprone-web`: `update` on `transit/encrypt/kbot-national-life` only.
- `kbot-credential-broker`: `update` on
  `transit/decrypt/kbot-national-life` only.
- operations rotation identity: key rotate/read and rewrap, never used by either
  runtime.

Tokens are supplied through Vault Agent token sink files with short-lived,
renewable tokens. They are not committed, logged, exposed through environment
dumps or shared between the web and broker containers.

Vault runs outside the Keepr One application host and database host. Local tests
use injected fake ports; production code does not contain a local master-key
fallback.

## Stored data

The existing `AgentIntegrationCredential` model is migrated rather than adding a
second credential table. Legacy AES-GCM columns become nullable. New rows use:

- `provider = NATIONAL_LIFE`
- `formatVersion = 1`
- `encryptionProvider = VAULT_TRANSIT`
- `encryptedPayload = vault:vN:...`
- `maskedUsername`
- `status = UNTESTED | READY | REJECTED | REVOKED`
- `autoLoginEnabled`
- `consentedAt`, `lastLeasedAt`, `lastSucceededAt`, `lastRejectedAt`, `revokedAt`

Revocation clears `encryptedPayload`, turns off automatic login and keeps only
the non-secret audit metadata. No historical plaintext or device envelope is
retained.

`NationalLifeConnectorDevice` gains a separate encryption public JWK and
thumbprint. The non-extractable private key stays in extension IndexedDB.

`NationalLifeCredentialLease` records:

- agent, credential and device ownership;
- operation kind and operation id;
- authentication epoch;
- issued and expiry timestamps;
- terminal result (`AUTHENTICATED`, `MFA_REQUIRED`, `REJECTED`,
  `UNKNOWN_PAGE`, `EXPIRED`);
- no plaintext, sealed envelope, cookie, token, URL query or DOM snapshot.

Each active operation has an integer `authEpoch`. It increments only when the
operation moves from a non-auth state to `AUTH_REQUIRED`. Repeated notifications
while already waiting do not increment it. The unique device/operation/epoch
lease constraint is the durable one-attempt rule across service-worker restarts.

## Credential lease contract

The extension sends a device-signed strict request:

```ts
type CredentialLeaseRequestV1 = {
  schemaVersion: 1
  operation: {
    kind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'
    id: string
  }
  page: {
    origin: 'https://www.nationallife.com' | 'https://nlg-prod.auth0.com'
    pathname: string
    classification: 'LOGIN'
  }
}
```

The broker issues a lease only when all conditions are true:

- the feature and agent allowlist are enabled;
- request signature, timestamp, body hash and replay JTI are valid;
- founder/product access remains active;
- device is active, belongs to the same agent and has an approved encryption key;
- credential is active and automatic login is enabled;
- operation belongs to the same agent and device, is unexpired and durably in
  `AUTH_REQUIRED`, not `MFA_REQUIRED`;
- page origin/path/classification are in the closed login contract;
- no lease exists for the same device, operation and auth epoch;
- strict credential rate limits are available and permit the request.

Credential rate limiting fails closed in production if Redis is unavailable.
The limit is one lease per auth epoch, at most three leases per agent per 15
minutes and at most five per device per hour. This is separate from ordinary
sync retry limits.

The response is a short-lived `SealedCredentialLeaseV1`:

```ts
type SealedCredentialLeaseV1 = {
  schemaVersion: 1
  leaseId: string
  expiresAt: string
  operation: { kind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'; id: string; authEpoch: number }
  keyAlgorithm: 'RSA-OAEP-256'
  contentAlgorithm: 'AES-256-GCM'
  wrappedKey: string
  iv: string
  ciphertext: string
}
```

The broker generates a random 256-bit AES key and 96-bit IV, encrypts the strict
credential JSON with AES-256-GCM and canonical lease metadata as AAD, then wraps
the AES key with the device's RSA-OAEP SHA-256 public key. Lease lifetime is 60
seconds. The sealed response uses `Cache-Control: no-store` and is never stored
by Keepr One or K-Bot.

The signed result endpoint accepts only this strict body:

```ts
type CredentialLeaseResultV1 = {
  schemaVersion: 1
  outcome: 'AUTHENTICATED' | 'MFA_REQUIRED' | 'REJECTED' | 'UNKNOWN_PAGE'
}
```

## Extension login state machine

K-Bot adds a dedicated isolated content script for only the approved National
Life and Auth0 login origins. It does not run in the page MAIN world.

```text
AUTH_REQUIRED
  -> classify current page
     -> LOGIN exact contract: request one lease and submit once
     -> MFA/CAPTCHA: notify user, no lease
     -> UNKNOWN: manual-login fallback, no lease

after submit
  -> authenticated probe succeeds: AUTHENTICATED, resume same operation
  -> exact MFA route/page: MFA_REQUIRED, notify user, wait
  -> exact rejected-credential evidence: REJECTED, disable auto login
  -> timeout/unknown: UNKNOWN_PAGE, no automatic retry
```

The login content script:

- accepts messages only from its own extension runtime;
- validates `location.origin`, exact allowed path family, form count, input
  types, autocomplete/name/id allowlist and submit-button contract;
- refuses hidden duplicate password fields, cross-origin form actions, CAPTCHA,
  MFA/OTP fields and unknown page shapes;
- fills username/password and submits once;
- returns only a safe result code;
- never logs values or echoes fields in an acknowledgement.

The service worker:

- never places the sealed lease, AES key, username or password in
  `chrome.storage`, extension state, command state or alarms;
- keeps only lease id/auth epoch/attempted timestamp as non-secret replay state;
- never invokes the generic idempotent HTTP retry helper for a credential lease
  or form submission;
- clears temporary byte buffers in `finally` blocks where JavaScript permits;
- reports the lease result through a second signed endpoint.

## MFA and recovery behavior

When MFA appears after credential submission:

- the credential is not marked rejected;
- the operation remains in the same durable authentication epoch;
- the server writes one deduplicated `NATIONAL_LIFE_MFA_REQUIRED` notification;
- K-Bot activates the carrier tab once and remains passive;
- no polling consumes login or sync retry budgets while the user completes MFA;
- the existing authenticated-session probe marks the lease `AUTHENTICATED`,
  resolves the notification and resumes the exact checkpoint.

When the password is rejected:

- there is no second automatic attempt;
- `autoLoginEnabled` becomes false and status becomes `REJECTED`;
- the operation falls back to manual login without being discarded;
- Settings explains that the credential must be replaced;
- audit records only the safe result code and identifiers.

When Vault or the broker is unavailable, K-Bot opens the manual login page and
continues the existing behavior. Infrastructure retry may retry the private
proxy request only before a lease is issued and never after an ambiguous
response. An ambiguous lease response is treated as consumed for that auth
epoch to prevent duplicate submission.

## Authorization and audit

Credential save, replace, disable and revoke require:

- authenticated active agent;
- current Keepr One password verification;
- same-origin Server Action protection;
- strict runtime validation and bounded fields;
- agent ownership; agency owners and administrators cannot reveal or lease a
  member's credential;
- action rate limits.

Device lease and result endpoints require the signed local-connector protocol;
they do not use browser cookies.

Audit actions contain no `before`/`after` secret payloads:

- `NATIONAL_LIFE_CREDENTIAL_SAVED`
- `NATIONAL_LIFE_CREDENTIAL_REPLACED`
- `NATIONAL_LIFE_CREDENTIAL_REVOKED`
- `NATIONAL_LIFE_CREDENTIAL_LEASED`
- `NATIONAL_LIFE_CREDENTIAL_AUTHENTICATED`
- `NATIONAL_LIFE_CREDENTIAL_MFA_REQUIRED`
- `NATIONAL_LIFE_CREDENTIAL_REJECTED`

All server and extension error codes are from a closed safe-code catalog. Error
objects from Vault, fetch request bodies, response plaintext and DOM values are
never passed to `console`, Sentry or analytics.

## Feature flags and rollout

- `KBOT_CREDENTIAL_BROKER_ENABLED=false` by default.
- `KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS` is an explicit comma-separated pilot
  allowlist.
- `KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS=false` requires a separate explicit
  production decision.
- The extension advertises a credential-protocol version; old versions retain
  manual login and cannot request leases.
- Server kill switch refuses new leases immediately while preserving stored
  ciphertext and existing manual-login operation recovery.

Rollout order:

1. synthetic fixture and fake Vault tests;
2. local unpacked extension with a non-production test account;
3. one owner-controlled National Life pilot account;
4. observe lease/login/MFA/rejection metrics without secrets;
5. expand allowlist only after carrier/compliance approval and lockout review.

## Acceptance criteria

- A database snapshot contains no fixture username/password marker; only Vault
  ciphertext and masked metadata exist.
- The web application Vault identity cannot decrypt a known ciphertext.
- A valid paired device can open a lease; another device, agent, revoked device,
  expired job or replay cannot.
- The sealed lease can be opened only by the matching non-extractable device key.
- K-Bot submits an exact fixture login form once and resumes the same sync or
  command after an authenticated probe.
- MFA produces a user notification and no automated MFA interaction.
- A rejected password causes one submission, disables automatic login and keeps
  manual recovery available.
- Service-worker eviction does not produce a second lease for the same auth
  epoch.
- No credential or envelope appears in React props, API logs, audit JSON,
  command/event payloads, `chrome.storage`, screenshots or test traces.
- The feature can be disabled server-side without publishing a new extension.
- Root tests, lint, Next.js build, connector tests/typecheck/build, broker tests
  and the synthetic end-to-end smoke all pass before pilot activation.

## Out of scope

- Storing MFA seeds, OTP values, recovery codes or CAPTCHA solutions.
- Sharing one National Life credential among multiple agents.
- Revealing or exporting a stored credential.
- Automatic final iGO submission, consent, attestation or signature.
- A generic secrets UI or support/admin decrypt tool.
- Vaultwarden or a user-facing Bitwarden-compatible vault.
