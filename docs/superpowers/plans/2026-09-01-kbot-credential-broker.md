# K-Bot Credential Broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an opt-in, device-bound National Life credential broker that lets K-Bot restore an expired login once, pauses for MFA, and never exposes a stored credential through Keepr One UI, ordinary APIs, logs or browser storage.

**Architecture:** Keepr One encrypts credentials with an encrypt-only Vault Transit identity and stores only Vault ciphertext. A separate private broker verifies the existing signed device protocol and an active `AUTH_REQUIRED` operation, decrypts with a decrypt-only Vault identity, then returns a 60-second AES-GCM envelope whose key is wrapped to a non-extractable RSA-OAEP key owned by the paired K-Bot device. The extension submits only an exact allowlisted login form once; MFA, CAPTCHA, unknown pages and rejected credentials stop automation and preserve the manual-login fallback.

**Tech Stack:** Next.js 16.2, React 19, TypeScript, Prisma/PostgreSQL, Better Auth, Redis, HashiCorp Vault Transit, Node Web Crypto, WXT/Chrome MV3, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-kbot-credential-broker-design.md`

## Global Constraints

- `KBOT_CREDENTIAL_BROKER_ENABLED` defaults to `false`; production activation starts with `KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS` and never silently enables every agent.
- Production encryption and decryption use Vault Transit only; no production local-master-key fallback is permitted.
- The Keepr One web runtime has encrypt-only Vault permission; only the separate broker runtime has decrypt permission.
- No reveal, copy, export, support or administrator credential endpoint may exist.
- No username, password, plaintext Vault response, sealed envelope, AES key, cookie, token or MFA value may enter logs, analytics, Sentry, audit JSON, command payloads or `chrome.storage`.
- One authentication epoch permits exactly one credential lease and one form submission; rejected credentials are not retried automatically.
- MFA, OTP, CAPTCHA, consent, attestation, signature and final iGO submission remain manual boundaries.
- Existing manual login, signed device protocol, sync checkpoints and command resumability remain functional when the feature is disabled or unavailable.
- Production pilot activation requires an explicit National Life/carrier compliance decision and one owner-controlled smoke account.

---

## Task 1: Persist the credential, device encryption identity and authentication epoch

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260901170000_add_kbot_credential_broker/migration.sql`
- Create: `lib/national-life/credentials/contracts.ts`
- Create: `lib/national-life/credentials/contracts.test.ts`
- Modify: `lib/national-life/local-connector/contracts.ts`
- Modify: `lib/national-life/local-connector/contracts.test.ts`

**Interfaces:**
- Produces: `CredentialPlaintextV1`, `CredentialBindingV1`, `CredentialLeaseRequestV1`, `SealedCredentialLeaseV1`, `CredentialLeaseOutcome`, `CredentialLeaseResultV1` and strict parsers.
- Produces: nullable legacy credential columns, Vault ciphertext columns, device encryption JWK columns, auth epoch/state columns and `NationalLifeCredentialLease`.
- Consumes: existing `AgentIntegrationCredential`, `NationalLifeConnectorDevice`, `NationalLifeSyncRun` and `NationalLifeConnectorCommand` ownership boundaries.

- [x] **Step 1: Write failing contract tests**

Add strict-parser tests with these assertions:

```ts
const request = {
  schemaVersion: 1,
  operation: { kind: 'SYNC_RUN', id: 'run_1' },
  page: {
    origin: 'https://www.nationallife.com',
    pathname: '/agent/auth/login',
    classification: 'LOGIN',
  },
}
expect(parseCredentialLeaseRequest(request)).toEqual(request)
expect(parseCredentialLeaseRequest({ ...request, password: 'never' })).toBeNull()
expect(parseCredentialLeaseRequest({
  ...request,
  page: { ...request.page, origin: 'https://nationallife.example.net' },
})).toBeNull()
expect(parseCredentialLeaseResult({ schemaVersion: 1, outcome: 'MFA_REQUIRED' })).toEqual({
  schemaVersion: 1,
  outcome: 'MFA_REQUIRED',
})
expect(parseCredentialLeaseResult({ schemaVersion: 1, outcome: 'OTP_SUBMITTED' })).toBeNull()
```

Also extend the local-connector JWK tests to accept a strict RSA-OAEP public JWK and reject private components (`d`, `p`, `q`, `dp`, `dq`, `qi`).

- [x] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm vitest run lib/national-life/credentials/contracts.test.ts lib/national-life/local-connector/contracts.test.ts
```

Expected: failure because the credential contracts and RSA JWK parser do not exist.

- [x] **Step 3: Implement the pure contracts**

Create strict Zod-backed parsers for these exact public types:

```ts
export type CredentialPlaintextV1 = Readonly<{
  formatVersion: 1
  username: string
  password: string
}>

export type CredentialBindingV1 = Readonly<{
  agentId: string
  formatVersion: 1
  provider: 'NATIONAL_LIFE'
  purpose: 'PORTAL_CREDENTIAL'
}>

export type CredentialLeaseRequestV1 = Readonly<{
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
}>

export type CredentialLeaseOutcome =
  | 'AUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'REJECTED'
  | 'UNKNOWN_PAGE'

export type CredentialLeaseResultV1 = Readonly<{
  schemaVersion: 1
  outcome: CredentialLeaseOutcome
}>

