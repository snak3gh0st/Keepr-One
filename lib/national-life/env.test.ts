import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REQUIRED_ENV = {
  STEEL_BASE_URL: 'https://steel.example',
  NATIONAL_LIFE_PORTAL_ORIGINS: 'https://agent.nationallife.example',
  NATIONAL_LIFE_PORTAL_LOGIN_URL: 'https://agent.nationallife.example/login',
  NATIONAL_LIFE_CREDENTIAL_SCOPE_ID: 'scope-1',
  NATIONAL_LIFE_CREDENTIAL_KEY_VERSION: 'v1',
  NATIONAL_LIFE_CREDENTIAL_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }),
} as const

const ENV_KEYS = Object.keys(REQUIRED_ENV) as Array<keyof typeof REQUIRED_ENV>

function clearEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

describe('isNationalLifeConfigured', () => {
  beforeEach(() => {
    vi.resetModules()
    clearEnv()
  })

  afterEach(() => {
    clearEnv()
  })

  it('returns false when required environment variables are missing', async () => {
    const { isNationalLifeConfigured } = await import('./env')
    expect(isNationalLifeConfigured()).toBe(false)
  })

  it('does not throw when environment variables are missing', async () => {
    const { isNationalLifeConfigured } = await import('./env')
    expect(() => isNationalLifeConfigured()).not.toThrow()
  })

  it('returns true once all required environment variables are valid', async () => {
    Object.assign(process.env, REQUIRED_ENV)
    const { isNationalLifeConfigured } = await import('./env')
    expect(isNationalLifeConfigured()).toBe(true)
  })
})
