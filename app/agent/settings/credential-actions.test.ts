import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  revalidatePath: vi.fn(),
  getCurrentAgent: vi.fn(),
  verifyPassword: vi.fn(),
  saveNationalLifeCredential: vi.fn(),
  revokeNationalLifeCredential: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/auth', () => ({ auth: { api: { verifyPassword: mocks.verifyPassword } } }))
vi.mock('@/lib/national-life/credentials/settings-service', () => ({
  saveNationalLifeCredential: mocks.saveNationalLifeCredential,
  revokeNationalLifeCredential: mocks.revokeNationalLifeCredential,
}))

import {
  revokeNationalLifeCredentialAction,
  saveNationalLifeCredentialAction,
} from './credential-actions'
import { INITIAL_SETTINGS_ACTION_STATE } from './state'

const agent = { id: 'agent-1', userId: 'user-1', status: 'ACTIVE' }
const requestHeaders = new Headers({ 'x-request-id': 'credential-settings-test' })

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [name, value] of Object.entries(values)) data.set(name, value)
  return data
}

function saveForm(overrides: Record<string, string> = {}) {
  return form({
    username: 'agent123',
    nationalLifePassword: 'sentinel-national-life-password',
    keeprOnePassword: 'current-keeprone-password',
    consent: 'on',
    agentId: 'attacker-controlled-agent',
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.headers.mockResolvedValue(requestHeaders)
  mocks.getCurrentAgent.mockResolvedValue(agent)
  mocks.verifyPassword.mockResolvedValue({ status: true })
  mocks.saveNationalLifeCredential.mockResolvedValue({ configured: true })
  mocks.revokeNationalLifeCredential.mockResolvedValue({ configured: false })
})

describe('National Life credential Settings actions', () => {
  it('rejects missing consent before session, authentication, or encryption', async () => {
    const result = await saveNationalLifeCredentialAction(
      INITIAL_SETTINGS_ACTION_STATE,
      saveForm({ consent: '' }),
    )

    expect(result).toMatchObject({
      status: 'error',
      fieldErrors: { consent: expect.any(String) },
    })
    expect(mocks.getCurrentAgent).not.toHaveBeenCalled()
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
    expect(mocks.saveNationalLifeCredential).not.toHaveBeenCalled()
  })

  it('reauthenticates Keepr One before sending the credential to the encrypting service', async () => {
    const result = await saveNationalLifeCredentialAction(
      INITIAL_SETTINGS_ACTION_STATE,
      saveForm(),
    )

    expect(result).toEqual({
      status: 'success',
      message: 'Credencial protegida. O K-Bot poderá tentar um login quando a sessão expirar.',
    })
    expect(mocks.verifyPassword).toHaveBeenCalledWith({
      headers: requestHeaders,
      body: { password: 'current-keeprone-password' },
    })
    expect(mocks.saveNationalLifeCredential).toHaveBeenCalledWith({
      agentId: 'agent-1',
      userId: 'user-1',
      username: 'agent123',
      password: 'sentinel-national-life-password',
    })
    expect(mocks.verifyPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveNationalLifeCredential.mock.invocationCallOrder[0],
    )
    expect(JSON.stringify(mocks.saveNationalLifeCredential.mock.calls)).not.toContain(
      'attacker-controlled-agent',
    )
  })

  it('maps an invalid Keepr One password only to the reauthentication field', async () => {
    mocks.verifyPassword.mockRejectedValue(Object.assign(new Error('provider detail'), {
      body: { code: 'INVALID_PASSWORD' },
    }))

    const result = await saveNationalLifeCredentialAction(
      INITIAL_SETTINGS_ACTION_STATE,
      saveForm(),
    )

    expect(result).toEqual({
      status: 'error',
      message: 'A senha atual do Keepr One não confere.',
      fieldErrors: { keeprOnePassword: 'Confira sua senha atual.' },
    })
    expect(mocks.saveNationalLifeCredential).not.toHaveBeenCalled()
  })

  it('returns a fixed safe error even if a dependency includes carrier secrets', async () => {
    mocks.saveNationalLifeCredential.mockRejectedValue(
      new Error('sentinel-national-life-password vault:v7:ciphertext'),
    )

    const result = await saveNationalLifeCredentialAction(
      INITIAL_SETTINGS_ACTION_STATE,
      saveForm(),
    )

    expect(result.status).toBe('error')
    expect(JSON.stringify(result)).not.toContain('sentinel-national-life-password')
    expect(JSON.stringify(result)).not.toContain('vault:v7:ciphertext')
  })

  it('requires Keepr One reauthentication to revoke', async () => {
    const result = await revokeNationalLifeCredentialAction(
      INITIAL_SETTINGS_ACTION_STATE,
      form({ keeprOnePassword: 'current-keeprone-password' }),
    )

    expect(result).toEqual({
      status: 'success',
      message: 'Credencial removida. O K-Bot voltará a pedir login manual.',
    })
    expect(mocks.verifyPassword.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.revokeNationalLifeCredential.mock.invocationCallOrder[0],
    )
  })

  it.each(['client account', 'inactive agent'])('does not reach the service for a %s', async () => {
    mocks.getCurrentAgent.mockRejectedValue(new Error('access denied'))

    const result = await saveNationalLifeCredentialAction(
      INITIAL_SETTINGS_ACTION_STATE,
      saveForm(),
    )

    expect(result.status).toBe('error')
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
    expect(mocks.saveNationalLifeCredential).not.toHaveBeenCalled()
  })
})