export type SealedCredentialLeaseV1 = Readonly<{
  schemaVersion: 1
  leaseId: string
  expiresAt: string
  operation: {
    kind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'
    id: string
    authEpoch: number
  }
  keyAlgorithm: 'RSA-OAEP-256'
  contentAlgorithm: 'AES-256-GCM'
  wrappedKey: string
  iv: string
  ciphertext: string
}>
```

Use identifier limits of 128 characters, username 1–128 characters and password 1–256 characters. Reject unknown fields everywhere. The RSA public JWK must be `kty=RSA`, `alg=RSA-OAEP-256`, `use=enc`, `key_ops=['encrypt']`, `ext=true`, exponent `AQAB`, and a canonical base64url modulus of at least 384 bytes for RSA-3072.

- [x] **Step 4: Add the Prisma model changes**

Apply this model shape while retaining current names and relationships:

```prisma
model AgentIntegrationCredential {
  id                 String    @id @default(cuid())
  agentId            String
  agent              Agent     @relation(fields: [agentId], references: [id], onDelete: Cascade)
  provider           String
  maskedUsername     String
  keyVersion         String?
  algorithm          String?
  iv                 String?
  ciphertext         String?
  authTag            String?
  formatVersion      Int       @default(1)
  encryptionProvider String    @default("LEGACY_LOCAL_AES")
  encryptedPayload   String?
  autoLoginEnabled   Boolean   @default(false)
  status             String    @default("UNTESTED")
  consentedAt        DateTime?
  lastLeasedAt       DateTime?
  lastTestedAt       DateTime?
  lastSucceededAt    DateTime?
  lastRejectedAt     DateTime?
  revokedAt          DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  leases             NationalLifeCredentialLease[]

  @@unique([agentId, provider])
  @@index([provider, status])
}
```

Add `encryptionPublicKeyJwk Json?` and unique nullable
`encryptionKeyThumbprint String?` to `NationalLifeConnectorDevice`. Add
`authState String @default("READY")`, `authEpoch Int @default(0)` and
`authRequiredAt DateTime?` to both `NationalLifeSyncRun` and
`NationalLifeConnectorCommand`.

Add this lease ledger:

```prisma
model NationalLifeCredentialLease {
  id              String                     @id @default(cuid())
  agentId         String
  agent           Agent                      @relation(fields: [agentId], references: [id], onDelete: Cascade)
  credentialId    String
  credential      AgentIntegrationCredential @relation(fields: [credentialId], references: [id], onDelete: Cascade)
  deviceId        String
  device          NationalLifeConnectorDevice @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  operationKind   String
  operationId     String
  authEpoch       Int
  status          String                     @default("ISSUED")
  outcome         String?
  issuedAt        DateTime                   @default(now())
  expiresAt       DateTime
  reportedAt      DateTime?
  createdAt       DateTime                   @default(now())
  updatedAt       DateTime                   @updatedAt

  @@unique([deviceId, operationKind, operationId, authEpoch])
  @@index([agentId, issuedAt])
  @@index([status, expiresAt])
}
```

Add the inverse relations to `Agent` and `NationalLifeConnectorDevice`.

- [x] **Step 5: Generate and inspect the migration**

Run:

```bash
pnpm exec prisma migrate dev --create-only --name add_kbot_credential_broker
```

Rename the generated directory to `20260901170000_add_kbot_credential_broker` if Prisma generated a different timestamp. Confirm the SQL makes the five legacy crypto columns nullable, adds only nullable/defaulted columns to populated tables, creates the unique nullable encryption-key index, and does not delete or reinterpret existing credential rows.

- [x] **Step 6: Regenerate Prisma and run focused tests**

Run:

```bash
pnpm exec prisma generate
pnpm vitest run lib/national-life/credentials/contracts.test.ts lib/national-life/local-connector/contracts.test.ts
```

Expected: both files pass.

- [x] **Step 7: Commit the schema and contracts**

```bash
git add prisma/schema.prisma prisma/migrations/20260901170000_add_kbot_credential_broker lib/national-life/credentials/contracts.ts lib/national-life/credentials/contracts.test.ts lib/national-life/local-connector/contracts.ts lib/national-life/local-connector/contracts.test.ts
git commit -m "feat(kbot): add credential broker data contract"
```

## Task 2: Add the Vault Transit boundary with split encrypt/decrypt capabilities

**Files:**
- Create: `lib/national-life/credentials/vault-transit.ts`
- Create: `lib/national-life/credentials/vault-transit.test.ts`
- Create: `lib/national-life/credentials/config.ts`
- Create: `lib/national-life/credentials/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `CredentialPlaintextV1` and `CredentialBindingV1` from Task 1.
- Produces: `CredentialEncryptPort.encrypt()`, `CredentialDecryptPort.decrypt()`, `createVaultTransitEncryptClient()` and `createVaultTransitDecryptClient()`.
- Produces: `getKBotCredentialWebConfig()` and `getKBotCredentialBrokerConfig()` with mutually exclusive token-file requirements.

- [x] **Step 1: Write failing Vault client tests**

Use an injected `fetch` and token-file reader. Assert:

```ts
await encrypt.encrypt({
  plaintext: { formatVersion: 1, username: 'agent', password: 'sentinel-password' },
  binding: {
    agentId: 'agent-1', formatVersion: 1, provider: 'NATIONAL_LIFE',
    purpose: 'PORTAL_CREDENTIAL',
  },
})

expect(fetchMock).toHaveBeenCalledWith(
  'https://vault.example.com/v1/transit/encrypt/kbot-national-life',
  expect.objectContaining({ method: 'POST', redirect: 'error' }),
)
const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
expect(Buffer.from(request.plaintext, 'base64').toString()).toContain('sentinel-password')
expect(request.context).toBe(request.associated_data)
```

Add negative cases for HTTP redirect, timeout, malformed JSON, non-`vault:vN:` ciphertext, malformed base64 plaintext, binding mismatch and a config that tries to load both encrypt and decrypt identities in the same runtime.

- [x] **Step 2: Run the tests and verify they fail**

```bash
pnpm vitest run lib/national-life/credentials/vault-transit.test.ts lib/national-life/credentials/config.test.ts
```

Expected: missing modules.

- [x] **Step 3: Implement the Vault ports**

Define narrow interfaces:

```ts
export type StoredVaultCredential = Readonly<{
  encryptionProvider: 'VAULT_TRANSIT'
  formatVersion: 1
  keyVersion: string
  encryptedPayload: string
}>

export interface CredentialEncryptPort {
  encrypt(input: {
    plaintext: CredentialPlaintextV1
    binding: CredentialBindingV1
  }): Promise<StoredVaultCredential>
}

export interface CredentialDecryptPort {
  decrypt(input: {
    stored: StoredVaultCredential
    binding: CredentialBindingV1
  }): Promise<CredentialPlaintextV1>
}
```

