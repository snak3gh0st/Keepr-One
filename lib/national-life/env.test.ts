import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const key = Buffer.alloc(32, 1).toString('base64')
const signingKey = Buffer.alloc(32, 2).toString('base64')
const REQUIRED_ENV = {
  STEEL_BASE_URL: 'https://steel.example',
  STEEL_API_KEY: 'steel-key',
  NATIONAL_LIFE_PORTAL_ORIGINS:
    'https://auth.nationallife.example,https://agent.nationallife.example',
  NATIONAL_LIFE_PORTAL_LOGIN_URL:
    'https://auth.nationallife.example/login',
  NATIONAL_LIFE_SESSION_SCOPE_ID: 'production-us-east-1',
  NATIONAL_LIFE_SESSION_KEY_VERSION: 'v1',
  NATIONAL_LIFE_SESSION_KEYS: JSON.stringify({ v1: key }),
  NATIONAL_LIFE_VIEWER_SIGNING_KEY: signingKey,
  NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN: 'https://national-life-viewer.keepr.one',
  NATIONAL_LIFE_VIEWER_APP_ORIGINS:
    'https://keeprone.com,https://www.keeprone.com,https://app.keeprone.com',
  NATIONAL_LIFE_VIEWER_BIND_HOST: '0.0.0.0',
  NATIONAL_LIFE_VIEWER_PORT: '3010',
  NATIONAL_LIFE_RUNTIME_WORKER_ID: 'national-life-runtime-1',
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED: 'true',
  NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS: 'agent-1,agent-2',
  NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS: 'false',
  BETTER_AUTH_URL: 'https://app.keepr.one',
} as const

const ENV_KEYS = Object.keys(REQUIRED_ENV) as Array<keyof typeof REQUIRED_ENV>

function clearEnv() {
  for (const name of ENV_KEYS) {
    delete process.env[name]
  }
}

async function parse(
  overrides: Record<string, string | undefined> = {},
) {
  vi.resetModules()
  Object.assign(process.env, REQUIRED_ENV)
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }
  const { getNationalLifeEnv } = await import('./env')
  return getNationalLifeEnv()
}

