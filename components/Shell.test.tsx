// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: '/agent',
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
vi.mock('@/lib/auth-client', () => ({
  authClient: { signOut: mocks.signOut },
}))

import { AgentPromotionProvider } from './AgentPromotionContext'
import { Shell } from './Shell'

const BLUE_JACKET = {
  tone: 'blue' as const,
  rankTitle: 'Agency Vice President',
  jacket: 'Blue Jacket',
}

const STANDARD_RANK = {
  tone: 'standard' as const,
  rankTitle: 'Regional Leader',
  jacket: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.pathname = '/agent'
  window.sessionStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
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

describe('Shell achievement band', () => {
  it('shows a jacket achievement without hiding the current module', () => {
    mocks.pathname = '/agent/policies'

    render(
      <AgentPromotionProvider initialIdentity={BLUE_JACKET}>
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    const band = screen.getByLabelText('Conquista atual: Blue Jacket')
    expect(band).toHaveAttribute('data-achievement-tone', 'blue')
    expect(screen.getByText('Agency Vice President')).toBeInTheDocument()
    expect(screen.getAllByText('Apólices')).not.toHaveLength(0)
    expect(screen.getByText('Operação conectada')).toBeInTheDocument()
  })

  it('keeps pre-jacket ranks in the neutral shell', () => {
    const { container } = render(
      <AgentPromotionProvider initialIdentity={STANDARD_RANK}>
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    expect(container.querySelector('[data-achievement-tone]')).toBeNull()
    expect(screen.queryByText('Regional Leader')).not.toBeInTheDocument()
    expect(screen.getAllByText('Hoje')).not.toHaveLength(0)
  })

  it('persists a local preview achievement after the Journey shell unmounts', async () => {
    const { rerender } = render(
      <AgentPromotionProvider initialIdentity={STANDARD_RANK}>
        <Shell
          role="AGENT"
          userName="Ana"
          promotionIdentity={BLUE_JACKET}
        >
          <p>Jornada</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    await waitFor(() =>
      expect(
        screen.getByLabelText('Conquista atual: Blue Jacket'),
      ).toBeInTheDocument(),
    )

    mocks.pathname = '/agent/commissions'
    rerender(
      <AgentPromotionProvider initialIdentity={STANDARD_RANK}>
        <Shell role="AGENT" userName="Ana">
          <p>Comissões</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    expect(screen.getByLabelText('Conquista atual: Blue Jacket')).toHaveAttribute(
      'data-achievement-tone',
      'blue',
    )
    expect(screen.getByText('Extrato de comissões')).toBeInTheDocument()
  })

  it('does not apply an agent achievement to non-agent shells', () => {
    mocks.pathname = '/admin'

    render(
      <AgentPromotionProvider initialIdentity={BLUE_JACKET}>
        <Shell role="ADMIN" userName="Admin">
          <p>Conteúdo</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    expect(screen.queryByLabelText('Conquista atual: Blue Jacket')).toBeNull()
    expect(screen.getByText('Painel administrativo')).toBeInTheDocument()
  })
})