Both clients must:

- import `server-only`;
- accept only an exact HTTPS Vault origin with no URL username/password, query or hash;
- accept mount/key names matching `^[a-z0-9][a-z0-9_-]{0,63}$`;
- read a token from an absolute token-sink file path for each request;
- use a 3-second `AbortSignal.timeout`, `redirect: 'error'`, JSON body and no request logging;
- base64-encode canonical sorted JSON for plaintext, `context` and
  `associated_data`;
- parse strict Vault responses and collapse all provider details into
  `VAULT_UNAVAILABLE`, `VAULT_REJECTED` or `VAULT_PAYLOAD_INVALID` safe errors;
- never attach request bodies or Vault response bodies to thrown errors.

The encrypt client calls `/v1/<mount>/encrypt/<key>`. The decrypt client calls
`/v1/<mount>/decrypt/<key>` and verifies the decrypted strict credential schema.

- [x] **Step 4: Implement fail-closed configuration**

Add these non-public variables to `.env.example` without values that could be mistaken for production credentials:

```dotenv
KBOT_CREDENTIAL_BROKER_ENABLED="false"
KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS=""
KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS="false"
KBOT_CREDENTIAL_VAULT_ADDR="https://vault.internal.example"
KBOT_CREDENTIAL_VAULT_MOUNT="transit"
KBOT_CREDENTIAL_VAULT_KEY="kbot-national-life"
KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE="/run/secrets/vault-encrypt-token"
KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE="/run/secrets/vault-decrypt-token"
KBOT_CREDENTIAL_BROKER_URL="http://kbot-credential-broker:3020"
KBOT_CREDENTIAL_BROKER_PORT="3020"
```

`getKBotCredentialWebConfig()` may read only the encrypt token file variable and
broker URL. `getKBotCredentialBrokerConfig()` may read only the decrypt token
file variable and port. Both reject an enabled production configuration with a
missing field. No variable receives a `NEXT_PUBLIC_` prefix.

- [x] **Step 5: Run focused tests**

```bash
pnpm vitest run lib/national-life/credentials/vault-transit.test.ts lib/national-life/credentials/config.test.ts
```

Expected: pass with no sentinel secret in thrown errors or captured console calls.

- [x] **Step 6: Commit the Vault boundary**

```bash
git add .env.example lib/national-life/credentials
git commit -m "feat(kbot): add Vault Transit credential boundary"
```

## Task 3: Build the consented Settings workflow without a reveal path

**Files:**
- Create: `lib/national-life/credentials/settings-service.ts`
- Create: `lib/national-life/credentials/settings-service.test.ts`
- Create: `app/agent/settings/credential-actions.ts`
- Create: `app/agent/settings/credential-actions.test.ts`
- Create: `app/agent/settings/KBotCredentialSettings.tsx`
- Create: `app/agent/settings/KBotCredentialSettings.test.tsx`
- Modify: `app/agent/settings/page.tsx`
- Modify: `app/agent/settings/SettingsForms.tsx`
- Modify: `app/agent/settings/SettingsForms.test.tsx`
- Modify: `app/agent/settings/state.ts`

**Interfaces:**
- Consumes: web encrypt-only Vault port and `getCurrentAgent()`.
- Produces: `getNationalLifeCredentialSummary(agentId)`, `saveNationalLifeCredential()`, `revokeNationalLifeCredential()`.
- Produces: `saveNationalLifeCredentialAction` and `revokeNationalLifeCredentialAction`.
- The only client-visible credential shape is `NationalLifeCredentialSummary`.

- [x] **Step 1: Write failing service tests**

Use an in-memory repository and fake encrypt port. Cover create, replacement,
revoke and cross-agent access. Assert the persisted write contains no `username`
or `password` property and audit values contain only safe metadata:

```ts
expect(repository.upsert).toHaveBeenCalledWith(expect.objectContaining({
  agentId: 'agent-1',
  provider: 'NATIONAL_LIFE',
  encryptedPayload: 'vault:v7:ciphertext',
  maskedUsername: 'ag***23',
  autoLoginEnabled: true,
  status: 'UNTESTED',
}))
expect(JSON.stringify(repository.upsert.mock.calls)).not.toContain('sentinel-password')
expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({
  action: 'NATIONAL_LIFE_CREDENTIAL_SAVED',
  after: { autoLoginEnabled: true, encryptionProvider: 'VAULT_TRANSIT' },
}))
```

Revocation must clear `encryptedPayload`, set `status='REVOKED'`,
`autoLoginEnabled=false`, and retain no old ciphertext in `AuditLog.before`.

- [x] **Step 2: Write failing Server Action tests**

Test strict validation and call ordering:

- missing consent is rejected before authentication or encryption;
- current Keepr One password is verified with `auth.api.verifyPassword` before
  the Vault encrypt port is invoked;
- `INVALID_PASSWORD` maps only to the `keeprOnePassword` field;
- action errors never contain National Life username/password;
- revoke also requires current Keepr One password;
- a CLIENT role or inactive agent cannot reach the service.

- [x] **Step 3: Run the tests and verify they fail**

```bash
pnpm vitest run lib/national-life/credentials/settings-service.test.ts app/agent/settings/credential-actions.test.ts
```

Expected: missing modules.

- [x] **Step 4: Implement the service and actions**

Use this server action input contract:

```ts
const saveCredentialSchema = z.strictObject({
  username: z.string().trim().min(1).max(128),
  nationalLifePassword: z.string().min(1).max(256),
  keeprOnePassword: z.string().min(1).max(128),
  consent: z.literal(true),
})
```

The service constructs the binding from the authenticated agent id, encrypts
`{ formatVersion: 1, username, password }`, masks the username without logging
it, and upserts the unique `(agentId, NATIONAL_LIFE)` record in one Prisma
transaction with the safe audit entry.

Return only:

```ts
export type NationalLifeCredentialSummary = Readonly<{
  configured: boolean
  autoLoginEnabled: boolean
  status: 'NOT_CONFIGURED' | 'UNTESTED' | 'READY' | 'REJECTED' | 'REVOKED'
  maskedUsername: string | null
  consentedAt: string | null
  lastSucceededAt: string | null
  lastRejectedAt: string | null
}>
```

