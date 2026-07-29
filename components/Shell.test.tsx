// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/agent',
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
vi.mock('@/lib/auth-client', () => ({
  authClient: { signOut: mocks.signOut },
}))

import { Shell } from './Shell'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signOut.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('Shell sign-out ordering', () => {
  it.each(['Sair', 'Sair da conta'])(
    'announces active-attempt cancellation before %s ends the Keepr One session',
    async (label) => {
      const order: string[] = []
      window.addEventListener(
        'keepr-one:sign-out',
        () => order.push('cancel-event'),
        { once: true },
      )
      mocks.signOut.mockImplementation(async () => {
        order.push('sign-out')
      })

      render(
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>,
      )
      await userEvent.click(screen.getByRole('button', { name: label }))

      await waitFor(() => expect(order).toEqual(['cancel-event', 'sign-out']))
    },
  )
})
