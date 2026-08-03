// @vitest-environment jsdom

import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CarrierSyncBadge } from './CarrierSyncBadge'

function answerWith(state: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ state }) })),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CarrierSyncBadge', () => {
  it('is quiet when the account is up to date', async () => {
    answerWith({ kind: 'IN_SYNC' })
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('Em dia')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('counts what is on its way, without offering an action', async () => {
    answerWith({ kind: 'WORKING', count: 2 })
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('2 a caminho')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  // The only clickable state, because it is the only one that asks anything.
  it('offers the action only when something waits on the agent', async () => {
    answerWith({ kind: 'NEEDS_YOU', count: 1 })
    render(<CarrierSyncBadge />)
    expect(await screen.findByRole('button', { name: 'Precisa de você' })).toBeTruthy()
  })

  // A badge that cannot read its state renders nothing rather than guessing.
  it('renders nothing when the state is unknown', async () => {
    answerWith(null)
    const { container } = render(<CarrierSyncBadge />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
