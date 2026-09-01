import 'server-only'

import path from 'node:path'

type CredentialEnvironment = Record<string, string | undefined>

type CredentialRollout = Readonly<{
  enabled: boolean
  autoLoginAgentIds: ReadonlySet<string>
  autoLoginAllAgents: boolean
}>

type VaultRuntimeConfig = Readonly<{
  vaultAddress: string
  mount: string
  key: string
  tokenFile: string
}>

export type KBotCredentialWebConfig = CredentialRollout & Readonly<{
  vault?: VaultRuntimeConfig
  brokerUrl?: string
}>

export type KBotCredentialBrokerConfig = CredentialRollout & Readonly<{
  vault?: VaultRuntimeConfig
  port?: number
}>

const identifierPattern = /^[A-Za-z0-9._:-]{1,128}$/
const vaultNamePattern = /^[a-z0-9][a-z0-9_-]{0,63}$/

function parseBoolean(name: string, value: string | undefined, defaultValue = false) {
  const normalized = value?.trim() ?? String(defaultValue)
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`${name} must be true or false`)
}

function parseAgentIds(value: string | undefined) {
  const values = (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  if (values.some((item) => !identifierPattern.test(item))) {
    throw new Error('KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS contains an invalid identifier')
  }
  return new Set(values)
}

function parseRollout(env: CredentialEnvironment): CredentialRollout {
  const enabled = parseBoolean(
    'KBOT_CREDENTIAL_BROKER_ENABLED',
    env.KBOT_CREDENTIAL_BROKER_ENABLED,
  )
  const autoLoginAgentIds = parseAgentIds(env.KBOT_CREDENTIAL_AUTO_LOGIN_AGENT_IDS)
  const autoLoginAllAgents = parseBoolean(
    'KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS',
    env.KBOT_CREDENTIAL_AUTO_LOGIN_ALL_AGENTS,
  )
  if (autoLoginAllAgents && autoLoginAgentIds.size > 0) {
    throw new Error('All-agent rollout and the agent allowlist are mutually exclusive')
  }
  return { enabled, autoLoginAgentIds, autoLoginAllAgents }
}

function required(env: CredentialEnvironment, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required when the credential broker is enabled`)
  return value
}

function parseVaultAddress(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('KBOT_CREDENTIAL_VAULT_ADDR must be an exact HTTPS origin')
  }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
    (url.pathname !== '/' && url.pathname !== '') || url.origin !== value.replace(/\/$/, '')
  ) {
    throw new Error('KBOT_CREDENTIAL_VAULT_ADDR must be an exact HTTPS origin')
  }
  return url.origin
}

function parseTokenFile(name: string, value: string) {
  if (!path.isAbsolute(value) || value.includes('\0')) {
    throw new Error(`${name} must be an absolute token-sink path`)
  }
  return value
}

function sharedVaultConfig(env: CredentialEnvironment) {
  const vaultAddress = parseVaultAddress(required(env, 'KBOT_CREDENTIAL_VAULT_ADDR'))
  const mount = required(env, 'KBOT_CREDENTIAL_VAULT_MOUNT')
  const key = required(env, 'KBOT_CREDENTIAL_VAULT_KEY')
  if (!vaultNamePattern.test(mount) || !vaultNamePattern.test(key)) {
    throw new Error('KBOT_CREDENTIAL_VAULT_MOUNT and KBOT_CREDENTIAL_VAULT_KEY are invalid')
  }
  return { vaultAddress, mount, key }
}

function parseBrokerUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('KBOT_CREDENTIAL_BROKER_URL is invalid')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== 'kbot-credential-broker' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value.replace(/\/$/, '')
  ) {
    throw new Error('KBOT_CREDENTIAL_BROKER_URL must use the private broker service origin')
  }
  return url.origin
}

function parsePort(value: string) {
  if (!/^[0-9]+$/.test(value)) throw new Error('KBOT_CREDENTIAL_BROKER_PORT is invalid')
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('KBOT_CREDENTIAL_BROKER_PORT is invalid')
  }
  return port
}

export function getKBotCredentialWebConfig(
  env: CredentialEnvironment = process.env,
): KBotCredentialWebConfig {
  const rollout = parseRollout(env)
  if (env.KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE?.trim()) {
    throw new Error('Vault identity split forbids a decrypt token in the web runtime')
  }
  if (!rollout.enabled) return rollout

  const tokenFile = parseTokenFile(
    'KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE',
    required(env, 'KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE'),
  )
  return {
    ...rollout,
    vault: { ...sharedVaultConfig(env), tokenFile },
    brokerUrl: parseBrokerUrl(required(env, 'KBOT_CREDENTIAL_BROKER_URL')),
  }
}

export function getKBotCredentialBrokerConfig(
  env: CredentialEnvironment = process.env,
): KBotCredentialBrokerConfig {
  const rollout = parseRollout(env)
  if (env.KBOT_CREDENTIAL_VAULT_ENCRYPT_TOKEN_FILE?.trim()) {
    throw new Error('Vault identity split forbids an encrypt token in the broker runtime')
  }
  if (!rollout.enabled) return rollout

  const tokenFile = parseTokenFile(
    'KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE',
    required(env, 'KBOT_CREDENTIAL_VAULT_DECRYPT_TOKEN_FILE'),
  )
  return {
    ...rollout,
    vault: { ...sharedVaultConfig(env), tokenFile },
    port: parsePort(required(env, 'KBOT_CREDENTIAL_BROKER_PORT')),
  }
}
