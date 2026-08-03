// @vitest-environment jsdom

import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ pathname: '/agent' }))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))

import { CarrierSyncBadge } from './CarrierSyncBadge'

function answerWith(state: unknown) {
  const json = vi.fn(async () => ({ state }))
  const fetchMock = vi.fn(async () => ({ ok: true, json }))
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, json }
}

beforeEach(() => {
  mocks.pathname = '/agent'
})

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

  // The badge exists to be provoked by exactly this flow: click "Precisa de
  // você", connect on the integration screen, then navigate away. `Shell`
  // never unmounts across that client-side navigation, so a mount-only fetch
  // would keep reading the pre-connection answer forever. Route change is the
  // only thing that should trigger a second request — this is deliberately
  // not a timer, matching the plan's "sem polling contínuo".
  it('refetches when the route changes, not on a timer', async () => {
    const first = answerWith({ kind: 'NEEDS_YOU', count: 1 })
    const { rerender } = render(<CarrierSyncBadge />)
    expect(await screen.findByRole('button', { name: 'Precisa de você' })).toBeTruthy()
    expect(first.fetchMock).toHaveBeenCalledTimes(1)

    // Sitting still on the same route must not fire a second request.
    rerender(<CarrierSyncBadge />)
    await Promise.resolve()
    expect(first.fetchMock).toHaveBeenCalledTimes(1)

    const second = answerWith({ kind: 'IN_SYNC' })
    mocks.pathname = '/agent/integrations/national-life'
    rerender(<CarrierSyncBadge />)

    expect(await screen.findByText('Em dia')).toBeTruthy()
    expect(second.fetchMock).toHaveBeenCalledTimes(1)
  })

  // The `alive` flag has to keep working once fetches can fire more than
  // once: a slow answer for a route the agent already left must not land
  // after a fast answer for the route they are on now. Without per-effect
  // cleanup this is exactly how the badge could flicker back to a stale
  // state a moment after showing the right one.
  it('does not let a stale route answer overwrite the current one', async () => {
    const resolvers: Array<(body: { state: unknown }) => void> = []
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: () =>
        new Promise<{ state: unknown }>((resolve) => {
          resolvers.push(resolve)
        }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { rerender } = render(<CarrierSyncBadge />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    mocks.pathname = '/agent/integrations/national-life'
    rerender(<CarrierSyncBadge />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    // The newer route's request answers first.
    resolvers[1]({ state: { kind: 'IN_SYNC' } })
    expect(await screen.findByText('Em dia')).toBeTruthy()

    // The stale request for the route the agent already left answers late.
    // Wrapped in `act` and awaited so a `setState` from the dangling `.then`
    // chain — if the `alive` guard did not stop it — is actually flushed and
    // visible below, rather than left pending in a microtask this test never
    // drains (which would make the assertion pass whether or not the guard
    // still works).
    await act(async () => {
      resolvers[0]({ state: { kind: 'NEEDS_YOU', count: 1 } })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Em dia')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
