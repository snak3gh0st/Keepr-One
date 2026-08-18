/// The Platform API is the administrative surface: it creates accounts and users
/// and mints login links. Its token is server-only — it can act on every account
/// in the instance, so it must never reach a browser.
///
/// `http` is injected rather than calling `fetch` directly so provisioning is
/// testable without a Chatwoot to talk to, the same reason `portfolio-ingest.ts`
/// injects its writes.

export type ChatwootResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

export type ChatwootHttp = (url: string, init: RequestInit) => Promise<ChatwootResponse>

export type ChatwootClient = {
  createAccount: (input: { name: string }) => Promise<{ id: string }>
  createUser: (input: {
    name: string
    email: string
    password: string
  }) => Promise<{ id: string; accessToken: string }>
  linkUserToAccount: (input: { accountId: string; userId: string }) => Promise<void>
  createSsoUrl: (input: { userId: string }) => Promise<string>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function createChatwootClient(config: {
  baseUrl: string
  platformToken: string
  http: ChatwootHttp
}): ChatwootClient {
  const call = async (path: string, init: RequestInit): Promise<Record<string, unknown>> => {
    const response = await config.http(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        api_access_token: config.platformToken,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error('CHATWOOT_REQUEST_FAILED')
    return asRecord(await response.json())
  }

  return {
    createAccount: async ({ name }) => {
      const body = await call('/platform/api/v1/accounts', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      return { id: String(body.id) }
    },

    createUser: async ({ name, email, password }) => {
      const body = await call('/platform/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
      })
      return { id: String(body.id), accessToken: String(body.access_token) }
    },

    linkUserToAccount: async ({ accountId, userId }) => {
      await call(`/platform/api/v1/accounts/${accountId}/account_users`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, role: 'administrator' }),
      })
    },

    createSsoUrl: async ({ userId }) => {
      const body = await call(`/platform/api/v1/users/${userId}/login`, { method: 'GET' })
      return String(body.url)
    },
  }
}