- [x] **Step 5: Build the Settings component**

Replace the current “Keepr One does not store your password” copy with a focused
`KBotCredentialSettings` component. The form includes National Life username,
National Life password, current Keepr One password and an unchecked explicit
consent checkbox. Use `autocomplete="username"` for the carrier username,
`autocomplete="new-password"` for the carrier password and
`autocomplete="current-password"` for Keepr One reauthentication.

The configured state shows masked username, status, last success and buttons to
replace or revoke. It has no reveal/copy control and receives no ciphertext. The
rejected state explains that K-Bot attempted login once, stopped and requires a
replacement credential. The feature-disabled state retains the existing manual
login instructions.

- [x] **Step 6: Run Settings tests**

```bash
pnpm vitest run lib/national-life/credentials/settings-service.test.ts app/agent/settings/credential-actions.test.ts app/agent/settings/KBotCredentialSettings.test.tsx app/agent/settings/SettingsForms.test.tsx
```

Expected: pass; rendered DOM and serialized props contain no fixture password or Vault ciphertext.

- [x] **Step 7: Commit the Settings workflow**

```bash
git add app/agent/settings lib/national-life/credentials/settings-service.ts lib/national-life/credentials/settings-service.test.ts
git commit -m "feat(kbot): add consented National Life credential settings"
```

## Task 4: Enroll a separate non-extractable credential encryption key per device

**Files:**
- Modify: `apps/keeprone-connect/lib/key-store.ts`
- Create: `apps/keeprone-connect/lib/key-store.test.ts`
- Modify: `apps/keeprone-connect/entrypoints/background.ts`
- Modify: `apps/keeprone-connect/tests/background.test.ts`
- Modify: `lib/national-life/local-connector/pairing.ts`
- Modify: `lib/national-life/local-connector/pairing.test.ts`
- Create: `lib/national-life/credentials/device-key-service.ts`
- Create: `lib/national-life/credentials/device-key-service.test.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/devices/encryption-key/route.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/devices/encryption-key/route.test.ts`

**Interfaces:**
- Produces in extension: `getOrCreateCredentialEncryptionKey()` and `readCredentialDecryptionKey()`.
- Produces on server: `registerDeviceEncryptionKey()`.
- Consumes: existing ECDSA signing key and `verifyLocalConnectorDeviceRequest()`.

- [x] **Step 1: Write failing key-store tests**

Use fake IndexedDB/Web Crypto and assert:

```ts
const publicJwk = await getOrCreateCredentialEncryptionKey()
expect(publicJwk).toMatchObject({
  kty: 'RSA', alg: 'RSA-OAEP-256', use: 'enc', key_ops: ['encrypt'], ext: true,
})
const privateKey = await readCredentialDecryptionKey()
expect(privateKey).toMatchObject({ extractable: false, type: 'private' })
expect(privateKey?.usages).toEqual(['decrypt'])
```

Call twice and assert the same public JWK returns. Assert `clearDeviceKeys()`
deletes signing and encryption keys together.

- [x] **Step 2: Write failing registration tests**

The signed route accepts only `{ schemaVersion: 1, publicKeyJwk }`, records the
thumbprint for the same signed device, and refuses changing a previously
registered thumbprint with `DEVICE_ENCRYPTION_KEY_CONFLICT`. A revoked device,
cross-device id and JWK with private fields are rejected.

- [x] **Step 3: Run focused tests and verify failure**

```bash
pnpm --filter @fyntra/keeprone-connect test -- key-store.test.ts background.test.ts
pnpm vitest run lib/national-life/credentials/device-key-service.test.ts app/api/agent/integrations/national-life/local-connector/devices/encryption-key/route.test.ts
```

- [x] **Step 4: Implement RSA-OAEP enrollment**

Generate the key pair once:

```ts
const pair = await crypto.subtle.generateKey(
  {
    name: 'RSA-OAEP',
    modulusLength: 3072,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  false,
  ['encrypt', 'decrypt'],
) as CryptoKeyPair
```

Persist the non-extractable private `CryptoKey` and normalized public JWK in the
existing IndexedDB `keys` store under distinct ids. Keep the ECDSA signing key
unchanged.

On pairing, include `encryptionPublicKeyJwk` for new devices. After an extension
upgrade, a paired device without an encryption key generates one and sends it
once through the new signed route before requesting a credential lease. A
changed key requires device revocation and re-pairing; it is never overwritten.

- [x] **Step 5: Run focused tests**

```bash
pnpm --filter @fyntra/keeprone-connect test -- key-store.test.ts background.test.ts
pnpm vitest run lib/national-life/credentials/device-key-service.test.ts app/api/agent/integrations/national-life/local-connector/devices/encryption-key/route.test.ts lib/national-life/local-connector/pairing.test.ts
```

Expected: pass and no private JWK property appears in any request fixture.

- [x] **Step 6: Commit device encryption enrollment**

```bash
git add apps/keeprone-connect lib/national-life/credentials/device-key-service.ts lib/national-life/credentials/device-key-service.test.ts lib/national-life/local-connector/pairing.ts lib/national-life/local-connector/pairing.test.ts app/api/agent/integrations/national-life/local-connector/devices/encryption-key
git commit -m "feat(kbot): enroll device credential encryption keys"
```

## Task 5: Seal one-time credential leases and enforce broker authorization

**Files:**
- Create: `lib/national-life/credentials/sealed-envelope.ts`
- Create: `lib/national-life/credentials/sealed-envelope.test.ts`
- Create: `apps/keeprone-connect/lib/credential-envelope.ts`
- Create: `apps/keeprone-connect/lib/credential-envelope.test.ts`
- Create: `lib/national-life/credentials/lease-service.ts`
- Create: `lib/national-life/credentials/lease-service.test.ts`
- Create: `lib/national-life/credentials/rate-limit.ts`
- Create: `lib/national-life/credentials/rate-limit.test.ts`
- Modify: `lib/national-life/local-connector/auth-notification-service.ts`
- Modify: `lib/national-life/local-connector/auth-notification-service.test.ts`
- Modify: `lib/national-life/connector-command-service.ts`
- Modify: `lib/national-life/connector-command-service.test.ts`

