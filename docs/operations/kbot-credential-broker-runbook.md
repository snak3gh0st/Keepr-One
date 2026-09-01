# K-Bot credential broker runbook

## Safety boundary

This feature gives the local K-Bot extension one consented National Life login
attempt when an already-approved sync, illustration, or iGO draft loses its
carrier session. It never handles MFA or CAPTCHA and never starts an operation.
The existing operation ID, device ID, authentication epoch and exact Auth0 page
contract must all agree before a credential lease is issued.

Plaintext exists only inside two short-lived boundaries:

1. the Keepr One web process while it sends a new credential to Vault Transit
   `encrypt` after password re-verification and explicit consent;
2. the private broker while it calls Vault Transit `decrypt`, seals the result
   to the extension device public key, and clears its local object.

PostgreSQL stores only a Vault ciphertext plus masked metadata. The web process
has an encrypt-only Vault identity. Only the private broker has a decrypt-only
identity. The extension private RSA-OAEP key is non-extractable in IndexedDB.
No API can reveal or copy a saved credential.

## Vault Transit bootstrap

Enable Transit and create a derived, non-exportable, non-deletable key. Keep the
actual mount and key names aligned with `KBOT_CREDENTIAL_VAULT_MOUNT` and
`KBOT_CREDENTIAL_VAULT_KEY`.

```bash
vault secrets enable -path=transit transit
vault write transit/keys/kbot-national-life \
  type=aes256-gcm96 derived=true exportable=false allow_plaintext_backup=false deletion_allowed=false
```

The Keepr One web role gets only:

```hcl
path "transit/encrypt/kbot-national-life" {
  capabilities = ["update"]
}
```

The private broker role gets only:

```hcl
path "transit/decrypt/kbot-national-life" {
  capabilities = ["update"]
}
```

Use two distinct Vault Agent configurations and file sinks. Mount the web sink
read-only at the path in `KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE`; mount the
broker sink read-only at `/run/secrets/vault-token`. Never put a token value in
an environment variable, image, Compose file, database, or repository.

Both Transit calls use a derived context bound to agent ID, provider,
credential format and purpose. Restoring ciphertext under another agent does
not produce a usable credential.

## Deployment order

1. Confirm carrier/compliance authorization and back up PostgreSQL.
2. Apply `20260901170000_add_kbot_credential_broker` with the feature disabled.
3. Create the Vault key, policies, roles and two token sinks.
4. Deploy `deploy/kbot-credential-broker.compose.yaml` on the private Coolify
   network. It must have no `ports`, public domain, Traefik labels or public
   router. `expose: 3020` is container-network metadata only.
5. Configure the web service with the encrypt sink and the exact private URL
   `http://kbot-credential-broker:3020`. Do not mount the decrypt sink there.
6. Confirm Redis is available. Lease rate limiting fails closed if Redis is
   unavailable; do not replace that behavior with an in-memory fallback.
7. Deploy Keepr One with `KBOT_CREDENTIAL_BROKER_ENABLED=false`.
8. Publish/install the reviewed K-Bot extension artifact.
9. Enable one exact agent ID in both processes; keep all-agent rollout false.
10. Complete the pilot checklist before adding another agent.

Shared settings:

```text
KBOT_CREDENTIAL_BROKER_ENABLED
KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS
KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS
KBOT_CREDENTIAL_VAULT_ADDR
KBOT_CREDENTIAL_VAULT_MOUNT
KBOT_CREDENTIAL_VAULT_KEY
```

Web-only settings:

```text
KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE
KBOT_CREDENTIAL_BROKER_URL=http://kbot-credential-broker:3020
```

Broker-only settings:

```text
KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE=/run/secrets/vault-token
KBOT_CREDENTIAL_BROKER_PORT=3020
DATABASE_URL
REDIS_URL
```

Startup deliberately fails if a decrypt token is configured in the web runtime
or an encrypt token is configured in the broker runtime.

## Health and isolation proof

From inside the private network:

```bash
curl --fail --silent http://kbot-credential-broker:3020/health
```

Expected: `{"ok":true}` and `Cache-Control: no-store`.

Inspect the running container and verify UID/GID `10001:10001`, read-only root
filesystem, `/tmp` tmpfs, all Linux capabilities dropped and
`no-new-privileges`. From the public Internet, port 3020 and a broker hostname
must not resolve or connect. Keepr One is the bounded public proxy and forwards
only the closed signing-header allowlist, exact request bytes and safe response
headers.

## Pilot proof

Use a dedicated test carrier account and a pilot agent ID.

1. Save the National Life username/password in Settings. Confirm the form
   requires the current Keepr One password and unchecked consent.
2. Confirm PostgreSQL has `encryptionProvider = 'VAULT_TRANSIT'`, a
   `vault:v...` value, masked username, consent timestamp and no legacy AES
   payload fields.
3. Expire the National Life session and start one approved Sync or command.
4. Confirm exactly one lease for `(device, operation, authEpoch)` and one login
   submit. Browser-worker restart must not produce a second attempt.
5. If National Life requests MFA, confirm K-Bot activates the carrier tab,
   creates one `NATIONAL_LIFE_MFA_REQUIRED` notification and never reads or
   fills the MFA field.
6. Complete MFA manually. Confirm the same run/command and checkpoint resume.
7. Run Sync, a Term illustration, an IUL illustration and an iGO application
   draft. Validate carrier read-back and the official PDFs/receipts; a green UI
   alone is not proof.
8. Inspect lease, audit and notification records using IDs only. Never put a
   real username/password in a log search command.

Disable immediately if the login repeats, the page classifies as unknown, a
CAPTCHA appears unexpectedly, a secret-shaped value reaches logs/storage, or
carrier behavior differs from the approved contract.

## Rotation, backup and recovery

Rotate the Transit key with:

```bash
vault write -f transit/keys/kbot-national-life/rotate
```

Existing ciphertext remains decryptable by its embedded version. Rewrap rows in
a controlled batch with Transit `rewrap` using the same derived context, verify
row counts and versions, then retain old key versions according to policy. Do
not decrypt and re-encrypt in application code.

Back up PostgreSQL ciphertext and Vault's storage/snapshots together. A database
backup without the matching Vault key material is intentionally unrecoverable.
Restore first into an isolated environment with the rollout disabled, validate
row counts and one synthetic decrypt/reseal flow, then promote.

Rotate Vault Agent credentials independently from the Transit key. A broker
token rotation must not alter the web token. A device encryption-key loss
requires explicit re-pairing or an approved rotation flow; never silently
replace the device key after a conflict.

## Revocation and kill switch

- Credential: use Settings → Remove credential. This clears Vault ciphertext,
  disables auto-login and records a safe audit event.
- Device: revoke/unpair the connector. Device signatures and encryption-key
  binding then fail closed; no new lease is issued.
- Global: set `KBOT_CREDENTIAL_BROKER_ENABLED=false` in web and broker, redeploy
  both, and confirm lease requests return the safe unavailable response while
  manual login still resumes existing work.
- Agent: remove the exact ID from `KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS` in both
  runtimes and redeploy.

Record only aggregate pilot metrics: leases issued, authenticated, MFA,
rejected, unknown page, broker unavailable and duplicate-prevented counts. Do
not attach credentials, cookies, tokens, form values, screenshots of login
fields or complete Auth0 URLs.
