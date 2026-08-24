// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessagingWorkspace } from './MessagingWorkspace'

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/read')) return new Response(null, { status: 204 })
    if (url.includes('/messages') && init?.method === 'POST') {
      return Response.json({ message: { id: 'm2', content: 'Resposta', direction: 'OUTGOING', status: 'SENT', createdAt: 102, private: false, senderName: null, attachments: [] } }, { status: 201 })
    }
    if (url.includes('/messages')) {
      return Response.json({ messages: [{ id: 'm1', content: 'Olá', direction: 'INCOMING', status: 'SENT', createdAt: 100, private: false, senderName: 'Ana', attachments: [] }] })
    }
    return Response.json({
      inboxes: [{ id: '2', name: 'WhatsApp', kind: 'WHATSAPP', channelType: 'Channel::Api', address: null, provider: null }],
      conversations: [{
        id: '128', inboxId: '2', status: 'OPEN', unreadCount: 1, lastActivityAt: 100,
        contact: { id: '9', name: 'Ana Ribeiro', email: null, phone: '+14075550123', avatarUrl: null },
        lastMessage: { id: 'm1', content: 'Olá', direction: 'INCOMING', status: 'SENT', createdAt: 100, private: false, senderName: 'Ana', attachments: [] },
      }],
      total: 1,
    })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MessagingWorkspace', () => {
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
})