**Interfaces:**
- Produces server: `sealCredentialForDevice()`.
- Produces extension: `openSealedCredentialLease()`.
- Produces broker: `issueCredentialLease()` and `recordCredentialLeaseOutcome()`.
- Consumes: Vault decrypt port, strict device request identity, auth epoch/state and Redis.

- [x] **Step 1: Write cross-runtime envelope tests**

Generate an RSA-OAEP pair in the test, seal a sentinel credential with the public
JWK, open it with the private key, and assert exact round-trip. Then assert
failure for another key, modified operation id, modified auth epoch, expired
lease and changed ciphertext.

The server envelope implementation must generate a random 32-byte AES key and
12-byte IV, use AES-256-GCM with canonical metadata AAD, wrap only the AES key
with RSA-OAEP SHA-256, and expose no plaintext field.

- [x] **Step 2: Write failing lease authorization tests**

Cover every refusal before testing success:

- feature disabled or agent absent from allowlist;
- device revoked, wrong agent, no encryption key or encryption thumbprint conflict;
- missing/revoked/rejected credential or `autoLoginEnabled=false`;
- sync run not `RUNNING`, wrong device, wrong agent, `authState` not
  `AUTH_REQUIRED`, or expired auth state;
- command not `AUTH_REQUIRED`, expired, wrong device/agent, or latest event is
  `MFA_REQUIRED`;
- unapproved origin/path/classification;
- existing lease for the same device/operation/auth epoch;
- agent/device rate limit exceeded or Redis unavailable in production.

The success test must assert the lease row is created before decryption, the
credential status changes only to record `lastLeasedAt`, and the returned JSON
contains only the sealed contract.

- [x] **Step 3: Update auth epoch transitions test-first**

For sync runs, change `recordLocalConnectorAuthState` to accept
`REQUIRED | MFA_REQUIRED | RESTORED`. Transitioning `READY -> REQUIRED`
increments `authEpoch` and sets `authRequiredAt`; repeating `REQUIRED` does not.
`MFA_REQUIRED` keeps the epoch. `RESTORED` returns to `READY`.

For commands, `recordConnectorCommandEvent` applies the same epoch rule when an
`AUTH_REQUIRED` or `MFA_REQUIRED` event changes the command state. Add tests for
repeated events and a second later authentication episode.

- [x] **Step 4: Implement a strict credential limiter**

Do not use the existing fail-open sync limiter. Implement atomic Redis limits:

```ts
await consumeCredentialLeaseLimit({
  agentId,
  deviceId,
  agentMax: 3,
  agentWindowSeconds: 900,
  deviceMax: 5,
  deviceWindowSeconds: 3600,
})
```

In production, unavailable Redis returns `CREDENTIAL_LIMIT_UNAVAILABLE` and no
Vault decrypt call occurs. In development/test, an injected in-memory limiter
is permitted and must preserve the same limits.

- [x] **Step 5: Implement lease issue and result handling**

`issueCredentialLease()` performs ownership/state/rate checks, inserts the
unique lease with a 60-second expiry, decrypts through Vault, seals to the device
and clears mutable plaintext/AES buffers in `finally`. If decrypt or seal fails,
mark the lease `FAILED` with a safe outcome and never permit another lease for
that epoch.

`recordCredentialLeaseOutcome()` accepts the correct signed device only once:

- `AUTHENTICATED`: lease terminal; credential `READY`, `lastSucceededAt=now`.
- `MFA_REQUIRED`: lease terminal; credential remains enabled; deduplicated MFA
  notification is created.
- `REJECTED`: lease terminal; credential `REJECTED`,
  `autoLoginEnabled=false`, `lastRejectedAt=now`.
- `UNKNOWN_PAGE`: lease terminal; credential remains unchanged and the
  operation uses manual login.

Audit only identifiers, safe action and outcome.

- [x] **Step 6: Run focused tests**

```bash
pnpm vitest run lib/national-life/credentials/sealed-envelope.test.ts lib/national-life/credentials/lease-service.test.ts lib/national-life/credentials/rate-limit.test.ts lib/national-life/local-connector/auth-notification-service.test.ts lib/national-life/connector-command-service.test.ts
pnpm --filter @fyntra/keeprone-connect test -- credential-envelope.test.ts
```

- [x] **Step 7: Commit the lease domain**

```bash
git add lib/national-life/credentials apps/keeprone-connect/lib/credential-envelope.ts apps/keeprone-connect/lib/credential-envelope.test.ts lib/national-life/local-connector/auth-notification-service.ts lib/national-life/local-connector/auth-notification-service.test.ts lib/national-life/connector-command-service.ts lib/national-life/connector-command-service.test.ts
git commit -m "feat(kbot): issue device-bound credential leases"
```

## Task 6: Run decryption in a private broker and expose only bounded proxy routes

**Files:**
- Create: `workers/kbot-credential-broker/runtime.ts`
- Create: `workers/kbot-credential-broker/runtime.test.ts`
- Create: `scripts/kbot-credential-broker.ts`
- Create: `Dockerfile.kbot-credential-broker`
- Create: `deploy/kbot-credential-broker.compose.yaml`
- Create: `deploy/kbot-credential-broker.compose.test.ts`
- Create: `lib/national-life/credentials/broker-proxy.ts`
- Create: `lib/national-life/credentials/broker-proxy.test.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/credential-leases/route.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/credential-leases/route.test.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/credential-leases/[leaseId]/result/route.ts`
- Create: `app/api/agent/integrations/national-life/local-connector/credential-leases/[leaseId]/result/route.test.ts`
- Modify: `package.json`

**Interfaces:**
- Broker private HTTP: `POST /api/agent/integrations/national-life/local-connector/credential-leases` and `POST /api/agent/integrations/national-life/local-connector/credential-leases/:leaseId/result`.
- Public Keepr One routes forward bounded bytes and an exact header allowlist; they never verify/consume the signed JTI themselves.
- Broker consumes `verifyLocalConnectorDeviceRequest()`, lease service and decrypt-only Vault client.

