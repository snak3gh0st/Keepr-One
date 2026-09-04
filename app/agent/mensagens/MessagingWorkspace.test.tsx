// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessagingWorkspace } from './MessagingWorkspace'

let whatsappConnected = true

beforeEach(() => {
  whatsappConnected = true
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/agent/messaging/whatsapp') {
      if (init?.method === 'DELETE') {
        whatsappConnected = false
        return Response.json({ state: 'close', status: 'DISCONNECTED' })
      }
      if (init?.method === 'POST') {
        whatsappConnected = true
        return Response.json({ state: 'open', status: 'CONNECTED', phone: '+14075550123' })
      }
      return Response.json(whatsappConnected
        ? { state: 'open', status: 'CONNECTED', phone: '+14075550123' }
        : { state: 'close', status: 'DISCONNECTED', phone: null })
    }
    if (url.endsWith('/read')) return new Response(null, { status: 204 })
    if (url.includes('/messages') && init?.method === 'POST') {
      return Response.json({ message: { id: 'm2', content: 'Resposta', direction: 'OUTGOING', status: 'SENT', createdAt: 102, private: false, senderName: null, attachments: [] } }, { status: 201 })
    }
    if (url.includes('/messages')) {
      return Response.json({ messages: [{ id: 'm1', content: 'Olá', direction: 'INCOMING', status: 'SENT', createdAt: 100, private: false, senderName: 'Ana', attachments: [] }] })
    }
    return Response.json(whatsappConnected ? {
      inboxes: [{ id: '2', name: 'WhatsApp', kind: 'WHATSAPP', channelType: 'Channel::Api', address: null, provider: null }],
      conversations: [{
        id: '128', inboxId: '2', status: 'OPEN', unreadCount: 1, lastActivityAt: 100,
        contact: { id: '9', name: 'Ana Ribeiro', email: null, phone: '+14075550123', avatarUrl: null },
        lastMessage: { id: 'm1', content: 'Olá', direction: 'INCOMING', status: 'SENT', createdAt: 100, private: false, senderName: 'Ana', attachments: [] },
      }],
      total: 1,
    } : { inboxes: [], conversations: [], total: 0 })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MessagingWorkspace', () => {
  it('does not open a different customer when a follow-up conversation is unavailable', async () => {
    const originalFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === '/api/agent/messaging/conversations/999') return Response.json({ error: 'UNAVAILABLE' }, { status: 404 })
      return originalFetch(input, init)
    }))
    render(<MessagingWorkspace channelMode="EVOLUTION" initialConversationId="999" />)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('conversa'))
    expect(screen.queryByRole('textbox', { name: 'Mensagem' })).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith('/api/agent/messaging/conversations/128/messages', expect.anything())
  })
  it('renders the agent-owned conversation without Chatwoot assignment controls', async () => {
    render(<MessagingWorkspace channelMode="EVOLUTION" />)

    expect((await screen.findAllByText('Ana Ribeiro')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('Olá')).length).toBeGreaterThan(0)
    expect(screen.queryByText(/atribuir/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/equipe/i)).not.toBeInTheDocument()
  })

  it('replies inside Keepr without navigating to Chatwoot', async () => {
    render(<MessagingWorkspace channelMode="EVOLUTION" />)
    const composer = await screen.findByRole('textbox', { name: 'Mensagem' })
    await userEvent.type(composer, 'Resposta')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() => expect(screen.getByText('Resposta')).toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith(
      '/api/agent/messaging/conversations/128/messages',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('removes WhatsApp conversations from the workspace after disconnecting', async () => {
    render(<MessagingWorkspace channelMode="EVOLUTION" />)

    expect((await screen.findAllByText('Ana Ribeiro')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Olá')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Conectar canal' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar WhatsApp' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sim, desconectar' }))

    await waitFor(() => expect(screen.queryByText('Ana Ribeiro')).not.toBeInTheDocument())
    expect(screen.queryByText('Olá')).not.toBeInTheDocument()
    expect(screen.getByText('Nenhuma conversa aqui.')).toBeInTheDocument()
  })

  it('reloads WhatsApp conversations after the channel connects', async () => {
    whatsappConnected = false
    render(<MessagingWorkspace channelMode="EVOLUTION" />)

    expect(await screen.findByText('Nenhuma conversa aqui.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Conectar canal' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar código para conectar' }))

    expect((await screen.findAllByText('Ana Ribeiro')).length).toBeGreaterThan(0)
  })
})
