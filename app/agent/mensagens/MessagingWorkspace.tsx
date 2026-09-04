'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MessagingChannelKind,
  MessagingConversation,
  MessagingInbox,
  MessagingMessage,
} from '@/lib/messaging/chatwoot-account-client'
import { ConnectOfficialWhatsapp } from './ConnectOfficialWhatsapp'
import { ConnectWhatsapp } from './ConnectWhatsapp'
import { useI18n } from '@/components/i18n/LanguageProvider'

type ChannelFilter = 'ALL' | MessagingChannelKind

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C'
}

function timeLabel(timestamp: number, locale: string) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(date)
}

function channelLabel(kind: MessagingChannelKind, copy: (pt: string, en: string) => string) {
  if (kind === 'WHATSAPP') return 'WhatsApp'
  if (kind === 'EMAIL') return copy('E-mail', 'Email')
  return copy('Outro canal', 'Other channel')
}

function ChannelMark({ kind }: { kind: MessagingChannelKind }) {
  const { copy } = useI18n()
  return (
    <span className="messaging-channel-mark" data-kind={kind.toLowerCase()} aria-label={channelLabel(kind, copy)}>
      {kind === 'WHATSAPP' ? 'W' : kind === 'EMAIL' ? '@' : '•'}
    </span>
  )
}

function DeliveryStatus({ status }: { status: MessagingMessage['status'] }) {
  const { copy } = useI18n()
  if (!status) return null
  const labels = {
    SENT: copy('Enviada', 'Sent'),
    DELIVERED: copy('Entregue', 'Delivered'),
    READ: copy('Lida', 'Read'),
    FAILED: copy('Falhou', 'Failed'),
  }
  return <span className="messaging-delivery" data-status={status.toLowerCase()}>{labels[status]}</span>
}