- [x] **Step 1: Write failing broker runtime tests**

Assert the runtime:

- exposes `GET /health` with `{ ok: true }` and no config details;
- accepts only the two credential POST path shapes;
- caps lease request/result bodies at 2 KiB;
- calls `verifyLocalConnectorDeviceRequest` inside the broker before any DB
  credential lookup or Vault decrypt;
- returns `Cache-Control: no-store`;
- maps replay/device errors to the same safe device headers as existing routes;
- returns generic 400/401/409/429/503 responses with no provider error body;
- never logs request headers or bodies.

- [x] **Step 2: Write failing proxy tests**

The Next.js route forwards only `content-type`, connector version and the five
`x-fyntra-*` signature headers. It forwards the exact original method, pathname
and bytes to the configured private broker, sets a 5-second timeout, refuses
redirects, caps the broker response at 16 KiB and preserves only safe response
headers (`content-type`, `cache-control`, `retry-after`,
`x-fyntra-device-error`).

An unavailable broker returns `503 { error: 'CREDENTIAL_BROKER_UNAVAILABLE' }`
and never falls back to decrypting in the web app.

- [x] **Step 3: Implement the broker runtime and proxy**

Use Node `createServer` for the private runtime; do not add Express. Add:

```json
"worker:kbot-credential-broker": "tsx scripts/kbot-credential-broker.ts"
```

The public route does not call cookie authentication and does not call
`verifyLocalConnectorDeviceRequest`; the broker is the only signature/replay
authority for these requests. The public route is a bounded transport boundary,
not an alternate decrypt path.

- [x] **Step 4: Add isolated deployment configuration**

The broker compose service:

- uses `Dockerfile.kbot-credential-broker`;
- exposes port 3020 only to the Docker network and has no Traefik labels or host
  port mapping;
- joins the Coolify network so the Keepr One web container can resolve it;
- mounts only the decrypt token sink file read-only;
- receives database, Redis and Vault address/mount/key configuration;
- never receives the web encrypt token;
- runs as a non-root user with read-only root filesystem and a writable `/tmp`
  tmpfs;
- includes a healthcheck against `127.0.0.1:3020/health`.

Add compose tests that reject `ports:`, Traefik router labels, encrypt-token
variables and privileged mode.

- [x] **Step 5: Run broker and proxy tests**

```bash
pnpm vitest run workers/kbot-credential-broker/runtime.test.ts lib/national-life/credentials/broker-proxy.test.ts app/api/agent/integrations/national-life/local-connector/credential-leases/route.test.ts 'app/api/agent/integrations/national-life/local-connector/credential-leases/[leaseId]/result/route.test.ts' deploy/kbot-credential-broker.compose.test.ts
```

- [x] **Step 6: Build the broker image locally**

```bash
docker build -f Dockerfile.kbot-credential-broker -t keeprone-kbot-credential-broker:test .
```

Expected: image builds and health process starts without the Keepr One encrypt token.

- [x] **Step 7: Commit broker runtime and routes**

```bash
git add workers/kbot-credential-broker scripts/kbot-credential-broker.ts Dockerfile.kbot-credential-broker deploy/kbot-credential-broker.compose.yaml deploy/kbot-credential-broker.compose.test.ts lib/national-life/credentials/broker-proxy.ts lib/national-life/credentials/broker-proxy.test.ts app/api/agent/integrations/national-life/local-connector/credential-leases package.json
git commit -m "feat(kbot): isolate credential decryption broker"
```

## Task 7: Add an exact, isolated National Life login form executor

**Files:**
- Create: `apps/keeprone-connect/lib/auth-page-contract.ts`
- Create: `apps/keeprone-connect/lib/auth-page-contract.test.ts`
- Create: `apps/keeprone-connect/entrypoints/nlg-auth.content.ts`
- Create: `apps/keeprone-connect/entrypoints/nlg-auth.content.test.ts`
- Modify: `apps/keeprone-connect/lib/messages.ts`
- Modify: `apps/keeprone-connect/lib/messages.test.ts`
- Modify: `apps/keeprone-connect/wxt.config.ts`
- Create: `tests/fixtures/national-life/auth0-login.html`
- Create: `tests/fixtures/national-life/auth0-mfa.html`
- Create: `tests/fixtures/national-life/auth0-captcha.html`
- Create: `tests/fixtures/national-life/auth0-rejected.html`

**Interfaces:**
- Produces: `classifyNationalLifeAuthPage(document, url)` returning `LOGIN`, `MFA`, `CAPTCHA`, `REJECTED` or `UNKNOWN`.
- Produces extension message `SUBMIT_CARRIER_CREDENTIAL` with an in-memory credential and safe acknowledgement `SUBMITTED | REFUSED_*`.
- Consumes no command URLs, selectors or scripts from the server.

- [ ] **Step 1: Capture the live DOM contract without credentials**

Using an owner-controlled logged-out or expired National Life test session,
record only the login page origin, pathname, form action origin/path, input
`id/name/type/autocomplete` attributes, submit button type/text and explicit MFA,
CAPTCHA and rejection markers. Do not record values, cookies, network bodies,
screenshots containing identifiers or any MFA response.

Write those non-secret attributes into the four fixture files. If National Life
uses a username-first flow, model separate `USERNAME_LOGIN` and `PASSWORD_LOGIN`
classifications and keep one lease envelope in service-worker memory across the
two exact pages for at most 60 seconds; do not request a second lease.

- [ ] **Step 2: Write classifier and executor tests**

Cover:

- exact National Life and Auth0 login fixtures accepted;
- lookalike origin, unexpected path, multiple password fields, hidden duplicate
  password, cross-origin form action, extra OTP input, CAPTCHA and unknown form
  refused before any value is assigned;
- MFA and rejection fixtures classified without reading any input value;
- submit happens exactly once;
- acknowledgement contains no username/password;
- generic messages with a `password` property remain rejected by
  `parseExternalMessage` and all existing bridge parsers.

