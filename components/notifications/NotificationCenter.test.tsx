// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ push: vi.fn(), pathname: '/agent' }))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}))

import { NotificationCenter } from './NotificationCenter'

const unreadNotification = {
  id: 'notification-1',
  type: 'FOLLOW_UP_DUE',
  title: 'Follow-up de hoje',
  message: 'Faça hoje o follow-up com Ana Ribeiro.',
  href: '/agent/cases/case-1',
  caseId: 'case-1',
  followUpId: 'follow-up-1',
  readAt: null,
  createdAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NotificationCenter', () => {
  it('shows unread count and opens a responsive notification dialog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ notifications: [unreadNotification], unreadCount: 1 }),
    })))

    render(<NotificationCenter />)
    const trigger = await screen.findByRole('button', { name: 'Notificações, 1 não lidas' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'Notificações' })).toBeInTheDocument()
    expect(
      screen.getByRole('dialog', { name: 'Notificações' }).parentElement?.parentElement,
    ).toBe(document.body)
    expect(screen.getByText('Faça hoje o follow-up com Ana Ribeiro.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fechar' })).not.toHaveClass('md:hidden')
  })

  it('moves focus into the dialog and restores it after Escape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ notifications: [unreadNotification], unreadCount: 1 }),
    })))

    render(<NotificationCenter />)
    const trigger = await screen.findByRole('button', { name: 'Notificações, 1 não lidas' })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Marcar todas como lidas' })).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('marks one unread notification before navigating to its owned lead route', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/notification-1')) {
        calls.push(`mark:${init?.method}`)
        return { ok: true, json: async () => ({ readAt: new Date().toISOString() }) }
      }
      return { ok: true, json: async () => ({ notifications: [unreadNotification], unreadCount: 1 }) }
    }))
    mocks.push.mockImplementation((href: string) => calls.push(`push:${href}`))

    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações, 1 não lidas' }))
    await userEvent.click(screen.getByRole('button', { name: /Follow-up de hoje/i }))

    await waitFor(() => expect(calls).toEqual([
      'mark:PATCH',
      'push:/agent/cases/case-1',
    ]))
  })

  it('opens the lead even when marking it as read fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/notification-1')) return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({ notifications: [unreadNotification], unreadCount: 1 }) }
    }))

    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações, 1 não lidas' }))
    await userEvent.click(screen.getByRole('button', { name: /Follow-up de hoje/i }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/agent/cases/case-1'))
  })

  it('marks the complete inbox without navigating', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('read-all')) {
        return { ok: true, json: async () => ({ updatedCount: 1 }) }
      }
      return { ok: true, json: async () => ({ notifications: [unreadNotification], unreadCount: 1 }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<NotificationCenter />)
    await userEvent.click(await screen.findByRole('button', { name: 'Notificações, 1 não lidas' }))
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))

    await waitFor(() => expect(screen.getByText('Você está em dia.')).toBeInTheDocument())
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
