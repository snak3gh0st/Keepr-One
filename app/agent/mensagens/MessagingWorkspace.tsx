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

type ChannelFilter = 'ALL' | MessagingChannelKind

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'C'
}

function timeLabel(timestamp: number) {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date)
}

function channelLabel(kind: MessagingChannelKind) {
  if (kind === 'WHATSAPP') return 'WhatsApp'
  if (kind === 'EMAIL') return 'E-mail'
  return 'Outro canal'
}

function ChannelMark({ kind }: { kind: MessagingChannelKind }) {
  return (
    <span className="messaging-channel-mark" data-kind={kind.toLowerCase()} aria-label={channelLabel(kind)}>
      {kind === 'WHATSAPP' ? 'W' : kind === 'EMAIL' ? '@' : '•'}
    </span>
  )
}

function DeliveryStatus({ status }: { status: MessagingMessage['status'] }) {
  if (!status) return null
  const labels = { SENT: 'Enviada', DELIVERED: 'Entregue', READ: 'Lida', FAILED: 'Falhou' }
  return <span className="messaging-delivery" data-status={status.toLowerCase()}>{labels[status]}</span>
}

export function MessagingWorkspace({
  channelMode,
}: {
  channelMode: 'EVOLUTION' | 'META_CLOUD'
}) {
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
      setError('Não consegui atualizar suas conversas agora.')
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
  }, [search])

  const loadMessages = useCallback(async (conversationId: string) => {
    await Promise.resolve()
    setLoadingMessages(true)
    const response = await fetch(`/api/agent/messaging/conversations/${conversationId}/messages`, { cache: 'no-store' })
    if (!response.ok) {
      setError('Não consegui abrir esta conversa.')
      setLoadingMessages(false)
      return
    }
    const body = await response.json() as { messages: MessagingMessage[] }
    setMessages(body.messages.filter((message) => !message.private && message.direction !== 'SYSTEM'))
    setLoadingMessages(false)
    setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, unreadCount: 0 } : item))
    void fetch(`/api/agent/messaging/conversations/${conversationId}/read`, { method: 'POST' })
  }, [])

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
    if (!selectedId || !content || sending) return
    setSending(true)
    const response = await fetch(`/api/agent/messaging/conversations/${selectedId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    const body = await response.json().catch(() => ({})) as { message?: MessagingMessage }
    if (!response.ok || !body.message) {
      setError('A mensagem não foi aceita pelo canal. Nada foi marcado como entregue.')
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
          <p>Central do agente</p>
          <h1>Mensagens</h1>
        </div>
        <div className="messaging-commandbar-meta">
          <span><b>{unread}</b> não lidas</span>
          <button type="button" onClick={() => setShowConnections((value) => !value)}>
            {showConnections ? 'Fechar conexões' : 'Conectar canal'}
          </button>
        </div>
      </header>

      {showConnections && (
        <div className="messaging-connections">
          <div className="messaging-connections-copy">
            <span>Conexões</span>
            <h2>Seus canais, uma única caixa.</h2>
            <p>A configuração acontece aqui. Depois de conectado, o Chatwoot permanece invisível.</p>
            <div className="messaging-connected-list">
              {inboxes.map((inbox) => (
                <span key={inbox.id}><ChannelMark kind={inbox.kind} /> {inbox.name}</span>
              ))}
            </div>
          </div>
          <div className="messaging-connection-action">
            {channelMode === 'META_CLOUD'
              ? <ConnectOfficialWhatsapp />
              : <ConnectWhatsapp />}
          </div>
        </div>
      )}

      {error && <div className="messaging-error" role="alert">{error}</div>}

      <div className="messaging-grid">
        <aside className="messaging-list" aria-label="Conversas">
          <form
            className="messaging-search"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(query.trim())
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar conversa" aria-label="Buscar conversa" />
          </form>

          <div className="messaging-channel-tabs" aria-label="Filtrar por canal">
            {(['ALL', 'WHATSAPP', 'EMAIL'] as const).map((kind) => (
              <button key={kind} type="button" data-active={channel === kind || undefined} onClick={() => setChannel(kind)}>
                {kind === 'ALL' ? 'Todas' : channelLabel(kind)}
              </button>
            ))}
          </div>

          <div className="messaging-conversation-scroll">
            {loading ? (
              <div className="messaging-loading">Atualizando conversas…</div>
            ) : filtered.length === 0 ? (
              <div className="messaging-empty-list">
                <strong>Nenhuma conversa aqui.</strong>
                <span>{inboxes.length ? 'Quando um cliente escrever, ela aparecerá nesta lista.' : 'Conecte seu primeiro canal sem sair do Keepr One.'}</span>
                {!inboxes.length && <button type="button" onClick={() => setShowConnections(true)}>Conectar agora</button>}
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
                    <span><strong>{conversation.contact.name}</strong><time>{timeLabel(conversation.lastActivityAt)}</time></span>
                    <span><small>{conversation.lastMessage?.direction === 'OUTGOING' ? 'Você: ' : ''}{conversation.lastMessage?.content || 'Anexo'}</small>{conversation.unreadCount > 0 && <b>{conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}</b>}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        <article className="messaging-thread" aria-label="Conversa aberta">
          {selected ? (
            <>
              <header className="messaging-thread-header">
              <button type="button" className="messaging-mobile-back" onClick={() => setSelectedId(null)} aria-label="Voltar para conversas">←</button>
                <span className="messaging-avatar">{initials(selected.contact.name)}</span>
                <div>
                  <h2>{selected.contact.name}</h2>
                  <p>{activeInbox ? channelLabel(activeInbox.kind) : 'Canal'} · {selected.contact.phone ?? selected.contact.email ?? activeInbox?.name}</p>
                </div>
                {activeInbox && <ChannelMark kind={activeInbox.kind} />}
              </header>

              <div className="messaging-message-scroll">
                {loadingMessages ? <div className="messaging-loading">Abrindo histórico…</div> : messages.map((message) => (
                  <div className="messaging-message-line" data-direction={message.direction.toLowerCase()} key={message.id}>
                    <div className="messaging-bubble">
                      {message.attachments.map((attachment) => attachment.thumbnailUrl || attachment.url ? (
                        <a href={attachment.url ?? attachment.thumbnailUrl ?? '#'} key={attachment.id} className="messaging-attachment">
                          {attachment.type.includes('image') && attachment.thumbnailUrl
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={attachment.thumbnailUrl} alt={attachment.fileName ?? 'Imagem anexada'} />
                            : <span>{attachment.fileName ?? 'Abrir anexo'}</span>}
                        </a>
                      ) : null)}
                      {message.content && <p>{message.content}</p>}
                      <footer><time>{timeLabel(message.createdAt)}</time>{message.direction === 'OUTGOING' && <DeliveryStatus status={message.status} />}</footer>
                    </div>
                  </div>
                ))}
                <div ref={messageEnd} />
              </div>

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
                  placeholder={activeInbox?.kind === 'EMAIL' ? 'Responder por e-mail…' : 'Escrever mensagem…'}
                  aria-label="Mensagem"
                  rows={1}
                />
                <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending}>
                  {sending ? 'Enviando…' : 'Enviar'}
                </button>
                <span>Shift + Enter para nova linha</span>
              </footer>
            </>
          ) : (
            <div className="messaging-thread-empty">
              <span aria-hidden>↗</span>
              <h2>Sua comunicação, sem intermediários.</h2>
              <p>Escolha uma conversa. WhatsApp e e-mail vivem no mesmo fluxo, sempre vinculados à sua conta.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}
