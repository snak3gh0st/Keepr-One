// @vitest-environment jsdom

import { render, screen, waitFor, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  pathname: '/agent',
  sendConnectorMessage: vi.fn(),
  copy: (_pt: string, en: string, values: Record<string, string | number> = {}) =>
    en.replace(/\{(\w+)\}/g, (_match, token: string) => String(values[token] ?? `{${token}}`)),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
}))

vi.mock('@/components/i18n/LanguageProvider', () => ({
  useI18n: () => ({
    language: 'EN',
    locale: 'en-US',
    copy: mocks.copy,
  }),
}))

vi.mock('@/app/agent/integrations/national-life/NationalLifeConnectorClient', () => ({
  sendConnectorMessage: mocks.sendConnectorMessage,
}))

import { CarrierSyncBadge } from './CarrierSyncBadge'

function answerWith(state: unknown) {
  const json = vi.fn(async () => ({ state }))
  const fetchMock = vi.fn(async () => ({ ok: true, json }))
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, json }
}

function answerWithSync() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      state: { kind: 'IN_SYNC' },
      sync: { runId: 'run-1', completed: 3, total: 9, shouldPoll: true },
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = '/agent'
  window.history.replaceState({}, '', '/agent')
  mocks.sendConnectorMessage.mockResolvedValue({
    ok: true,
    device: { status: 'READY', deviceId: 'device-1' },
    sync: { status: 'IDLE' },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('CarrierSyncBadge', () => {
  it('welcomes a completed onboarding and removes only its query flag without reloading', async () => {
    answerWith(null)
    window.history.replaceState(
      { source: 'onboarding' },
      '',
      '/agent?onboarding=completed&preview=black-jacket#today',
    )
    const historyState = window.history.state
    const replaceState = vi.spyOn(window.history, 'replaceState')

    render(<CarrierSyncBadge welcome />)

    expect(
      await screen.findByRole('status', { name: 'K-Bot update' }),
    ).toHaveTextContent('All set. It is great to have you here.')
    expect(screen.getByLabelText('K-Bot status')).toBeVisible()
    await waitFor(() => {
      expect(window.location.pathname).toBe('/agent')
      expect(window.location.search).toBe('?preview=black-jacket')
      expect(window.location.hash).toBe('#today')
    })
    expect(replaceState).toHaveBeenCalledWith(
      historyState,
      '',
      '/agent?preview=black-jacket#today',
    )
  })

  it('shows the active National Life sync progress in the compact badge', async () => {
    const fetchMock = answerWithSync()
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('Updating 3/9')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps an active connected sync above a stale carrier-login warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'NEEDS_YOU', count: 1 },
        sync: { runId: 'run-1', state: 'RUNNING', completed: 2, total: 6, shouldPoll: true },
      }),
    })))

    render(<CarrierSyncBadge />)

    expect(await screen.findByText('Updating 2/6')).toBeTruthy()
    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveAttribute('data-state', 'working')
    expect(presence).toHaveTextContent('I am updating your National Life data')
    expect(presence).not.toHaveTextContent('needs your login')
  })

  it('asks for login only when the current sync is actually paused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'NEEDS_YOU', count: 1 },
        sync: { runId: 'run-1', state: 'PAUSED', completed: 2, total: 6, shouldPoll: true },
      }),
    })))

    render(<CarrierSyncBadge />)

    await screen.findByLabelText('K-Bot status')
    await waitFor(() => {
      const presence = screen.getByLabelText('K-Bot status')
      expect(presence).toHaveAttribute('data-state', 'waiting')
      expect(presence).toHaveTextContent('I need you to sign in to National Life')
    })
  })

  it('shows sync and illustration as concurrent activities instead of hiding one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'IN_SYNC' },
        sync: { runId: 'run-1', completed: 3, total: 9, shouldPoll: true },
        illustration: { id: 'ill-1', state: 'WORKING', updatedAt: '2026-08-27T15:00:00.000Z' },
      }),
    })))

    render(<CarrierSyncBadge />)

    expect(await screen.findByRole('link', { name: 'National Life: sync 3 of 9; illustration in progress' })).toBeTruthy()

    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveTextContent('I am updating your data and preparing your illustration')
    expect(presence.querySelector('[data-activity="combined"]')).toBeInTheDocument()
  })

  it('keeps Application visible as an independent third activity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'IN_SYNC' },
        sync: { runId: 'run-1', completed: 3, total: 9, shouldPoll: true },
        illustration: { id: 'ill-1', state: 'WORKING', updatedAt: '2026-08-27T15:00:00.000Z' },
        application: { id: 'app-1', caseId: 'case-1', state: 'WORKING', updatedAt: '2026-08-27T15:01:00.000Z' },
      }),
    })))

    render(<CarrierSyncBadge />)
    await screen.findByLabelText('K-Bot status')
    expect(screen.getByLabelText('K-Bot status')).toHaveTextContent('I am handling more than one task for you')
    await userEvent.click(screen.getByRole('button', { name: 'View K-Bot activity' }))
    expect(screen.getByText('Updating your data')).toBeInTheDocument()
    expect(screen.getByText('Preparing your illustration')).toBeInTheDocument()
    expect(screen.getByText('Preparing your Application')).toBeInTheDocument()
  })

  it('keeps the sync moving while clearly asking for the illustration login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'IN_SYNC' },
        sync: { runId: 'run-1', state: 'RUNNING', completed: 4, total: 9, shouldPoll: true },
        illustration: { id: 'ill-1', state: 'NEEDS_YOU', updatedAt: '2026-08-27T15:00:00.000Z' },
      }),
    })))

    render(<CarrierSyncBadge />)

    expect(await screen.findByRole('link', { name: 'National Life: sync 4 of 9; illustration needs login' })).toBeTruthy()
    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveAttribute('data-state', 'waiting')
    expect(presence).toHaveTextContent('Your sync is still running. The illustration needs your login.')
    expect(screen.getByLabelText('Illustration waiting for login')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'View K-Bot activity' }))
    expect(screen.getByText('Updating your data')).toBeInTheDocument()
    expect(screen.getByText('I need your login')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue illustration' })).toHaveAttribute(
      'href',
      '/agent/illustrations/ill-1',
    )
  })

  it('announces the official PDF only when a working illustration becomes ready', async () => {
    vi.useFakeTimers()
    const responses = [
      {
        state: { kind: 'IN_SYNC' },
        illustration: { id: 'ill-1', state: 'WORKING', updatedAt: '2026-08-27T15:00:00.000Z' },
      },
      {
        state: { kind: 'IN_SYNC' },
        illustration: { id: 'ill-1', state: 'READY', updatedAt: '2026-08-27T15:02:00.000Z' },
      },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => responses.shift() ?? responses[responses.length - 1],
    })))

    render(<CarrierSyncBadge />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText('Preparing illustration')).toBeTruthy()
    await act(async () => vi.advanceTimersByTimeAsync(1_600))

    expect(screen.getByRole('status', { name: 'K-Bot update' })).toHaveTextContent('Your official illustration is ready')
    expect(screen.getByRole('link', { name: 'View illustration' })).toHaveAttribute('href', '/agent/illustrations/ill-1')
  })

  it('keeps K-Bot available when the account is up to date', async () => {
    answerWith({ kind: 'IN_SYNC' })
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('Up to date')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View K-Bot activity' })).toBeTruthy()
  })

  it('starts Application selection from official Illustrations, not unrelated cases', async () => {
    answerWith({ kind: 'IN_SYNC' })
    render(<CarrierSyncBadge />)
    await screen.findByText('Up to date')

    await userEvent.click(screen.getByRole('button', { name: 'View K-Bot activity' }))

    expect(screen.getByRole('link', { name: /Create Application in iGO/i })).toHaveAttribute(
      'href',
      '/agent/illustrations?intent=application',
    )
  })

  it('keeps K-Bot visible and sad on every page when this browser is disconnected', async () => {
    mocks.sendConnectorMessage.mockResolvedValue({
      ok: true,
      device: { status: 'UNPAIRED' },
      sync: { status: 'IDLE' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'IN_SYNC' },
        connector: { enabled: true, extensionTarget: 'abcdefghijklmnopabcdefghijklmnop' },
      }),
    })))

    render(<CarrierSyncBadge />)

    await screen.findByLabelText('K-Bot status')
    await waitFor(() =>
      expect(screen.getByLabelText('K-Bot status')).toHaveAttribute('data-state', 'error'),
    )
    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveTextContent('K-Bot is disconnected')
    expect(presence.querySelector('[data-kbot-character="true"]')).toHaveAttribute(
      'data-expression',
      'sad',
    )
  })

  it('explains that protected sign-in remains ready when this computer must be reconnected', async () => {
    mocks.sendConnectorMessage.mockResolvedValue({
      ok: true,
      device: { status: 'UNPAIRED' },
      sync: { status: 'IDLE' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: { kind: 'IN_SYNC' },
        connector: {
          enabled: true,
          extensionTarget: 'abcdefghijklmnopabcdefghijklmnop',
          autoLoginEnabled: true,
        },
      }),
    })))

    render(<CarrierSyncBadge />)

    await screen.findByLabelText('K-Bot status')
    await waitFor(() => expect(screen.getByLabelText('K-Bot status')).toHaveAttribute('data-state', 'waiting'))
    const presence = screen.getByLabelText('K-Bot status')
    expect(presence).toHaveTextContent('K-Bot needs this computer reconnected')
    expect(presence).toHaveTextContent('Your protected National Life sign-in is ready')
    await userEvent.click(screen.getByRole('button', { name: 'View K-Bot activity' }))
    expect(screen.getByRole('link', { name: 'Reconnect K-Bot' })).toHaveAttribute(
      'href',
      '/agent/integrations/national-life',
    )
  })

  it('counts what is on its way, without offering an action', async () => {
    answerWith({ kind: 'WORKING', count: 2 })
    render(<CarrierSyncBadge />)
    expect(await screen.findByText('2 on the way')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Needs you' })).toBeNull()
  })

  // The only clickable state, because it is the only one that asks anything.
  it('offers the action only when something waits on the agent', async () => {
    answerWith({ kind: 'NEEDS_YOU', count: 1 })
    render(<CarrierSyncBadge />)
    expect(await screen.findByRole('button', { name: 'Needs you' })).toBeTruthy()
  })

  // A badge that cannot read its carrier state does not guess a sync result,
  // but K-Bot itself remains available throughout the agent workspace.
  //
  // Checking emptiness alone proves nothing: useState(null) already renders
  // nothing on the very first synchronous pass, before fetch has even
  // resolved — a `waitFor` that only polls textContent would pass even if
  // fetch, `.then` and `.catch` were deleted outright. So this asserts the
  // request was actually issued, then waits for the mocked `json()` to have
  // been called — which only happens once the fetch → json chain really ran —
  // before checking the DOM again, so a component that wrongly rendered
  // something on a null state would still be caught after settling.
  it('keeps the idle K-Bot visible when the carrier state is unknown', async () => {
    const { fetchMock, json } = answerWith(null)
    const { container } = render(<CarrierSyncBadge />)

    expect(fetchMock).toHaveBeenCalledWith('/api/agent/carrier-sync')

    await waitFor(() => {
      expect(json).toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'View K-Bot activity' })).toBeTruthy()
      expect(container).not.toHaveTextContent('Up to date')
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
    expect(await screen.findByRole('button', { name: 'Needs you' })).toBeTruthy()
    expect(first.fetchMock).toHaveBeenCalledTimes(1)

    // Sitting still on the same route must not fire a second request.
    rerender(<CarrierSyncBadge />)
    await Promise.resolve()
    expect(first.fetchMock).toHaveBeenCalledTimes(1)

    const second = answerWith({ kind: 'IN_SYNC' })
    mocks.pathname = '/agent/integrations/national-life'
    rerender(<CarrierSyncBadge />)

    expect(await screen.findByText('Up to date')).toBeTruthy()
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
    expect(await screen.findByText('Up to date')).toBeTruthy()

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

    expect(screen.getByText('Up to date')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Needs you' })).toBeNull()
  })
})
