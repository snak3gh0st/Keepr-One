import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('K-Bot Vault production compose', () => {
  const compose = readFileSync('deploy/kbot-vault.compose.yaml', 'utf8')
  const vaultConfig = readFileSync('deploy/kbot-vault/vault.hcl', 'utf8')
  const encryptAgent = readFileSync('deploy/kbot-vault/agent-encrypt.hcl', 'utf8')
  const decryptAgent = readFileSync('deploy/kbot-vault/agent-decrypt.hcl', 'utf8')
  const envExample = readFileSync('deploy/kbot-vault.env.example', 'utf8')
  const encryptPolicy = readFileSync('deploy/kbot-vault/policy-encrypt.hcl', 'utf8')
  const decryptPolicy = readFileSync('deploy/kbot-vault/policy-decrypt.hcl', 'utf8')

  it('pins Vault by version and digest and never publishes a port', () => {
    expect(compose).toContain('hashicorp/vault:1.21.4@sha256:4e33b126a59c0c333b76fb4e894722462659a6bec7c48c9ee8cea56fccfd2569')
    expect(compose).toContain('expose:')
    expect(compose).not.toMatch(/^\s+ports:/m)
    expect(compose).not.toMatch(/traefik|caddy|router/i)
  })

  it('uses encrypted Raft storage, verified TLS and no development mode', () => {
    expect(vaultConfig).toContain('storage "raft"')
    expect(vaultConfig).toContain('tls_cert_file')
    expect(vaultConfig).toContain('tls_key_file')
    expect(vaultConfig).toContain('disable_mlock = true')
    expect(compose).not.toMatch(/-dev|VAULT_DEV_ROOT_TOKEN_ID/)
  })

  it('mounts initialization material read-only instead of copying into the read-only rootfs', () => {
    expect(compose).toContain('KBOT_VAULT_BOOTSTRAP_DIR')
    expect(compose).toContain(':/vault/bootstrap:ro')
  })

  it('checks health through the DNS name covered by the Vault certificate', () => {
    expect(compose).toContain('"-address=https://kbot-vault:8200"')
    expect(compose).not.toContain('"-address=https://127.0.0.1:8200"')
  })

  it('bypasses the image entrypoint directory default so the listener is loaded once', () => {
    expect(compose).toContain('command: ["vault", "server", "-config=/vault/config/vault.hcl"]')
    expect(compose).not.toContain('command: server -config=')
  })

  it('runs all services unprivileged with read-only roots and no capabilities', () => {
    expect(compose).toContain('user: "100:1000"')
    expect(compose.match(/user: "10001:10001"/g)).toHaveLength(2)
    expect(compose.match(/read_only: true/g)).toHaveLength(3)
    expect(compose.match(/no-new-privileges:true/g)).toHaveLength(3)
    expect(compose.match(/cap_drop:/g)).toHaveLength(3)
  })

  it('uses separate AppRoles and token sinks without embedding tokens', () => {
    expect(compose).toContain('KBOT_VAULT_ENCRYPT_APPROLE_DIR')
    expect(compose).toContain('KBOT_VAULT_DECRYPT_APPROLE_DIR')
    expect(compose).toContain('KBOT_VAULT_ENCRYPT_TOKEN_DIR')
    expect(compose).toContain('KBOT_VAULT_DECRYPT_TOKEN_DIR')
    expect(compose).not.toMatch(/VAULT_TOKEN:/)
    expect(encryptAgent).toContain('/vault/approle/role-id')
    expect(decryptAgent).toContain('/vault/approle/role-id')
    expect(encryptAgent).toContain('mode = 0400')
    expect(decryptAgent).toContain('mode = 0400')
    expect(encryptAgent).toContain('remove_secret_id_file_after_reading = false')
    expect(decryptAgent).toContain('remove_secret_id_file_after_reading = false')
    expect(envExample).not.toMatch(/TOKEN=|SECRET=|PASSWORD=/)
    expect(encryptPolicy).toContain('transit/encrypt/kbot-national-life')
    expect(encryptPolicy).not.toContain('transit/decrypt/kbot-national-life')
    expect(decryptPolicy).toContain('transit/decrypt/kbot-national-life')
    expect(decryptPolicy).not.toContain('transit/encrypt/kbot-national-life')
  })
})
