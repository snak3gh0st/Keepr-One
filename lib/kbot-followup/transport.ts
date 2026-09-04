import 'server-only'
import { prisma } from '@/lib/prisma'
import { getAgentAccessForAgent } from '@/lib/agent-access'
import { getAgentChatwootContext } from '@/lib/messaging/agent-chatwoot-context'
import { chatwootConfigFromEnv } from '@/lib/messaging/chatwoot-config'
import { whatsappConfigFromEnv } from '@/lib/messaging/whatsapp-config'
import { createWhatsappClient, type WhatsappClient } from '@/lib/messaging/whatsapp-client'
import { FollowupError, normalizePhone } from './domain'

type Obj = Record<string, unknown>
const obj = (x: unknown): Obj => x && typeof x === 'object' && !Array.isArray(x) ? x as Obj : {}
const arr = (x: unknown): Obj[] => Array.isArray(x) ? x.map(obj) : []
const numericId = (x: unknown) => /^\d+$/.test(String(x)) ? String(x) : null

export async function messagingTransport(agentId: string, automated = true) {
  const access = await getAgentAccessForAgent(agentId)
  if (!access.isActive || (access.enabledModules !== null && !access.enabledModules.includes('MESSAGES'))) throw new FollowupError('MESSAGES_DISABLED', 403)
  const context = await getAgentChatwootContext(agentId)
  const config = chatwootConfigFromEnv(process.env)!
  const channel = await prisma.agentMessagingChannel.findUnique({ where: { agentId_kind: { agentId, kind: 'WHATSAPP' } } })
  if (channel?.status !== 'CONNECTED') throw new FollowupError('WHATSAPP_DISCONNECTED')
  if (automated && (channel.provider !== 'EVOLUTION' || process.env.WHATSAPP_CHANNEL_MODE === 'META_CLOUD')) {
    throw new FollowupError('TEMPLATE_REQUIRED')
  }
  let whatsappClient: WhatsappClient | null = null
  if (channel.provider === 'EVOLUTION' && process.env.WHATSAPP_CHANNEL_MODE !== 'META_CLOUD') {
    const wc = whatsappConfigFromEnv(process.env)
    if (wc) whatsappClient = createWhatsappClient({ ...wc, http: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) })
  }
  if (automated) {
    if (!whatsappClient) throw new FollowupError('WHATSAPP_DISCONNECTED')
    if (await whatsappClient.connectionState({ agentId }) !== 'open') throw new FollowupError('WHATSAPP_DISCONNECTED')
    const identity = await whatsappClient.connectionIdentity({ agentId })
    if (!identity || identity.normalizedPhoneE164 !== channel.normalizedPhoneE164) throw new FollowupError('SENDER_CHANGED')
  }
  const inboxes = (await context.chatwoot.listInboxes({ accountId: context.accountId, token: context.token })).filter(i => i.kind === 'WHATSAPP')
  const inbox = channel.externalInboxId ? inboxes.find(i => i.id === channel.externalInboxId) : inboxes.length === 1 ? inboxes[0] : null
  if (!inbox) throw new FollowupError('WHATSAPP_INBOX_AMBIGUOUS')
  async function call(path: string, body?: Obj) {
    const response = await fetch(`${config.baseUrl}/api/v1/accounts/${encodeURIComponent(context.accountId)}${path}`, {
      method: body ? 'POST' : 'GET', headers: { api_access_token: context.token, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), cache: 'no-store',
    })
    // Do not include response bodies: providers can echo PII or tokens.
    if (!response.ok) throw new FollowupError(`MESSAGING_HTTP_${response.status}`)
    return obj(await response.json())
  }
  async function conversation(phone: string, name: string) {
    if (!normalizePhone(phone)) throw new FollowupError('PHONE_REQUIRED')
    const found = await call(`/contacts/search?q=${encodeURIComponent(phone)}`)
    const matches = arr(found.payload).filter(c => normalizePhone(String(c.phone_number ?? '')) === phone)
    if (matches.length > 1) throw new FollowupError('CONTACT_AMBIGUOUS')
    let contact = matches[0]
    if (!contact) {
      const created = await call('/contacts', { inbox_id: Number(inbox!.id), name: name.slice(0, 120), phone_number: phone })
      contact = obj(obj(created.payload).contact)
      if (!contact.id) contact = arr(created.payload)[0] ?? obj(created.payload)
    }
    const id = numericId(contact.id)
    if (!id || normalizePhone(String(contact.phone_number ?? '')) !== phone) throw new FollowupError('CONTACT_INVALID')
    if (contact.blocked === true) throw new FollowupError('OPTED_OUT')
    const existing = arr((await call(`/contacts/${id}/conversations`)).payload)
      .filter(c => String(c.inbox_id) === inbox!.id).sort((a, b) => Number(b.id) - Number(a.id))
    if (existing.length) return numericId(existing[0].id)!
    let link = arr(contact.contact_inboxes).find(i => String(obj(i.inbox).id) === inbox!.id)
    if (!link?.source_id) link = await call(`/contacts/${id}/contact_inboxes`, { inbox_id: Number(inbox!.id) })
    if (typeof link.source_id !== 'string') throw new FollowupError('CONTACT_INBOX_INVALID')
    const created = await call('/conversations', { inbox_id: Number(inbox!.id), contact_id: Number(id), source_id: link.source_id, status: 'open' })
    const conversationId = numericId(created.id)
    if (!conversationId) throw new FollowupError('CONVERSATION_INVALID')
    return conversationId
  }
  async function verifyConversation(id: string, phone: string) {
    if (!numericId(id)) throw new FollowupError('CONVERSATION_INVALID')
    const c = await call(`/conversations/${id}`)
    const contact = obj(obj(c.meta).sender)
    if (String(c.inbox_id) !== inbox!.id || normalizePhone(String(contact.phone_number ?? '')) !== phone) throw new FollowupError('CONTACT_CHANGED')
    if (contact.blocked === true) throw new FollowupError('OPTED_OUT')
  }
  return {
    identity: `${context.accountId}:${inbox.id}:${channel.normalizedPhoneE164}`,
    conversation, verifyConversation,
    messages: async (id: string, before?: string) => arr((await call(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`)).payload),
    send: async (id: string, content: string, jobId: string, phone?: string) => {
      if (automated && whatsappClient) {
        if (!phone || !normalizePhone(phone)) throw new FollowupError('PHONE_REQUIRED')
        const receipt = await whatsappClient.sendText({ agentId, phone, text: content })
        return { id: null, sourceId: receipt.providerMessageId, status: receipt.status }
      }
      const message = await call(`/conversations/${encodeURIComponent(id)}/messages`, {
        content, message_type: 'outgoing', private: false, content_type: 'text', content_attributes: { kbot_followup_id: jobId },
      })
      return { id: numericId(message.id), sourceId: typeof message.source_id === 'string' ? message.source_id : null, status: null }
    },
    providerStatus: async (phone: string, providerMessageId: string) => {
      if (!whatsappClient) return null
      if (await whatsappClient.connectionState({ agentId }) !== 'open') throw new FollowupError('WHATSAPP_DISCONNECTED')
      const identity = await whatsappClient.connectionIdentity({ agentId })
      if (!identity || identity.normalizedPhoneE164 !== channel.normalizedPhoneE164) throw new FollowupError('SENDER_CHANGED')
      return whatsappClient.messageStatus({ agentId, phone, providerMessageId })
    },
  }
}

export function providerOutcome(message: Obj): 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null {
  const status = String(message.status).toUpperCase()
  if (status === 'FAILED') return 'FAILED'
  if (!message.source_id) return null
  return ['SENT', 'DELIVERED', 'READ'].includes(status) ? status as 'SENT' | 'DELIVERED' | 'READ' : null
}

export function requestedOptOut(messages: Obj[]) {
  return messages.some(m => (m.message_type === 0 || m.message_type === 'incoming') &&
    /^(stop|unsubscribe|pare|parar|sair|não (?:me )?(?:mande|envie)(?: mais)? mensagens)[.!\s]*$/i.test(String(m.content ?? '').trim()))
}

export function hasRecentOutgoing(messages: Obj[], now = Date.now()) {
  return messages.some(m => !m.private && (m.message_type === 1 || m.message_type === 'outgoing') &&
    String(m.status).toLowerCase() !== 'failed' && Number(m.created_at) * 1000 > now - 7 * 86_400_000)
}
