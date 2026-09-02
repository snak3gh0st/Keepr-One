import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('K-Bot credential broker compose isolation', () => {
  it('has private-only ingress, split Vault identity and hardened filesystem', () => {
    const compose = readFileSync('deploy/kbot-credential-broker.compose.yaml', 'utf8')
    expect(compose).toContain('dockerfile: Dockerfile.kbot-credential-broker')
    expect(compose).toContain('expose:')
    expect(compose).toContain('- "3020"')
    expect(compose).not.toMatch(/^\s+ports:/m)
    expect(compose).not.toMatch(/traefik|caddy|router/i)
    expect(compose).toContain('KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE: /run/secrets/vault-token')
    expect(compose).not.toContain('KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE')
    expect(compose).toContain(':/run/secrets/vault-token:ro')
    expect(compose).toContain('NODE_EXTRA_CA_CERTS: /run/secrets/vault-ca.crt')
    expect(compose).toContain(':/run/secrets/vault-ca.crt:ro')
    expect(compose).toContain('read_only: true')
    expect(compose).toContain('/tmp:rw,noexec,nosuid')
    expect(compose).toContain('user: "10001:10001"')
    expect(compose).not.toMatch(/privileged:\s*true/)
    expect(compose).toContain('http://127.0.0.1:3020/health')
    expect(compose).toContain('coolify:')
  })

  it('starts without a writable package-manager cache', () => {
    const dockerfile = readFileSync('Dockerfile.kbot-credential-broker', 'utf8')
    expect(dockerfile).toContain('CMD ["./node_modules/.bin/tsx", "scripts/kbot-credential-broker.ts"]')
    expect(dockerfile).not.toContain('CMD ["pnpm"')
  })
})
