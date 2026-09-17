// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectWhatsapp } from './ConnectWhatsapp'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      return Response.json({ state: 'close', status: 'DISCONNECTED' })
    }
    return Response.json({
      state: 'open',
      status: 'CONNECTED',
      phone: '+15617260051',
      recorded: true,
    })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConnectWhatsapp', () => {
  it('offers a retry instead of remaining stuck when status lookup is unavailable', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'))

    render(<ConnectWhatsapp />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/não consegui validar a conexão/i)
    expect(screen.getByRole('button', { name: 'Verificar novamente' })).toBeInTheDocument()
  })

  it('shows the live connected number instead of offering a second QR code', async () => {
    render(<ConnectWhatsapp />)

    expect(await screen.findByRole('heading', { name: 'WhatsApp conectado' })).toBeInTheDocument()
    expect(screen.getByText('+1 561 726 0051')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desconectar WhatsApp' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gerar código para conectar' })).not.toBeInTheDocument()
  })

  it('reports a connection only after the API confirms its durable record', async () => {
    const onConnectionChange = vi.fn()

    render(<ConnectWhatsapp onConnectionChange={onConnectionChange} />)

    await screen.findByRole('heading', { name: 'WhatsApp conectado' })
    expect(onConnectionChange).toHaveBeenCalledWith(true)
  })

  it('does not report a provider-only session as connected', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      state: 'open',
      status: 'CONNECTED',
      phone: '+15617260051',
      recorded: false,
    }))
    const onConnectionChange = vi.fn()

    render(<ConnectWhatsapp onConnectionChange={onConnectionChange} />)

    expect(await screen.findByRole('heading', { name: 'Conectar meu WhatsApp' })).toBeInTheDocument()
    expect(onConnectionChange).toHaveBeenCalledWith(false)
    expect(onConnectionChange).not.toHaveBeenCalledWith(true)
  })

  it('requires confirmation, logs out, and returns to the reconnect flow', async () => {
    render(<ConnectWhatsapp />)
    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar WhatsApp' }))

    expect(screen.getByText(/novas mensagens deixam de chegar/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sim, desconectar' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/agent/messaging/whatsapp',
      { method: 'DELETE' },
    ))
    expect(await screen.findByRole('heading', { name: 'Conectar meu WhatsApp' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Gerar código para conectar' })).toBeInTheDocument()
  })
})
