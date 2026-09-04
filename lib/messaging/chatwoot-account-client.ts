import type { ChatwootHttp } from './chatwoot-client'

export type MessagingChannelKind = 'WHATSAPP' | 'EMAIL' | 'OTHER'

export type MessagingInbox = {
  id: string
  name: string
  kind: MessagingChannelKind
  channelType: string
  address: string | null
  provider: string | null
}

export type MessagingContact = {
  id: string | null
  name: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
}

export type MessagingAttachment = {
  id: string
  type: string
  url: string | null
  thumbnailUrl: string | null
  fileName: string | null
}

export type MessagingMessage = {
  id: string
  content: string
  direction: 'INCOMING' | 'OUTGOING' | 'SYSTEM'
  status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null
  createdAt: number
  private: boolean
  senderName: string | null
  attachments: MessagingAttachment[]
}

export type MessagingConversation = {
  id: string
  inboxId: string
  status: 'OPEN' | 'RESOLVED' | 'PENDING' | 'SNOOZED'
  unreadCount: number
  lastActivityAt: number
  contact: MessagingContact
  lastMessage: MessagingMessage | null
}

export type ChatwootAccountClient = {
  getConversation: (input: { accountId: string; token: string; conversationId: string }) => Promise<MessagingConversation>
  listInboxes: (input: { accountId: string; token: string }) => Promise<MessagingInbox[]>
  listConversations: (input: {
    accountId: string
    token: string
    status?: 'all' | 'open' | 'resolved' | 'pending' | 'snoozed'
    inboxId?: string
    query?: string
    page?: number
  }) => Promise<{ conversations: MessagingConversation[]; total: number }>
  listMessages: (input: {
    accountId: string
    token: string
    conversationId: string
    before?: string
  }) => Promise<MessagingMessage[]>
  sendMessage: (input: {
    accountId: string
    token: string
    conversationId: string
    content: string
  }) => Promise<MessagingMessage>
  markRead: (input: { accountId: string; token: string; conversationId: string }) => Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function messageText(value: unknown): string {
  const valueText = text(value) ?? ''
  return valueText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function inboxKind(inbox: Record<string, unknown>): MessagingChannelKind {
  const channel = text(inbox.channel_type)?.toLowerCase() ?? ''
  const provider = text(inbox.provider)?.toLowerCase() ?? ''
  const callback = text(inbox.callback_webhook_url)?.toLowerCase() ?? ''
  const name = text(inbox.name)?.toLowerCase() ?? ''
  const medium = text(inbox.medium)?.toLowerCase() ?? ''
  if (channel.includes('whatsapp') || provider.includes('whatsapp') || callback.includes('/chatwoot/webhook/') || name.includes('whatsapp')) return 'WHATSAPP'
  if (channel.includes('email') || medium === 'email') return 'EMAIL'
  return 'OTHER'
}

function parseInbox(value: unknown): MessagingInbox {
  const inbox = record(value)
  const kind = inboxKind(inbox)
  return {
    id: String(inbox.id ?? ''),
    name: text(inbox.name) ?? (kind === 'EMAIL' ? 'E-mail' : kind === 'WHATSAPP' ? 'WhatsApp' : 'Canal'),
    kind,
    channelType: text(inbox.channel_type) ?? '',
    address: kind === 'EMAIL'
      ? text(inbox.email_address) ?? text(inbox.forward_to_email)
      : text(inbox.phone_number),
    provider: text(inbox.provider),
  }
}

function parseAttachment(value: unknown): MessagingAttachment {
  const attachment = record(value)
  return {
    id: String(attachment.id ?? ''),
    type: text(attachment.file_type) ?? text(attachment.extension) ?? 'file',
    url: text(attachment.data_url),
    thumbnailUrl: text(attachment.thumb_url),
    fileName: text(attachment.fallback_title),
  }
}

function parseMessage(value: unknown): MessagingMessage {
  const message = record(value)
  const messageType = message.message_type
  const status = text(message.status)?.toUpperCase()
  const sender = record(message.sender)
  const attachmentValues = Array.isArray(message.attachments)
    ? message.attachments
    : Object.keys(record(message.attachment)).length
      ? [message.attachment]
      : []
  return {
    id: String(message.id ?? ''),
    content: messageText(message.processed_message_content ?? message.content),
    direction: messageType === 0 || messageType === 'incoming'
      ? 'INCOMING'
      : messageType === 1 || messageType === 3 || messageType === 'outgoing' || messageType === 'template'
        ? 'OUTGOING'
        : 'SYSTEM',
    status: status === 'SENT' || status === 'DELIVERED' || status === 'READ' || status === 'FAILED'
      ? status
      : null,
    createdAt: number(message.created_at),
    private: message.private === true,
    senderName: text(sender.name) ?? text(sender.available_name),
    attachments: attachmentValues.map(parseAttachment),
  }
}

function parseConversation(value: unknown): MessagingConversation {
  const conversation = record(value)
  const meta = record(conversation.meta)
  const sender = record(meta.sender)
  const messages = array(conversation.messages).map(parseMessage)
  const status = text(conversation.status)?.toUpperCase()
  return {
    id: String(conversation.id ?? conversation.display_id ?? ''),
    inboxId: String(conversation.inbox_id ?? ''),
    status: status === 'RESOLVED' || status === 'PENDING' || status === 'SNOOZED' ? status : 'OPEN',
    unreadCount: number(conversation.unread_count),
    lastActivityAt: number(conversation.last_activity_at ?? conversation.timestamp),
    contact: {
      id: sender.id === undefined ? null : String(sender.id),
      name: text(sender.name) ?? text(sender.available_name) ?? 'Contato sem nome',
      email: text(sender.email),
      phone: text(sender.phone_number),
      avatarUrl: text(sender.thumbnail) ?? text(sender.avatar_url),
    },
    lastMessage: messages.at(-1) ?? null,
  }
}

export function createChatwootAccountClient(config: {
  baseUrl: string
  http: ChatwootHttp
}): ChatwootAccountClient {
  const call = async (path: string, token: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await config.http(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        api_access_token: token,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) throw new Error(`CHATWOOT_ACCOUNT_REQUEST_FAILED:${response.status}`)
    return response.json()
  }

  return {
    getConversation: async ({ accountId, token, conversationId }) => parseConversation(await call(
      `/api/v1/accounts/${accountId}/conversations/${encodeURIComponent(conversationId)}`, token,
    )),
    listInboxes: async ({ accountId, token }) => {
      const body = record(await call(`/api/v1/accounts/${accountId}/inboxes`, token))
      return array(body.payload).map(parseInbox).filter((inbox) => inbox.id)
    },

    listConversations: async ({ accountId, token, status = 'all', inboxId, query, page = 1 }) => {
      const params = new URLSearchParams({ status, assignee_type: 'all', page: String(page) })
      if (inboxId) params.set('inbox_id', inboxId)
      if (query?.trim()) params.set('q', query.trim())
      const body = record(await call(`/api/v1/accounts/${accountId}/conversations?${params}`, token))
      const data = record(body.data)
      const meta = record(data.meta)
      return {
        conversations: array(data.payload).map(parseConversation).filter((conversation) => conversation.id),
        total: number(meta.all_count),
      }
    },

    listMessages: async ({ accountId, token, conversationId, before }) => {
      const params = before ? `?before=${encodeURIComponent(before)}` : ''
      const body = record(await call(
        `/api/v1/accounts/${accountId}/conversations/${encodeURIComponent(conversationId)}/messages${params}`,
        token,
      ))
      return array(body.payload)
        .map(parseMessage)
        .filter((message) => message.id)
        .sort((left, right) => left.createdAt - right.createdAt)
    },

    sendMessage: async ({ accountId, token, conversationId, content }) => parseMessage(await call(
      `/api/v1/accounts/${accountId}/conversations/${encodeURIComponent(conversationId)}/messages`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ content, message_type: 'outgoing', private: false, content_type: 'text' }),
      },
    )),

    markRead: async ({ accountId, token, conversationId }) => {
      await call(
        `/api/v1/accounts/${accountId}/conversations/${encodeURIComponent(conversationId)}/update_last_seen`,
        token,
        { method: 'POST', body: JSON.stringify({}) },
      )
    },
  }
}