export function MessagingWorkspace({
  channelMode,
  readOnly = false,
}: {
  channelMode: 'EVOLUTION' | 'META_CLOUD'
  readOnly?: boolean
}) {
  const { copy, locale } = useI18n()
  const [inboxes, setInboxes] = useState<MessagingInbox[]>([])
  const [conversations, setConversations] = useState<MessagingConversation[]>([])
  const [messages, setMessages] = useState<MessagingMessage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [channel, setChannel] = useState<ChannelFilter>('ALL')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showConnections, setShowConnections] = useState(false)
  const messageEnd = useRef<HTMLDivElement>(null)

  const inboxById = useMemo(() => new Map(inboxes.map((inbox) => [inbox.id, inbox])), [inboxes])
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null
  const filtered = conversations.filter((conversation) => {
    if (channel === 'ALL') return true
    return inboxById.get(conversation.inboxId)?.kind === channel
  })

  const loadConversations = useCallback(async (silent = false) => {
    await Promise.resolve()
    if (!silent) setLoading(true)
    const params = new URLSearchParams({ status: 'all' })
    if (search) params.set('q', search)
    const response = await fetch(`/api/agent/messaging/conversations?${params}`, { cache: 'no-store' })
    if (!response.ok) {
      setError(copy('Não consegui atualizar suas conversas agora.', 'I couldn’t refresh your conversations right now.'))
      setLoading(false)
      return
    }
    const body = await response.json() as {
      inboxes: MessagingInbox[]
      conversations: MessagingConversation[]
    }
    setInboxes(body.inboxes)
    setConversations(body.conversations)
    setSelectedId((current) => current && body.conversations.some((item) => item.id === current)
      ? current
      : window.matchMedia?.('(max-width: 840px)').matches
        ? null
        : body.conversations[0]?.id ?? null)
    setError(null)
    setLoading(false)
  }, [copy, search])

  const handleWhatsappConnectionChange = useCallback((connected: boolean) => {
    if (readOnly) return
    if (!connected) {
      const whatsappInboxIds = new Set(
        inboxes.filter((inbox) => inbox.kind === 'WHATSAPP').map((inbox) => inbox.id),
      )
      const selectedConversation = conversations.find((conversation) => conversation.id === selectedId)
      setInboxes((current) => current.filter((inbox) => !whatsappInboxIds.has(inbox.id)))
      setConversations((current) => current.filter((conversation) => !whatsappInboxIds.has(conversation.inboxId)))
      if (selectedConversation && whatsappInboxIds.has(selectedConversation.inboxId)) {
        setSelectedId(null)
        setMessages([])
      }
    }
    // A successful connection makes the provider inbox visible again and pulls
    // the current conversations immediately instead of waiting for the timer.
    void loadConversations(true)
  }, [conversations, inboxes, loadConversations, readOnly, selectedId])

  const loadMessages = useCallback(async (conversationId: string) => {
    await Promise.resolve()
    setLoadingMessages(true)
    const response = await fetch(`/api/agent/messaging/conversations/${conversationId}/messages`, { cache: 'no-store' })
    if (!response.ok) {
      setError(copy('Não consegui abrir esta conversa.', 'I couldn’t open this conversation.'))
      setLoadingMessages(false)
      return
    }
    const body = await response.json() as { messages: MessagingMessage[] }
    setMessages(body.messages.filter((message) => !message.private && message.direction !== 'SYSTEM'))
    setLoadingMessages(false)
    setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, unreadCount: 0 } : item))
    if (!readOnly) {
      void fetch(`/api/agent/messaging/conversations/${conversationId}/read`, { method: 'POST' })
    }
  }, [copy, readOnly])

  useEffect(() => {
    const initial = window.setTimeout(() => void loadConversations(), 0)
    const timer = window.setInterval(() => void loadConversations(true), 15_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [loadConversations])

  useEffect(() => {
    if (!selectedId) return
    const pending = window.setTimeout(() => void loadMessages(selectedId), 0)
    return () => window.clearTimeout(pending)
  }, [selectedId, loadMessages])

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  async function send() {
    const content = draft.trim()
    if (readOnly || !selectedId || !content || sending) return
    setSending(true)
    const response = await fetch(`/api/agent/messaging/conversations/${selectedId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const body = await response.json().catch(() => ({})) as { message?: MessagingMessage }
    if (!response.ok || !body.message) {
      setError(copy('A mensagem não foi aceita pelo canal. Nada foi marcado como entregue.', 'The channel did not accept the message. Nothing was marked as delivered.'))
      setSending(false)
      return
    }
    setMessages((current) => [...current, body.message!])
    setDraft('')
    setSending(false)
    setError(null)
    void loadConversations(true)
  }

  const activeInbox = selected ? inboxById.get(selected.inboxId) : null
  const unread = conversations.reduce((sum, item) => sum + item.unreadCount, 0)

  return (
    <section className="messaging-workspace" data-conversation-open={selected ? 'true' : 'false'}>
      <header className="messaging-commandbar">
        <div>
          <p>{copy('Central do agente', 'Agent hub')}</p>
          <h1>{copy('Mensagens', 'Messages')}</h1>
        </div>
        <div className="messaging-commandbar-meta">
          <span><b>{unread}</b> {copy('não lidas', 'unread')}</span>
          {!readOnly && (
            <button type="button" onClick={() => setShowConnections((value) => !value)}>
              {showConnections ? copy('Fechar conexões', 'Close connections') : copy('Conectar canal', 'Connect channel')}
            </button>
          )}
        </div>
      </header>

      {showConnections && !readOnly && (
        <div className="messaging-connections">
          <div className="messaging-connections-copy">
            <span>{copy('Conexões', 'Connections')}</span>
            <h2>{copy('Seus canais, uma única caixa.', 'Your channels, one inbox.')}</h2>
            <p>{copy('A configuração acontece aqui. Depois de conectado, o Chatwoot permanece invisível.', 'Setup happens here. Once connected, Chatwoot stays behind the scenes.')}</p>
            <div className="messaging-connected-list">
              {inboxes.map((inbox) => (
                <span key={inbox.id}><ChannelMark kind={inbox.kind} /> {inbox.name}</span>
              ))}
            </div>
          </div>
          <div className="messaging-connection-action">
            {channelMode === 'META_CLOUD'
              ? <ConnectOfficialWhatsapp />
              : <ConnectWhatsapp onConnectionChange={handleWhatsappConnectionChange} />}
          </div>
        </div>
      )}

      {error && <div className="messaging-error" role="alert">{error}</div>}

      <div className="messaging-grid">
        <aside className="messaging-list" aria-label={copy('Conversas', 'Conversations')}>
          <form
            className="messaging-search"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(query.trim())
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy('Buscar conversa', 'Search conversations')} aria-label={copy('Buscar conversa', 'Search conversations')} />
          </form>

          <div className="messaging-channel-tabs" aria-label={copy('Filtrar por canal', 'Filter by channel')}>
            {(['ALL', 'WHATSAPP', 'EMAIL'] as const).map((kind) => (
              <button key={kind} type="button" data-active={channel === kind || undefined} onClick={() => setChannel(kind)}>
                {kind === 'ALL' ? copy('Todas', 'All') : channelLabel(kind, copy)}
              </button>
            ))}
          </div>

          <div className="messaging-conversation-scroll">
            {loading ? (
              <div className="messaging-loading">{copy('Atualizando conversas…', 'Refreshing conversations…')}</div>
            ) : filtered.length === 0 ? (
              <div className="messaging-empty-list">
                <strong>{copy('Nenhuma conversa aqui.', 'No conversations here.')}</strong>
                <span>{inboxes.length ? copy('Quando um cliente escrever, ela aparecerá nesta lista.', 'When a client writes, the conversation will appear in this list.') : copy('Conecte seu primeiro canal sem sair do Keepr One.', 'Connect your first channel without leaving Keepr One.')}</span>
                {!inboxes.length && !readOnly && <button type="button" onClick={() => setShowConnections(true)}>{copy('Conectar agora', 'Connect now')}</button>}
              </div>
            ) : filtered.map((conversation) => {
              const inbox = inboxById.get(conversation.inboxId)
              return (
                <button
                  type="button"
                  key={conversation.id}
                  className="messaging-conversation-row"
                  data-active={conversation.id === selectedId || undefined}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <span className="messaging-avatar">
                    {conversation.contact.avatarUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={conversation.contact.avatarUrl} alt="" />
                      : initials(conversation.contact.name)}
                    {inbox && <ChannelMark kind={inbox.kind} />}
                  </span>
                  <span className="messaging-conversation-copy">
                    <span><strong>{conversation.contact.name}</strong><time>{timeLabel(conversation.lastActivityAt, locale)}</time></span>
                    <span><small>{conversation.lastMessage?.direction === 'OUTGOING' ? copy('Você: ', 'You: ') : ''}{conversation.lastMessage?.content || copy('Anexo', 'Attachment')}</small>{conversation.unreadCount > 0 && <b>{conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}</b>}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <article className="messaging-thread" aria-label={copy('Conversa aberta', 'Open conversation')}>
          {selected ? (
            <>
              <header className="messaging-thread-header">
              <button type="button" className="messaging-mobile-back" onClick={() => setSelectedId(null)} aria-label={copy('Voltar para conversas', 'Back to conversations')}>←</button>
                <span className="messaging-avatar">{initials(selected.contact.name)}</span>
                <div>
                  <h2>{selected.contact.name}</h2>
                  <p>{activeInbox ? channelLabel(activeInbox.kind, copy) : copy('Canal', 'Channel')} · {selected.contact.phone ?? selected.contact.email ?? activeInbox?.name}</p>
                </div>
                {activeInbox && <ChannelMark kind={activeInbox.kind} />}
              </header>

              <div className="messaging-message-scroll">
                {loadingMessages ? <div className="messaging-loading">{copy('Abrindo histórico…', 'Opening history…')}</div> : messages.map((message) => (
                  <div className="messaging-message-line" data-direction={message.direction.toLowerCase()} key={message.id}>
                    <div className="messaging-bubble">
                      {message.attachments.map((attachment) => attachment.thumbnailUrl || attachment.url ? (
                        <a href={attachment.url ?? attachment.thumbnailUrl ?? '#'} key={attachment.id} className="messaging-attachment">
                          {attachment.type.includes('image') && attachment.thumbnailUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={attachment.thumbnailUrl} alt={attachment.fileName ?? copy('Imagem anexada', 'Attached image')} />
                            : <span>{attachment.fileName ?? copy('Abrir anexo', 'Open attachment')}</span>}
                        </a>
                      ) : null)}
                      {message.content && <p>{message.content}</p>}
                      <footer><time>{timeLabel(message.createdAt, locale)}</time>{message.direction === 'OUTGOING' && <DeliveryStatus status={message.status} />}</footer>
                    </div>
                  </div>
                ))}
                <div ref={messageEnd} />
              </div>

              {readOnly ? (
                <p className="messaging-composer text-sm text-ink-muted" role="status">
                  {copy('Modo de suporte: visualização somente leitura.', 'Support mode: read-only view.')}
                </p>
              ) : (
                <footer className="messaging-composer">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void send()
                      }
                    }}
                    placeholder={activeInbox?.kind === 'EMAIL' ? copy('Responder por e-mail…', 'Reply by email…') : copy('Escrever mensagem…', 'Write a message…')}
                    aria-label={copy('Mensagem', 'Message')}
                    rows={1}
                  />
                  <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending}>
                    {sending ? copy('Enviando…', 'Sending…') : copy('Enviar', 'Send')}
                  </button>
                  <span>{copy('Shift + Enter para nova linha', 'Shift + Enter for a new line')}</span>
                </footer>
              )}
            </>
          ) : (
            <div className="messaging-thread-empty">
              <span aria-hidden>↗</span>
              <h2>{copy('Sua comunicação, sem intermediários.', 'Your communication, without intermediaries.')}</h2>
              <p>{copy('Escolha uma conversa. WhatsApp e e-mail vivem no mesmo fluxo, sempre vinculados à sua conta.', 'Choose a conversation. WhatsApp and email share the same flow and always stay linked to your account.')}</p>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
