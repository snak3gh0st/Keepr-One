// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectOfficialWhatsapp } from './ConnectOfficialWhatsapp'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    status: 'CONNECTED',
    phone: '+15617260051',
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConnectOfficialWhatsapp', () => {
  it('notifies its parent only after the verified connection is persisted', async () => {
    const onConnectionChange = vi.fn()
    render(<ConnectOfficialWhatsapp onConnectionChange={onConnectionChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Já conectei, validar' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      '/api/agent/messaging/whatsapp-cloud',
      { method: 'POST' },
    ))
    expect(onConnectionChange).toHaveBeenCalledOnce()
    expect(onConnectionChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Já conectei, validar' })).toBeEnabled()
  })

  it('keeps the parent unchanged when verification fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(
      { error: 'WHATSAPP_INBOX_NOT_CONNECTED' },
      { status: 409 },
    ))
    const onConnectionChange = vi.fn()
    render(<ConnectOfficialWhatsapp onConnectionChange={onConnectionChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Já conectei, validar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/ainda não encontrei uma caixa WhatsApp Cloud/i)
    expect(onConnectionChange).not.toHaveBeenCalled()
  })
})
