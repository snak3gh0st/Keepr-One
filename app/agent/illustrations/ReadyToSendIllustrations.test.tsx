// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  discard: vi.fn(),
}))

vi.mock('./ready-to-send-actions', () => ({
  sendReadyIllustration: mocks.send,
  discardReadyIllustration: mocks.discard,
}))

import { ReadyToSendIllustrations } from './ReadyToSendIllustrations'
import type { ReadyToSendIllustration } from './ready-to-send'

const item: ReadyToSendIllustration = {
  requestId: 'req-1',
  clientName: 'Ana Ribeiro',
  productName: 'FlexLife',
  faceAmount: 'US$ 250.000',
  premium: 'US$ 180', targetPremium: 'US$ 999',
  message: 'Ana, aqui está a simulação que você pediu.\nProduto: FlexLife',
  hasDocument: true,
  reachable: true,
  createdAt: '2026-03-10T17:00:00.000Z',
  expiresAt: '2026-03-13T17:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.send.mockResolvedValue({ ok: true })
  mocks.discard.mockResolvedValue({ ok: true })
})

afterEach(cleanup)

describe('the quotes waiting to be sent', () => {
  it('shows the carrier premium the client will be quoted, not the one requested', () => {
    // The message quotes `premium` and falls back to `targetPremium`. A screen
    // showing the other one would have the agent read US$ 999 and the client
    // receive US$ 180.
    render(<ReadyToSendIllustrations items={[item]} />)
    expect(screen.getByText('US$ 180')).toBeTruthy()
    expect(screen.queryByText('US$ 999')).toBeNull()
  })

  it('shows the figures and the text that goes with the PDF', () => {
    render(<ReadyToSendIllustrations items={[item]} />)
    expect(screen.getByText('Ana Ribeiro')).toBeTruthy()
    expect(screen.getByText('FlexLife')).toBeTruthy()
    expect(screen.getByText('US$ 250.000')).toBeTruthy()
    expect(screen.getByText(/aqui está a simulação/)).toBeTruthy()
  })

  it('renders nothing at all when there is nothing waiting and nothing to say', () => {
    const { container } = render(<ReadyToSendIllustrations items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('keeps the outcome readable after the row it belonged to leaves the list', async () => {
    // Every outcome closes the request, and the page re-reads the waiting list
    // straight afterwards — so the row is gone by the time the agent looks.
    const view = render(<ReadyToSendIllustrations items={[item]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mandar pro cliente' }))
    await screen.findByText(/enviado no WhatsApp do cliente/)
    view.rerender(<ReadyToSendIllustrations items={[]} />)
    expect(screen.queryByRole('button', { name: 'Mandar pro cliente' })).toBeNull()
    expect(screen.getByText(/enviado no WhatsApp do cliente/)).toBeTruthy()
    expect(screen.getByText('Ana Ribeiro:')).toBeTruthy()
  })

  it('does not call a discard a send', async () => {
    render(<ReadyToSendIllustrations items={[item]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sim, descartar' }))
    expect(await screen.findByText(/descartada. Nada foi enviado/)).toBeTruthy()
  })

  it('sends once even when the agent presses twice while it is in flight', async () => {
    let release = () => {}
    mocks.send.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ ok: true }) }))
    render(<ReadyToSendIllustrations items={[item]} />)
    const button = screen.getByRole('button', { name: 'Mandar pro cliente' })
    await userEvent.click(button)
    await screen.findByRole('button', { name: 'Mandando…' })
    // The second press lands on a disabled button, and the handler would refuse
    // it anyway: the send takes as long as a PDF takes to reach the provider.
    await userEvent.click(screen.getByRole('button', { name: 'Mandando…' }))
    release()
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
  })

  it('does not offer a send with no PDF behind it', () => {
    render(<ReadyToSendIllustrations items={[{ ...item, hasDocument: false }]} />)
    expect(screen.getByRole('button', { name: 'Mandar pro cliente' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/O PDF desta ilustração ainda não está no Keeprone/)).toBeTruthy()
  })

  it('does not offer a send to a client with no number', () => {
    render(<ReadyToSendIllustrations items={[{ ...item, reachable: false }]} />)
    expect(screen.getByRole('button', { name: 'Mandar pro cliente' }).hasAttribute('disabled')).toBe(true)
  })

  it('asks before discarding, because nothing brings the request back', async () => {
    render(<ReadyToSendIllustrations items={[item]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(mocks.discard).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sim, descartar' }))
    await waitFor(() => expect(mocks.discard).toHaveBeenCalledWith({ requestId: 'req-1' }))
  })

  it('repeats the refusal in the words the action wrote', async () => {
    mocks.send.mockResolvedValue({
      ok: false,
      reason: 'OPTED_OUT',
      message: 'O cliente pediu para não receber mensagens, então nada foi enviado.',
    })
    const view = render(<ReadyToSendIllustrations items={[item]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mandar pro cliente' }))
    await screen.findByText(/pediu para não receber mensagens/)
    // BLOCKED closes the request, so the row goes; the sentence must not.
    view.rerender(<ReadyToSendIllustrations items={[]} />)
    expect(screen.getByText(/pediu para não receber mensagens/)).toBeTruthy()
  })
})
