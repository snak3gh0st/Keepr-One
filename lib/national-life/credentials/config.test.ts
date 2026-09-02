import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  getKBotCredentialBrokerConfig,
  getKBotCredentialWebConfig,
} from './config'

const shared = {
  NODE_ENV: 'production',
  KBOT_CREDENTIAL_BROKER_ENABLED: 'true',
  KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS: 'agent-1,agent-2',
  KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS: 'false',
  KBOT_CREDENTIAL_VAULT_ADDR: 'https://vault.internal.example',
  KBOT_CREDENTIAL_VAULT_MOUNT: 'transit',
  KBOT_CREDENTIAL_VAULT_KEY: 'kbot-national-life',
} as const

describe('K-Bot credential runtime configuration', () => {
  it('stays inert without any secret configuration when disabled', () => {
    expect(getKBotCredentialWebConfig({
      NODE_ENV: 'production',
      KBOT_CREDENTIAL_BROKER_ENABLED: 'false',
    })).toEqual({
      enabled: false,
      autoLoginAgentIds: new Set(),
      autoLoginAllAgents: false,
    })
  })

  it('gives the web runtime only encrypt capability', () => {
    const config = getKBotCredentialWebConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: '/run/secrets/vault-encrypt-token',
      KBOT_CREDENTIAL_BROKER_URL: 'http://kbot-credential-broker:3020',
    })

    expect(config).toMatchObject({
      enabled: true,
      autoLoginAgentIds: new Set(['agent-1', 'agent-2']),
      autoLoginAllAgents: false,
      vault: {
        vaultAddress: 'https://vault.internal.example',
        mount: 'transit',
        key: 'kbot-national-life',
        tokenFile: '/run/secrets/vault-encrypt-token',
      },
      brokerUrl: 'http://kbot-credential-broker:3020',
    })
    expect(config).not.toHaveProperty('decryptTokenFile')
  })

  it('gives the broker runtime only decrypt capability', () => {
    const config = getKBotCredentialBrokerConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE: '/run/secrets/vault-decrypt-token',
      KBOT_CREDENTIAL_BROKER_PORT: '3020',
    })

    expect(config).toMatchObject({
      enabled: true,
      port: 3020,
      vault: { tokenFile: '/run/secrets/vault-decrypt-token' },
    })
    expect(config).not.toHaveProperty('encryptTokenFile')
  })

  it('rejects a runtime that can load both Vault identities', () => {
    expect(() => getKBotCredentialWebConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: '/run/secrets/vault-encrypt-token',
      KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE: '/run/secrets/vault-decrypt-token',
      KBOT_CREDENTIAL_BROKER_URL: 'http://kbot-credential-broker:3020',
    })).toThrow(/split|decrypt/i)
    expect(() => getKBotCredentialBrokerConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: '/run/secrets/vault-encrypt-token',
      KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE: '/run/secrets/vault-decrypt-token',
      KBOT_CREDENTIAL_BROKER_PORT: '3020',
    })).toThrow(/split|encrypt/i)
  })

  it('fails closed when enabled configuration is missing or unsafe', () => {
    expect(() => getKBotCredentialWebConfig(shared)).toThrow(/ENCRYPT_TOKEN_FILE/)
    expect(() => getKBotCredentialWebConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: 'relative/token',
      KBOT_CREDENTIAL_BROKER_URL: 'http://kbot-credential-broker:3020',
    })).toThrow(/absolute/)
    expect(() => getKBotCredentialWebConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_ADDR: 'https://user:password@vault.example.com',
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: '/run/secrets/token',
      KBOT_CREDENTIAL_BROKER_URL: 'http://kbot-credential-broker:3020',
    })).toThrow(/VAULT_ADDR/)
    expect(() => getKBotCredentialWebConfig({
      ...shared,
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: '/run/secrets/token',
      KBOT_CREDENTIAL_BROKER_URL: 'http://attacker.example:3020',
    })).toThrow(/BROKER_URL/)
  })

  it('rejects an unbounded all-agent rollout combined with an allowlist', () => {
    expect(() => getKBotCredentialWebConfig({
      ...shared,
      KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS: 'true',
      KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE: '/run/secrets/token',
      KBOT_CREDENTIAL_BROKER_URL: 'http://kbot-credential-broker:3020',
    })).toThrow(/allowlist/i)
  })

  it('documents only server-side credential variables', async () => {
    const envExample = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8')
    expect(envExample).toContain('KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE')
    expect(envExample).toContain('KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE')
    expect(envExample).not.toMatch(/NEXT_PUBLIC_KBOT_CREDENTIAL/)
  })
})
