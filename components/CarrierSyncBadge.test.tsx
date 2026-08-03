// @vitest-environment jsdom

import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CarrierSyncBadge } from './CarrierSyncBadge'

function answerWith(state: unknown) {
  const json = vi.fn(async () => ({ state }))
  const fetchMock = vi.fn(async () => ({ ok: true, json }))
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, json }
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
  //
  // Checking emptiness alone proves nothing: useState(null) already renders
  // nothing on the very first synchronous pass, before fetch has even
  // resolved — a `waitFor` that only polls textContent would pass even if
  // fetch, `.then` and `.catch` were deleted outright. So this asserts the
  // request was actually issued, then waits for the mocked `json()` to have
  // been called — which only happens once the fetch → json chain really ran —
  // before checking the DOM again, so a component that wrongly rendered
  // something on a null state would still be caught after settling.
  it('renders nothing when the state is unknown', async () => {
    const { fetchMock, json } = answerWith(null)
    const { container } = render(<CarrierSyncBadge />)

    expect(fetchMock).toHaveBeenCalledWith('/api/agent/carrier-sync')

    await waitFor(() => {
      expect(json).toHaveBeenCalled()
      expect(container.textContent).toBe('')
    })
  })
})