- [ ] **Step 3: Run tests and verify failure**

```bash
pnpm --filter @fyntra/keeprone-connect test -- auth-page-contract.test.ts nlg-auth.content.test.ts messages.test.ts
```

- [ ] **Step 4: Implement the isolated content script**

Configure WXT matches only for the exact observed login path families on:

```text
https://www.nationallife.com/agent/auth/*
https://nlg-prod.auth0.com/*
```

Add `https://nlg-prod.auth0.com/*` to `host_permissions`. Do not add the broad
`scripting` permission and do not inject the credential into MAIN world.

The content script accepts its private runtime message, re-runs classification
immediately before assignment, fills only the approved username/password inputs,
dispatches the minimum `input`/`change` events required by the observed form,
and calls the exact submit button once. It returns a safe code and drops local
references in `finally`.

- [ ] **Step 5: Run connector tests and manifest checks**

```bash
pnpm --filter @fyntra/keeprone-connect test -- auth-page-contract.test.ts nlg-auth.content.test.ts messages.test.ts manifest-key.test.ts igo-manifest.test.ts
pnpm --filter @fyntra/keeprone-connect typecheck
```

- [ ] **Step 6: Commit the login executor**

```bash
git add apps/keeprone-connect tests/fixtures/national-life
git commit -m "feat(kbot): add exact National Life login executor"
```

## Task 8: Wire auto-login, MFA notification, rejection and manual fallback into K-Bot

**Files:**
- Modify: `apps/keeprone-connect/entrypoints/background.ts`
- Modify: `apps/keeprone-connect/tests/background.test.ts`
- Modify: `apps/keeprone-connect/lib/state.ts`
- Modify: `apps/keeprone-connect/lib/state.test.ts`
- Modify: `apps/keeprone-connect/lib/signed-client.ts`
- Modify: `apps/keeprone-connect/lib/signed-client.test.ts`
- Modify: `apps/keeprone-connect/lib/popup-copy.ts`
- Modify: `apps/keeprone-connect/lib/popup-copy.test.ts`
- Modify: `app/api/agent/integrations/national-life/local-connector/runs/[runId]/auth-state/route.ts`
- Modify: `app/api/agent/integrations/national-life/local-connector/runs/[runId]/auth-state/route.test.ts`
- Modify: `lib/national-life/local-connector/auth-notification-service.ts`
- Modify: `lib/national-life/local-connector/auth-notification-service.test.ts`

**Interfaces:**
- Consumes: device encryption enrollment, lease/result APIs, page classifier and existing `hasAuthenticatedPortalSession()`.
- Produces: `attemptAutomaticCarrierLogin()` and persisted non-secret auth-attempt metadata.
- Existing sync/command resume functions remain the only continuation path after authenticated proof.

- [ ] **Step 1: Write the background state-machine tests**

Add tests for:

1. expired authenticated session -> `AUTH_REQUIRED` -> exact login page -> key
   enrollment -> one lease -> decrypt -> one content-script submit;
2. service-worker eviction after lease issue -> same operation/auth epoch cannot
   obtain a second lease or submit again;
3. authenticated probe success -> result `AUTHENTICATED` -> same sync/command
   resumes from its existing checkpoint;
4. MFA after submission -> result `MFA_REQUIRED`, one notification, active tab,
   no OTP interaction and passive wait;
5. manual MFA completion -> authenticated probe -> notification resolved and
   same operation resumes;
6. rejected fixture -> result `REJECTED`, no retry and manual-login copy;
7. CAPTCHA/unknown page/no configured credential/broker 503/feature off/old
   extension -> existing manual login flow;
8. ambiguous lease network response -> no HTTP retry and no second lease;
9. `chrome.storage.local` records contain operation id, auth epoch, lease id and
   attempted timestamp only; no envelope or credential marker.

- [ ] **Step 2: Extend signed-client safe errors without adding generic retry**

Add safe codes:

```ts
| 'CREDENTIAL_NOT_CONFIGURED'
| 'CREDENTIAL_AUTO_LOGIN_DISABLED'
| 'CREDENTIAL_LEASE_ALREADY_ISSUED'
| 'CREDENTIAL_BROKER_UNAVAILABLE'
| 'CREDENTIAL_RATE_LIMITED'
| 'DEVICE_ENCRYPTION_KEY_REQUIRED'
```

Credential lease creation must call `signedJsonRequest` directly once. It must
not call `retryIdempotentSignedRequest`, because an ambiguous response may mean
the one-time lease was already issued.

- [ ] **Step 3: Persist only non-secret auth-attempt state**

Extend sync and command state with:

```ts
credentialAttempt?: {
  operationKind: 'SYNC_RUN' | 'CONNECTOR_COMMAND'
  operationId: string
  authEpoch: number
  leaseId?: string
  attemptedAt: string
}
```

Parsers reject `username`, `password`, `wrappedKey`, `ciphertext` and `iv` at
every nested level. Clear attempt metadata only after `RESTORED` or terminal
operation completion; retaining it through worker eviction enforces no retry.

- [ ] **Step 4: Implement `attemptAutomaticCarrierLogin()`**

The function order is fixed:

1. classify the current carrier page;
2. return manual fallback for MFA/CAPTCHA/UNKNOWN;
3. ensure a device encryption key is registered;
4. create and persist the non-secret attempt marker;
5. request one signed lease;
6. open the envelope in the service worker;
7. send the in-memory credential to the exact login content script;
8. report a safe outcome and drop all local values;
9. let existing tab/update/auth-probe handlers determine authenticated, MFA or
   rejected state and resume the current work.

Do not add a background login loop. The existing `resumePending()` remains
passive while auth is pending.

- [ ] **Step 5: Add distinct MFA notifications and user copy**

`auth-state` accepts strict `REQUIRED | MFA_REQUIRED | RESTORED`. Use a
deduplicated `NATIONAL_LIFE_MFA_REQUIRED` notification with text explaining that
K-Bot entered the saved credential but National Life needs the user to complete
verification. Resolve both login and MFA notifications on `RESTORED`.

