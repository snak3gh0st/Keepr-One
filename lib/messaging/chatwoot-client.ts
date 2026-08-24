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
  createAccount: (input: { name: string; locale: string }) => Promise<{ id: string }>
  createUser: (input: {
    name: string
    email: string
    password: string
  }) => Promise<{ id: string; accessToken: string }>
  linkUserToAccount: (input: { accountId: string; userId: string }) => Promise<void>
  createSsoUrl: (input: { userId: string }) => Promise<string>
  simplifyAccount: (input: { accountId: string }) => Promise<void>
  listWhatsappInboxes: (input: {
    accountId: string
    userAccessToken: string
  }) => Promise<ChatwootWhatsappInbox[]>
}

export type ChatwootWhatsappInbox = {
  id: string
  name: string
  phoneNumber: string | null
  provider: string | null
}

/// A solo insurance agent connects a channel and talks to clients. Everything
/// below is built for a support team — assignment queues, bots, analytics, a
/// knowledge base, Chatwoot's own support inbox — and each one is a sidebar entry
/// or a settings page the agent has to read past to find what they came for.
const FEATURES_A_SOLO_AGENT_NEVER_USES = [
  'agent_bots',
  'agent_management',
  'team_management',
  'api_and_webhooks',
  'assignment_v2',
  'automations',
  'campaigns',
  'captain_tasks',
  'help_center',
  'reports',
  'macros',
  'integrations',
  'contact_chatwoot_support_team',
  'channel_tiktok',
  'custom_attributes',
]

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
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
    createAccount: async ({ name, locale }) => {
      const body = await call('/platform/api/v1/accounts', {
        method: 'POST',
        // Chatwoot defaults an account to English. The agent reads Portuguese, and
        // an inbox that greets them in another language is not theirs.
        body: JSON.stringify({ name, locale }),
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

    simplifyAccount: async ({ accountId }) => {
      await call(`/platform/api/v1/accounts/${accountId}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled_features: FEATURES_A_SOLO_AGENT_NEVER_USES }),
      })
    },

    createSsoUrl: async ({ userId }) => {
      const body = await call(`/platform/api/v1/users/${userId}/login`, { method: 'GET' })
      return String(body.url)
    },

    listWhatsappInboxes: async ({ accountId, userAccessToken }) => {
      const body = await call(`/api/v1/accounts/${accountId}/inboxes`, {
        method: 'GET',
        // This is an account API, not a platform API. The scoped user token can
        // only see this agent's structurally isolated Chatwoot account.
        headers: { api_access_token: userAccessToken },
      })
      return asArray(body.payload)
        .map(asRecord)
        .filter((inbox) => inbox.channel_type === 'Channel::Whatsapp')
        .map((inbox) => ({
          id: String(inbox.id),
          name: typeof inbox.name === 'string' ? inbox.name : 'WhatsApp',
          phoneNumber: typeof inbox.phone_number === 'string' ? inbox.phone_number : null,
          provider: typeof inbox.provider === 'string' ? inbox.provider : null,
        }))
    },
  }
}
