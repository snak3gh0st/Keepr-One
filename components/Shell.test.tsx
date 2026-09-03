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
import { AgentAccessProvider } from './AgentAccessContext'
import { Shell } from './Shell'

const BLUE_JACKET = {
  tone: 'blue' as const,
  rankTitle: 'Agency Vice President',
  jacket: 'Blue Jacket',
}

const BLACK_JACKET = {
  tone: 'black' as const,
  rankTitle: 'Executive Vice President',
  jacket: 'Black Jacket',
}

const STANDARD_RANK = {
  tone: 'standard' as const,
  rankTitle: 'Regional Leader',
  jacket: null,
}

const AGENCY_OWNER_ACCESS = {
  kind: 'AGENCY_OWNER' as const,
  agencyName: 'Agência Aurora',
  subscriptionStatus: 'ACTIVE',
  canManageTeam: true,
  canInviteAgents: true,
  canViewTeamSubscriptions: true,
  canViewAgencyNationalLife: true,
  enabledModules: null,
}

const FOUNDER_TRIAL_ACCESS = {
  ...AGENCY_OWNER_ACCESS,
  trial: {
    source: 'FOUNDER' as const,
    plan: 'AGENCY' as const,
    endsAt: '2032-01-31T00:00:00.000Z',
    initialRemainingSeconds: 30 * 24 * 60 * 60,
  },
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
  // Every AGENT-role render now mounts CarrierSyncBadge, which fetches on
  // mount. These tests are about the shell chrome, not the badge — which has
  // its own suite in CarrierSyncBadge.test.tsx — so the answer here is fixed
  // and quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ state: null }) })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Shell plan access', () => {
  it('keeps an individual agent in a personal workspace without team navigation', () => {
    render(
      <Shell role="AGENT" userName="Ana">
        <p>Conteúdo</p>
      </Shell>,
    )

    expect(screen.getByText('Operação individual')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Agência' })).toBeInTheDocument()
    expect(screen.getAllByText('Plano Agente')).not.toHaveLength(0)
    expect(screen.queryByRole('timer')).toBeNull()
  })

  it('shows the agency workspace and team navigation only to the agency owner', () => {
    render(
      <AgentAccessProvider access={AGENCY_OWNER_ACCESS}>
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    expect(screen.getByText('Agência Aurora')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Equipe' })).toBeInTheDocument()
    expect(screen.getAllByText('Plano Agência')).not.toHaveLength(0)
  })

  it('hides ungranted modules for a managed agent while keeping account settings', () => {
    render(
      <AgentAccessProvider
        access={{
          ...AGENCY_OWNER_ACCESS,
          enabledModules: ['TODAY', 'CRM', 'AGENCY'],
        }}
      >
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    expect(screen.getByRole('link', { name: 'Hoje' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CRM' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Agência' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Configurações' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Agenda' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Integrações' })).toBeNull()
  })

  it('requires both the TEAM grant and the existing owner capability', () => {
    const { rerender } = render(
      <AgentAccessProvider
        access={{
          ...AGENCY_OWNER_ACCESS,
          canManageTeam: false,
          enabledModules: ['TODAY', 'AGENCY', 'TEAM'],
        }}
      >
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull()

    rerender(
      <AgentAccessProvider
        access={{
          ...AGENCY_OWNER_ACCESS,
          enabledModules: ['TODAY', 'AGENCY', 'TEAM'],
        }}
      >
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    expect(screen.getByRole('link', { name: 'Equipe' })).toBeInTheDocument()
  })

  it('keeps agency and team in Gestão, then places integrations in Conta before settings', () => {
    render(
      <AgentAccessProvider access={AGENCY_OWNER_ACCESS}>
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' })
    const moduleList = navigation.querySelector('ul')
    expect(moduleList).not.toBeNull()
    const groupLabels = Array.from(
      moduleList!.querySelectorAll('li[role="presentation"] span'),
    ).map((element) => element.textContent)
    const navigationLabels = Array.from(
      moduleList!.querySelectorAll('a[aria-label]'),
    ).map((element) => element.getAttribute('aria-label'))

    expect(groupLabels).toEqual(['Operação', 'Carteira', 'Gestão', 'Conta'])
    expect(navigationLabels.slice(-4)).toEqual([
      'Agência',
      'Equipe',
      'Integrações',
      'Configurações',
    ])
  })

  it('places one language selector at the end of the lateral navigation, not in the top bar', () => {
    const { container } = render(
      <Shell role="AGENT" userName="Ana">
        <p>Conteúdo</p>
      </Shell>,
    )

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' })
    const moduleList = navigation.querySelector('ul')
    const navigationFooter = navigation.querySelector('[data-shell-nav-footer]')

    expect(navigationFooter).not.toBeNull()
    expect(moduleList?.nextElementSibling).toBe(navigationFooter)
    expect(navigationFooter?.querySelectorAll('[data-language-switcher]')).toHaveLength(1)
    expect(moduleList?.querySelector('[data-language-switcher]')).toBeNull()
    expect(container.querySelector('.shell-topbar [data-language-switcher]')).toBeNull()
  })

  it('uses Agência as the current module name on the agency route', () => {
    mocks.pathname = '/agent/agency'

    const { container } = render(
      <AgentAccessProvider access={AGENCY_OWNER_ACCESS}>
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    expect(container.querySelector('.shell-topbar-title')).toHaveTextContent('Agência')
  })

  it('names the Google scheduling settings route', () => {
    mocks.pathname = '/agent/integrations/google-calendar/scheduling'

    const { container } = render(
      <Shell role="AGENT" userName="Ana">
        <p>Conteúdo</p>
      </Shell>,
    )

    expect(container.querySelector('.shell-topbar-title')).toHaveTextContent('Link de agendamento')
  })

  it('exposes user management and names dynamic user details in the admin shell', () => {
    mocks.pathname = '/admin/users/user-123'

    const { container } = render(
      <Shell role="ADMIN" userName="Admin">
        <p>Conteúdo</p>
      </Shell>,
    )

    expect(screen.getAllByRole('link', { name: 'Usuários' })).not.toHaveLength(0)
    expect(screen.getAllByRole('link', { name: 'Usuários' })[0]).toHaveAttribute('href', '/admin/users')
    expect(container.querySelector('.shell-topbar-title')).toHaveTextContent('Detalhe do usuário')
  })

  it('keeps only overview and users in the administrative navigation', () => {
    mocks.pathname = '/admin'

    render(
      <Shell role="ADMIN" userName="Admin">
        <p>Conteúdo</p>
      </Shell>,
    )

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' })
    const navigationLabels = Array.from(
      navigation.querySelectorAll('ul a[aria-label]'),
    ).map((element) => element.getAttribute('aria-label'))

    expect(navigationLabels).toEqual(['Visão geral', 'Usuários'])
    expect(screen.queryByRole('link', { name: 'Integrações' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Auditoria' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Importar dados' })).toBeNull()
  })

  it('keeps account settings available in navigation and the account controls', () => {
    mocks.pathname = '/agent/settings'

    render(
      <Shell role="AGENT" userName="Ana">
        <p>Conteúdo</p>
      </Shell>,
    )

    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Abrir configurações da conta' })).toHaveAttribute(
      'href',
      '/agent/settings',
    )
    expect(screen.getByRole('link', { name: 'Abrir configurações de Ana' })).toHaveAttribute(
      'href',
      '/agent/settings',
    )
    expect(screen.getByText('Configurações da conta')).toBeInTheDocument()
  })

  it('shows the authenticated account trial globally with a plan action', () => {
    render(
      <AgentAccessProvider access={FOUNDER_TRIAL_ACCESS}>
        <Shell role="AGENT" userName="Ana">
          <p>Conteúdo</p>
        </Shell>
      </AgentAccessProvider>,
    )

    expect(screen.getByRole('timer')).toHaveAccessibleName(/30 dias/)
    expect(screen.getByRole('link', { name: 'Ver plano' })).toHaveAttribute(
      'href',
      '/agent/agency',
    )
  })
})

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

  it('returns administrators to the dedicated admin login', async () => {
    render(
      <Shell role="ADMIN" userName="Gestora">
        <p>Conteúdo</p>
      </Shell>,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /Sair/ })[0])

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/login'))
  })
})

describe('Shell achievement band', () => {
  it('keeps the Black Jacket preview URL in both journey entry points', () => {
    render(
      <AgentPromotionProvider initialIdentity={STANDARD_RANK}>
        <Shell
          role="AGENT"
          userName="Ana"
          promotionIdentity={BLACK_JACKET}
          journeyHref="/agent/journey?preview=black-jacket"
        >
          <p>Hoje</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    expect(screen.getByLabelText('Conquista atual: Black Jacket')).toHaveAttribute(
      'data-achievement-tone',
      'black',
    )
    expect(screen.getByText('Executive Vice President')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /jornada/i })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: expect.stringContaining('/agent/journey?preview=black-jacket'),
        }),
      ]),
    )
  })

  it('shows a jacket achievement without hiding the current module', async () => {
    mocks.pathname = '/agent/policies'
    // Overrides the beforeEach stub so this test also proves the topbar
    // mounts CarrierSyncBadge in the achievement branch — the one place that
    // exercises it besides CarrierSyncBadge.test.tsx.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ state: { kind: 'IN_SYNC' } }) })),
    )

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
    expect(await screen.findByText('Atualizado')).toBeInTheDocument()
  })

  it('keeps pre-jacket ranks in the neutral shell', async () => {
    // Same override, this time for the non-achievement branch — the other of
    // the two spots that used to hardcode "Operação conectada".
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ state: { kind: 'IN_SYNC' } }) })),
    )

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
    expect(await screen.findByText('Atualizado')).toBeInTheDocument()
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
    // If this ever answered "Em dia", CarrierSyncBadge would have mounted for
    // an ADMIN shell despite the `role === 'AGENT'` gate — and fetch would
    // have been called at all, which the assertion below also checks.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ state: { kind: 'IN_SYNC' } }) })),
    )

    render(
      <AgentPromotionProvider initialIdentity={BLUE_JACKET}>
        <Shell role="ADMIN" userName="Admin">
          <p>Conteúdo</p>
        </Shell>
      </AgentPromotionProvider>,
    )

    expect(screen.queryByLabelText('Conquista atual: Blue Jacket')).toBeNull()
    expect(screen.getByText('Visão geral da plataforma')).toBeInTheDocument()
    expect(screen.queryByText('Up to date')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