Popup copy distinguishes:

- automatic login in progress;
- MFA requires the user;
- saved credential rejected and disabled;
- broker unavailable, using manual login;
- ordinary manual login when no credential is configured.

- [ ] **Step 6: Run focused integration tests**

```bash
pnpm --filter @fyntra/keeprone-connect test -- background.test.ts state.test.ts signed-client.test.ts popup-copy.test.ts
pnpm vitest run 'app/api/agent/integrations/national-life/local-connector/runs/[runId]/auth-state/route.test.ts' lib/national-life/local-connector/auth-notification-service.test.ts
```

- [ ] **Step 7: Commit the K-Bot integration**

```bash
git add apps/keeprone-connect app/api/agent/integrations/national-life/local-connector/runs lib/national-life/local-connector/auth-notification-service.ts lib/national-life/local-connector/auth-notification-service.test.ts
git commit -m "feat(kbot): restore carrier login with MFA-safe fallback"
```

## Task 9: Prove secret hygiene, deployment controls and end-to-end recovery

**Files:**
- Create: `tests/national-life/kbot-credential-broker.integration.test.ts`
- Create: `tests/national-life/kbot-credential-secret-hygiene.test.ts`
- Create: `docs/operations/kbot-credential-broker-runbook.md`
- Modify: `docs/operations/keeprone-connect-smoke-test.md`
- Modify: `docs/architecture/kbot-operations-ux.md`
- Modify: `docs/operations/national-life-interactive-login-rollout.md`
- Modify: `apps/keeprone-connect/wxt.config.ts`

**Interfaces:**
- Consumes every earlier task.
- Produces synthetic end-to-end proof, operational Vault policies/rotation/kill-switch procedure and pilot checklist.

- [ ] **Step 1: Add a sentinel secret-hygiene integration test**

Run the complete fake flow with unique markers:

```ts
const username = 'credential-user-sentinel-7e2d'
const password = 'credential-password-sentinel-91af'
```

Capture repository writes, audit writes, command events, notifications,
serialized API responses, extension storage, captured console output and thrown
errors. Assert the username and password markers appear only in the fake Vault
encrypt request and the exact isolated form input assignment, never in any
persisted/captured surface. Assert PostgreSQL-facing data contains only
`vault:v...` ciphertext and masked username.

- [ ] **Step 2: Add end-to-end synthetic recovery scenarios**

Cover these exact stories:

- session expired -> one automatic login -> authenticated probe -> sync resumes;
- session expired -> one automatic login -> MFA -> user fixture transition ->
  same sync resumes;
- wrong password -> one submission -> credential disabled -> manual login still
  resumes;
- broker down -> no lease -> manual login still resumes;
- revoked device -> no lease and no key regeneration loop;
- tab closes after lease -> no second automatic attempt in that auth epoch;
- feature kill switch during auth -> no new lease and manual recovery remains.

- [ ] **Step 3: Write the operations runbook**

Include exact Vault policy examples:

```hcl
path "transit/encrypt/kbot-national-life" {
  capabilities = ["update"]
}
```

```hcl
path "transit/decrypt/kbot-national-life" {
  capabilities = ["update"]
}
```

Document key creation as non-exportable/non-deletable `aes256-gcm96` with
`derived=true`, Vault Agent token sinks, rotation and `rewrap`, Redis fail-closed
behavior, ciphertext backup/restore, revoking a device, revoking a credential,
turning off `KBOT_CREDENTIAL_BROKER_ENABLED`, pilot metrics and the prohibition
on searching logs with real credentials.

The smoke checklist must distinguish implementation, deployment, extension
version, configured Vault policy, synthetic proof, real owner-controlled login,
MFA observation and successful resumed K-Bot operation.

- [ ] **Step 4: Bump the extension version only after all connector tests pass**

Change `apps/keeprone-connect/wxt.config.ts` from `0.1.56` to the next unused
version discovered from Git and Chrome Web Store state. Do not assume `0.1.57`
is unused; verify before editing. Build unpacked and Web Store artifacts
separately, preserving the current manifest-key rule.

- [ ] **Step 5: Run the complete local validation matrix**

```bash
pnpm test
pnpm lint
pnpm build
pnpm --filter @fyntra/keeprone-connect test
pnpm --filter @fyntra/keeprone-connect typecheck
pnpm --filter @fyntra/keeprone-connect build
docker build -f Dockerfile.kbot-credential-broker -t keeprone-kbot-credential-broker:test .
git diff --check
```

Expected: all commands pass. Existing unrelated warnings must be reported
separately and may not be described as credential-broker failures.

- [ ] **Step 6: Perform a focused secret scan**

Run pattern searches against tracked source, generated extension output and test
logs for the two sentinel markers and for forbidden credential storage keys.
Expected: zero occurrences outside the explicit test fixture source that defines
the sentinel values. Inspect the built extension permissions and confirm only
the exact National Life/Auth0/iPipeline/Keepr One origins are present.

- [ ] **Step 7: Commit documentation and proof**

```bash
git add tests/national-life docs/operations docs/architecture apps/keeprone-connect/wxt.config.ts
git commit -m "test(kbot): verify credential recovery and secret hygiene"
```

- [ ] **Step 8: Production pilot gate**

Before enabling any agent:

1. confirm the carrier/compliance authorization decision;
2. deploy the migration without enabling the feature;
3. deploy Vault policies and distinct token sinks;
4. deploy the private broker and prove no public router/port exists;
5. deploy Keepr One and verify its Vault identity cannot decrypt;
6. publish/install the verified extension version;
7. enable one explicit agent id;
8. save a test credential through Settings;
9. run one expired-session login, one MFA branch if the carrier requests it, and
   one resumed Sync or Illustration command;
10. inspect lease/audit/notification records and redacted logs for the exact run;
11. disable the flag immediately if login repeats, the page contract is unknown,
    any secret-like value appears in logs, or carrier behavior differs from the
    approved contract.

Do not push to `main`, deploy or enable the pilot until the implementation diff,
full validation and production prerequisites are reviewed together.
