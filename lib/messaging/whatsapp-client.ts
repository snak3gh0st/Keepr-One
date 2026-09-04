/// The QR provider holds one live WhatsApp Web session per agent. It is reachable
/// only from inside the deployment — publishing it would put the keys to every
/// agent's conversations on the open internet — so this client always talks to it
/// by container name, never through a public host.

export type WhatsappResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
export type WhatsappHttp = (url: string, init: RequestInit) => Promise<WhatsappResponse>

export class WhatsappRequestError extends Error {
  constructor(readonly status: number) {
    super('WHATSAPP_REQUEST_FAILED')
    this.name = 'WhatsappRequestError'
  }
}

export type WhatsappIdentity = {
  externalPhoneNumberId: string
  normalizedPhoneE164: string
}

export type WhatsappDeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'

export type WhatsappSendReceipt = {
  providerMessageId: string
  status: WhatsappDeliveryStatus | null
}

export type WhatsappClient = {
  createInstance: (input: { agentId: string }) => Promise<void>
  fetchQrCode: (input: { agentId: string }) => Promise<{ image: string } | null>
  connectionState: (input: { agentId: string }) => Promise<string>
  connectionIdentity: (input: { agentId: string }) => Promise<WhatsappIdentity | null>
  sendText: (input: { agentId: string; phone: string; text: string }) => Promise<WhatsappSendReceipt>
  messageStatus: (input: { agentId: string; phone: string; providerMessageId: string }) => Promise<WhatsappDeliveryStatus | null>
  logoutInstance: (input: { agentId: string }) => Promise<void>
  enforcePrivateChatSettings: (input: { agentId: string }) => Promise<void>
  linkToInbox: (input: {
    agentId: string
    chatwootAccountId: string
    chatwootUserToken: string
    chatwootUrl: string
  }) => Promise<void>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function targetFor(phone: string) {
  const match = /^\+(\d{8,15})$/.exec(phone)
  if (!match) throw new WhatsappRequestError(400)
  return { number: match[1], remoteJid: `${match[1]}@s.whatsapp.net` }
}

function deliveryStatus(values: unknown[]): WhatsappDeliveryStatus | null {
  const statuses = values.map(value => String(value).toUpperCase())
  if (statuses.includes('PLAYED') || statuses.includes('READ')) return 'READ'
  if (statuses.includes('DELIVERY_ACK')) return 'DELIVERED'
  if (statuses.includes('SERVER_ACK')) return 'SENT'
  if (statuses.includes('ERROR') || statuses.includes('FAILED')) return 'FAILED'
  return null
}

/// Derived from the agent id rather than their name: names repeat, and two agents
/// sharing an instance would put one agent's conversations in the other's inbox.
export function instanceNameFor(agentId: string): string {
  return `agent-${agentId}`
}

export function createWhatsappClient(config: {
  baseUrl: string
  apiKey: string
  http: WhatsappHttp
}): WhatsappClient {
  const callRaw = async (path: string, init: RequestInit): Promise<unknown> => {
    const response = await config.http(`${config.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', apikey: config.apiKey, ...(init.headers ?? {}) },
    })
    if (!response.ok) throw new WhatsappRequestError(response.status)
    return response.json()
  }
  const call = async (path: string, init: RequestInit): Promise<Record<string, unknown>> =>
    asRecord(await callRaw(path, init))

  return {
    createInstance: async ({ agentId }) => {
      await call('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName: instanceNameFor(agentId),
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      })
    },

    fetchQrCode: async ({ agentId }) => {
      const body = await call(`/instance/connect/${instanceNameFor(agentId)}`, { method: 'GET' })
      // `{count: 0}` means the session is still starting, not that it failed.
      // Reporting that as an error would tell the agent it broke when it is early.
      const image = body.base64
      return typeof image === 'string' && image.length > 0 ? { image } : null
    },

    connectionState: async ({ agentId }) => {
      const body = await call(`/instance/connectionState/${instanceNameFor(agentId)}`, { method: 'GET' })
      const instance = asRecord(body.instance)
      return typeof instance.state === 'string' ? instance.state : 'unknown'
    },

    connectionIdentity: async ({ agentId }) => {
      const body = await callRaw(
        `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceNameFor(agentId))}`,
        { method: 'GET' },
      )
      const row = asRecord(Array.isArray(body) ? body[0] : body)
      const ownerJid = row.ownerJid
      if (typeof ownerJid !== 'string') return null
      const match = /^(\d+)@s\.whatsapp\.net$/.exec(ownerJid)
      if (!match) return null
      return {
        externalPhoneNumberId: ownerJid,
        normalizedPhoneE164: `+${match[1]}`,
      }
    },

    sendText: async ({ agentId, phone, text }) => {
      const target = targetFor(phone)
      const body = await call(`/message/sendText/${instanceNameFor(agentId)}`, {
        method: 'POST', body: JSON.stringify({ number: target.number, text }),
      })
      const key = asRecord(body.key)
      if (typeof key.id !== 'string' || key.id.length === 0 || key.fromMe !== true || key.remoteJid !== target.remoteJid) {
        throw new WhatsappRequestError(502)
      }
      return { providerMessageId: key.id, status: deliveryStatus([body.status]) }
    },

    messageStatus: async ({ agentId, phone, providerMessageId }) => {
      const target = targetFor(phone)
      if (!providerMessageId) throw new WhatsappRequestError(400)
      const body = await call(`/chat/findMessages/${instanceNameFor(agentId)}`, {
        method: 'POST', body: JSON.stringify({
          where: { key: { id: providerMessageId, fromMe: true, remoteJid: target.remoteJid } }, limit: 1,
        }),
      })
      const records = Array.isArray(asRecord(body.messages).records) ? asRecord(body.messages).records as unknown[] : []
      if (records.length === 0) return null
      if (records.length !== 1) throw new WhatsappRequestError(502)
      const message = asRecord(records[0])
      const key = asRecord(message.key)
      if (key.id !== providerMessageId || key.fromMe !== true || key.remoteJid !== target.remoteJid) {
        throw new WhatsappRequestError(502)
      }
      const updates = Array.isArray(message.MessageUpdate) ? message.MessageUpdate.map(update => asRecord(update).status) : []
      return deliveryStatus([message.status, ...updates])
    },

    logoutInstance: async ({ agentId }) => {
      await call(`/instance/logout/${instanceNameFor(agentId)}`, { method: 'DELETE' })
    },

    enforcePrivateChatSettings: async ({ agentId }) => {
      await call(`/settings/set/${instanceNameFor(agentId)}`, {
        method: 'POST',
        body: JSON.stringify({
          rejectCall: false,
          msgCall: '',
          groupsIgnore: true,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: false,
        }),
      })
    },

    linkToInbox: async ({ agentId, chatwootAccountId, chatwootUserToken, chatwootUrl }) => {
      await call(`/chatwoot/set/${instanceNameFor(agentId)}`, {
        method: 'POST',
        body: JSON.stringify({
          enabled: true,
          accountId: chatwootAccountId,
          token: chatwootUserToken,
          url: chatwootUrl,
          signMsg: false,
          reopenConversation: true,
          conversationPending: false,
          nameInbox: 'WhatsApp',
          // Importing history is what made this call fail with a 500. The agent's
          // past conversations are not worth losing the connection over.
          importContacts: false,
          importMessages: false,
          autoCreate: true,
        }),
      })
    },
  }
}
