import { describe, expect, it } from 'vitest'
import { createChatwootClient, type ChatwootHttp } from './chatwoot-client'

function recorder(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = []
  let index = 0
  const http: ChatwootHttp = async (url, init) => {
    calls.push({ url, init })
    const body = responses[index] ?? {}
    index += 1
    return { ok: true, status: 200, json: async () => body }
  }
  return { http, calls }
}

const config = (http: ChatwootHttp) => ({
  baseUrl: 'https://chat.example.com',
  platformToken: 'secret-token',
  http,
})

describe('createChatwootClient', () => {
  it('creates an account and returns its id', async () => {
    const { http, calls } = recorder([{ id: 7, name: 'Felipe' }])
    const client = createChatwootClient(config(http))

    const account = await client.createAccount({ name: 'Felipe', locale: 'pt_BR' })

    expect(account).toEqual({ id: '7' })
    expect(calls[0]?.url).toBe('https://chat.example.com/platform/api/v1/accounts')
    expect(calls[0]?.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.init.body)).locale).toBe('pt_BR')
  })

  it('authenticates with the platform token header on every call', async () => {
    const { http, calls } = recorder([{ id: 7 }])
    const client = createChatwootClient(config(http))

    await client.createAccount({ name: 'Felipe', locale: 'pt_BR' })

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers.api_access_token).toBe('secret-token')
  })

  it('creates a user and returns id and access token', async () => {
    const { http } = recorder([{ id: 12, access_token: 'user-token' }])
    const client = createChatwootClient(config(http))

    const user = await client.createUser({ name: 'Felipe', email: 'f@example.com', password: 'x'.repeat(20) })

    expect(user).toEqual({ id: '12', accessToken: 'user-token' })
  })

  it('links a user to an account as administrator', async () => {
    const { http, calls } = recorder([{}])
    const client = createChatwootClient(config(http))

    await client.linkUserToAccount({ accountId: '7', userId: '12' })

    expect(calls[0]?.url).toBe('https://chat.example.com/platform/api/v1/accounts/7/account_users')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ user_id: '12', role: 'administrator' })
  })

  it('mints an SSO url so the agent never sees a second login', async () => {
    const { http, calls } = recorder([{ url: 'https://chat.example.com/app/login?sso_auth_token=abc' }])
    const client = createChatwootClient(config(http))

    const url = await client.createSsoUrl({ userId: '12' })

    expect(url).toBe('https://chat.example.com/app/login?sso_auth_token=abc')
    expect(calls[0]?.url).toBe('https://chat.example.com/platform/api/v1/users/12/login')
  })

  it('raises a typed error when Chatwoot refuses, instead of returning junk', async () => {
    const http: ChatwootHttp = async () => ({ ok: false, status: 422, json: async () => ({ message: 'taken' }) })
    const client = createChatwootClient(config(http))

    await expect(client.createAccount({ name: 'Felipe', locale: 'pt_BR' })).rejects.toThrow('CHATWOOT_REQUEST_FAILED')
  })
})