describe('National Life secure runtime environment', () => {
  beforeEach(clearEnv)
  afterEach(clearEnv)

  it('requires and parses the dedicated session, viewer, rollout, and runtime settings', async () => {
    const env = await parse()

    expect(env.sessionScopeId).toBe('production-us-east-1')
    expect(env.sessionKeyVersion).toBe('v1')
    expect(env.viewerSigningKey).toEqual(Buffer.alloc(32, 2))
    expect(env.viewerPort).toBe(3010)
    expect(env.runtimeWorkerId).toBe('national-life-runtime-1')
    expect(env.interactiveLoginEnabled).toBe(true)
    expect(env.interactiveLoginAgentIds).toEqual(new Set(['agent-1', 'agent-2']))
    expect(env.viewerAppOrigins).toEqual([
      'https://keeprone.com',
      'https://www.keeprone.com',
      'https://app.keeprone.com',
    ])
  })

  it('reports the integration disabled when any required setting is missing', async () => {
    Object.assign(process.env, REQUIRED_ENV)
    delete process.env.NATIONAL_LIFE_VIEWER_SIGNING_KEY
    vi.resetModules()
    const { isNationalLifeConfigured } = await import('./env')

    expect(isNationalLifeConfigured()).toBe(false)
  })

  it('uses the authenticated app origin when the viewer allowlist is absent', async () => {
    const env = await parse({
      NATIONAL_LIFE_VIEWER_APP_ORIGINS: undefined,
    })

    expect(env.viewerAppOrigins).toEqual(['https://app.keepr.one'])
  })

  it.each([
    ['NATIONAL_LIFE_VIEWER_PUBLIC_ORIGIN', 'http://viewer.keepr.one'],
    ['BETTER_AUTH_URL', 'http://app.keepr.one'],
  ] as const)('rejects non-HTTPS %s', async (name, value) => {
    await expect(parse({ [name]: value })).rejects.toThrow(/HTTPS|origin/)
  })

  it('accepts the Steel API only through a private Docker service hostname', async () => {
    const env = await parse({
      STEEL_BASE_URL: 'http://national-life-steel:3000',
    })

    expect(env.steelBaseUrl).toBe('http://national-life-steel:3000')
  })

  it.each([
    'http://steel.example:3000',
    'http://127.0.0.1:3000',
    'http://national-life-steel:3000?target=https://example.com',
  ])('rejects unsafe non-HTTPS Steel URL %s', async (steelBaseUrl) => {
    await expect(parse({ STEEL_BASE_URL: steelBaseUrl })).rejects.toThrow(
      /STEEL_BASE_URL/,
    )
  })

  it.each([
    ['NATIONAL_LIFE_SESSION_KEYS', JSON.stringify({ v1: Buffer.alloc(31).toString('base64') })],
    ['NATIONAL_LIFE_VIEWER_SIGNING_KEY', Buffer.alloc(33).toString('base64')],
  ] as const)('rejects %s unless decoded key material is exactly 32 bytes', async (name, value) => {
    await expect(parse({ [name]: value })).rejects.toThrow(/32-byte/)
  })

  it.each(['0', '65536', 'abc'])('rejects invalid viewer port %s', async (port) => {
    await expect(parse({ NATIONAL_LIFE_VIEWER_PORT: port })).rejects.toThrow(
      /VIEWER_PORT/,
    )
  })

  it('rejects wildcard carrier origins', async () => {
    await expect(
      parse({ NATIONAL_LIFE_PORTAL_ORIGINS: 'https://*.nationallife.example' }),
    ).rejects.toThrow(/origins/)
  })

  it('rejects wildcard viewer app origins', async () => {
    await expect(
      parse({
        NATIONAL_LIFE_VIEWER_APP_ORIGINS: 'https://*.keeprone.com',
      }),
    ).rejects.toThrow(/VIEWER_APP_ORIGINS/)
  })

  it('accepts only explicit boolean rollout values', async () => {
    await expect(
      parse({ NATIONAL_LIFE_INTERACTIVE_LOGIN_ENABLED: 'yes' }),
    ).rejects.toThrow(/INTERACTIVE_LOGIN_ENABLED/)
  })

  it('parses exact allowed agent IDs and rejects wildcard rollout access', async () => {
    await expect(
      parse({ NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS: '*' }),
    ).rejects.toThrow(/wildcard/)
  })

  it('permits an explicit all-agent rollout without a named allowlist', async () => {
    const env = await parse({
      NATIONAL_LIFE_INTERACTIVE_LOGIN_ALL_AGENTS: 'true',
      NATIONAL_LIFE_INTERACTIVE_LOGIN_AGENT_IDS: '',
    })

    expect(env.interactiveLoginAllAgents).toBe(true)
    expect(env.interactiveLoginAgentIds).toEqual(new Set())
  })

  it('leaves the keep-alive SSO jump off unless it is explicitly turned on', async () => {
    expect((await parse()).keepAliveSsoJump).toBe(false)
    expect((await parse({ NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP: 'true' })).keepAliveSsoJump).toBe(true)
    await expect(parse({ NATIONAL_LIFE_KEEP_ALIVE_SSO_JUMP: 'yes' })).rejects.toThrow(
      /KEEP_ALIVE_SSO_JUMP/,
    )
  })

  it('rejects identical worker IDs for concurrent runtime fixtures', async () => {
    vi.resetModules()
    const {
      assertDistinctNationalLifeRuntimeWorkerIds,
    } = await import('./env')

    expect(() =>
      assertDistinctNationalLifeRuntimeWorkerIds([
        'national-life-runtime-1',
        'national-life-runtime-1',
      ]),
    ).toThrow(/unique/)
  })
})
