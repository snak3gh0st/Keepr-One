// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getCurrentAgentAccess: vi.fn(),
  getPromotionSnapshot: vi.fn(),
  getPromotionPreview: vi.fn(),
  findUser: vi.fn(),
  policyCount: vi.fn(),
  policyFindMany: vi.fn(),
  policyGroupBy: vi.fn(),
  targetPremiumAggregate: vi.fn(),
  inforceFindMany: vi.fn(),
  commissionAggregate: vi.fn(),
  commissionGroupBy: vi.fn(),
  caseCount: vi.fn(),
  caseFindMany: vi.fn(),
  requirementCount: vi.fn(),
  transactionGroupBy: vi.fn(),
  reviewCount: vi.fn(),
  carrierRowsFindMany: vi.fn(),
  getDueFollowUps: vi.fn(),
  getCalendarConnection: vi.fn(),
  getTodayCalendarSummary: vi.fn(),
  getUpcomingCalendarEvents: vi.fn(),
  loadNationalPolicyQueues: vi.fn(),
  shellProps: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({
  getCurrentAgent: mocks.getCurrentAgent,
}))
vi.mock('@/lib/national-life/policy-queues-prisma', () => ({
  loadNationalPolicyQueues: mocks.loadNationalPolicyQueues,
}))
vi.mock('@/lib/national-life/current-portfolio-prisma', () => ({
  loadCurrentNationalLifePortfolio: async () => {
    const rows = await mocks.policyFindMany()
    return { rows, storedPolicies: rows.length, historicalPolicies: 0, verified: true,
      statusCounts: [], productCounts: [] }
  },
}))
vi.mock('@/lib/agent-access', () => ({
  getCurrentAgentAccess: mocks.getCurrentAgentAccess,
}))
vi.mock('@/lib/agent-promotion', () => ({
  getAgentPromotionSnapshot: mocks.getPromotionSnapshot,
}))
vi.mock('@/lib/promotion-preview', () => ({
  getLocalPromotionPreview: mocks.getPromotionPreview,
}))
vi.mock('@/lib/promotion-journey', () => ({
  getPromotionIdentity: vi.fn(() => ({ tone: 'standard', rankTitle: null, jacket: null })),
  getPromotionJourney: vi.fn(() => ({ currentRank: null })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    policy: { count: mocks.policyCount, findMany: mocks.policyFindMany, groupBy: mocks.policyGroupBy },
    commissionRecord: {
      aggregate: mocks.commissionAggregate,
      groupBy: mocks.commissionGroupBy,
    },
    insuranceCase: { count: mocks.caseCount, findMany: mocks.caseFindMany },
    applicationRequirement: { count: mocks.requirementCount },
    commissionTransaction: { groupBy: mocks.transactionGroupBy },
    policyReview: { count: mocks.reviewCount },
    nationalLifeReportRow: { findMany: mocks.carrierRowsFindMany },
    nationalLifeInforcePolicy: { findMany: mocks.inforceFindMany },
    nationalLifePolicyDetailSnapshot: { aggregate: mocks.targetPremiumAggregate },
  },
}))
vi.mock('@/lib/crm', () => ({
  getDueFollowUpsForScope: mocks.getDueFollowUps,
  nyDayBounds: (date: Date) => ({ start: date, end: date }),
}))
vi.mock('@/lib/calendar', () => ({
  getCalendarConnectionForUser: mocks.getCalendarConnection,
  getTodayCalendarSummary: mocks.getTodayCalendarSummary,
  getUpcomingCalendarEvents: mocks.getUpcomingCalendarEvents,
}))
vi.mock('@/components/calendar/server-adapter', () => ({
  mapDomainCalendarConnectionToUi: () => ({
    connection: {
      status: 'DISCONNECTED',
      email: null,
      displayName: null,
      lastSyncAt: null,
      errorMessage: null,
    },
    calendars: [],
  }),
  mapDomainCalendarEventToUi: vi.fn(),
}))
vi.mock('@/lib/national-life/local-connector/config', () => ({
  getNationalLifeLocalConnectorConfig: () => ({ enabled: true }),
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE: 'LOCAL',
}))
vi.mock('@/lib/national-life/commission-grid-keys', () => ({
  COMMISSION_EARNING_GRID_KEYS: ['COMMISSION_EARNINGS'],
  LEGACY_COMMISSION_EARNING_DEPLOYMENT_SCOPE: 'LEGACY',
  LEGACY_COMMISSION_EARNING_GRID_KEY: 'LEGACY_COMMISSIONS',
}))
vi.mock('@/components/Shell', () => ({
  Shell: ({ children, ...props }: { children: React.ReactNode; kbotWelcome?: boolean }) => {
    mocks.shellProps(props)
    return <div>{children}</div>
  },
}))
vi.mock('@/components/KeeprDashboardMotion', () => ({
  KeeprDashboardMotion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/TrendChart', () => ({
  TrendChart: () => <div data-testid="commission-trend" />,
}))
vi.mock('@/components/OperationSignals', () => ({
  OperationSignals: () => <div data-testid="operation-signals" />,
}))
vi.mock('./JourneyDashboardPreview', () => ({
  JourneyDashboardPreview: () => <div data-testid="journey-preview" />,
}))
vi.mock('@/components/crm/FollowUpActionCard', () => ({
  FollowUpActionCard: () => <div data-testid="follow-up-card" />,
}))
vi.mock('@/components/calendar/TodayMeetingsSection', () => ({
  TodayMeetingsSection: () => <div data-testid="today-meetings" />,
}))
vi.mock('@/components/calendar/UpcomingMeetingsSection', () => ({
  UpcomingMeetingsSection: () => <div data-testid="upcoming-meetings" />,
}))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    language: 'PT',
    copy: (portuguese: string) => portuguese,
  }),
}))

import AgentDashboard from './page'

const promotionSnapshot = {
  personalPc: 0,
  agencyPc: 0,
  estimatedPersonalPc: 0,
  estimatedAgencyPc: 0,
  pendingPersonalPc: 0,
  pendingAgencyPc: 0,
  hasPromotionData: false,
  ledgerReady: true,
  highestAchievement: null,
  mode: 'individual',
  loadError: false,
  windowStart: '2025-09-01T00:00:00.000Z',
  windowEnd: '2026-09-01T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.findUser.mockResolvedValue({ name: 'Ana', timeZone: 'America/New_York' })
  mocks.getCurrentAgentAccess.mockResolvedValue({
    scopeAgentIds: ['agent-1'],
    enabledModules: ['TODAY'],
    canViewTeamData: false,
    canViewAgencyNationalLife: false,
    canManageTeam: false,
  })
  mocks.getPromotionSnapshot.mockResolvedValue(promotionSnapshot)
  mocks.getPromotionPreview.mockReturnValue(null)
  mocks.policyCount.mockResolvedValue(0)
  mocks.policyFindMany.mockResolvedValue([])
  mocks.policyGroupBy.mockResolvedValue([])
  mocks.targetPremiumAggregate.mockResolvedValue({ _count: { ctp: 0 }, _sum: { ctp: null } })
  mocks.loadNationalPolicyQueues.mockResolvedValue({ verified: true, counts: {
    ENTER_INFORCE: 45, WAITING_AGENT: 42, WAITING_CLIENT: 35,
  } })
  mocks.inforceFindMany.mockResolvedValue([])
  mocks.commissionAggregate.mockResolvedValue({ _sum: { amount: null } })
  mocks.commissionGroupBy.mockResolvedValue([])
  mocks.caseCount.mockResolvedValue(0)
  mocks.caseFindMany.mockResolvedValue([])
  mocks.requirementCount.mockResolvedValue(0)
  mocks.transactionGroupBy.mockResolvedValue([])
  mocks.reviewCount.mockResolvedValue(0)
  mocks.carrierRowsFindMany.mockResolvedValue([])
  mocks.getDueFollowUps.mockResolvedValue([])
  mocks.getCalendarConnection.mockResolvedValue({})
  mocks.getTodayCalendarSummary.mockResolvedValue({ upcoming: [] })
  mocks.getUpcomingCalendarEvents.mockResolvedValue([])
})

afterEach(() => cleanup())

describe('AgentDashboard module access', () => {
  it('asks the Shell for a K-Bot welcome only for the exact completed-onboarding flag', async () => {
    const completed = render(await AgentDashboard({
      searchParams: Promise.resolve({ onboarding: 'completed' }),
    }))

    expect(mocks.shellProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ kbotWelcome: true }),
    )

    completed.unmount()
    mocks.shellProps.mockClear()

    render(await AgentDashboard({
      searchParams: Promise.resolve({ onboarding: 'complete' }),
    }))

    expect(mocks.shellProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ kbotWelcome: false }),
    )
  })

  it('does not query or render disabled modules for a TODAY-only account', async () => {
    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Seu dia começa com clareza.' })).toBeVisible()
    expect(mocks.getPromotionSnapshot).not.toHaveBeenCalled()
    expect(mocks.getPromotionPreview).not.toHaveBeenCalled()
    expect(mocks.policyCount).not.toHaveBeenCalled()
    expect(mocks.targetPremiumAggregate).not.toHaveBeenCalled()
    expect(mocks.policyGroupBy).not.toHaveBeenCalled()
    expect(mocks.commissionAggregate).not.toHaveBeenCalled()
    expect(mocks.commissionGroupBy).not.toHaveBeenCalled()
    expect(mocks.caseCount).not.toHaveBeenCalled()
    expect(mocks.caseFindMany).not.toHaveBeenCalled()
    expect(mocks.requirementCount).not.toHaveBeenCalled()
    expect(mocks.transactionGroupBy).not.toHaveBeenCalled()
    expect(mocks.reviewCount).not.toHaveBeenCalled()
    expect(mocks.carrierRowsFindMany).not.toHaveBeenCalled()
    expect(mocks.getDueFollowUps).not.toHaveBeenCalled()
    expect(mocks.getCalendarConnection).not.toHaveBeenCalled()
    expect(mocks.getTodayCalendarSummary).not.toHaveBeenCalled()
    expect(mocks.getUpcomingCalendarEvents).not.toHaveBeenCalled()

    expect(screen.queryByTestId('commission-trend')).not.toBeInTheDocument()
    expect(screen.queryByTestId('today-meetings')).not.toBeInTheDocument()
    expect(screen.queryByTestId('upcoming-meetings')).not.toBeInTheDocument()
    expect(screen.queryByTestId('journey-preview')).not.toBeInTheDocument()
    expect(screen.queryByTestId('operation-signals')).not.toBeInTheDocument()

    const hrefs = Array.from(document.querySelectorAll('a')).map((link) =>
      link.getAttribute('href'),
    )
    expect(hrefs).not.toEqual(expect.arrayContaining([
      '/agent/calendar',
      '/agent/activities',
      '/agent/cases',
      '/agent/cases/new',
      '/agent/policies',
      '/agent/commissions',
      '/agent/journey',
      '/agent/hierarchy',
    ]))
  })

  it('uses the portfolio dashboard while preserving unrestricted module access', async () => {
    mocks.getCurrentAgentAccess.mockResolvedValue({
      scopeAgentIds: ['agent-1'],
      enabledModules: null,
      canViewTeamData: false,
      canViewAgencyNationalLife: false,
      canManageTeam: false,
    })

    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    expect(mocks.getPromotionSnapshot).toHaveBeenCalledWith('agent-1')
    expect(mocks.policyCount).toHaveBeenCalled()
    expect(mocks.policyFindMany).toHaveBeenCalled()
    expect(mocks.commissionAggregate).not.toHaveBeenCalled()
    expect(mocks.caseCount).toHaveBeenCalled()
    expect(mocks.requirementCount).toHaveBeenCalled()
    expect(mocks.carrierRowsFindMany).not.toHaveBeenCalled()
    expect(mocks.getCalendarConnection).toHaveBeenCalledWith('user-1')
    expect(screen.getByRole('heading', { name: 'Sua carteira, sob controle.' })).toBeVisible()
    expect(screen.queryByTestId('commission-trend')).not.toBeInTheDocument()
    expect(screen.getByTestId('today-meetings')).toBeInTheDocument()
    expect(screen.getByTestId('upcoming-meetings')).toBeInTheDocument()
    expect(screen.getByTestId('journey-preview')).toBeInTheDocument()
    expect(screen.getByTestId('operation-signals')).toBeInTheDocument()
  })

  it('turns National policy data into an understandable book and retention dashboard', async () => {
    mocks.getCurrentAgentAccess.mockResolvedValue({
      scopeAgentIds: ['agent-1'],
      enabledModules: ['TODAY', 'POLICIES'],
      canViewTeamData: false,
      canViewAgencyNationalLife: false,
      canManageTeam: false,
    })
    mocks.policyCount.mockResolvedValue(4)
    mocks.policyFindMany.mockResolvedValue([
      {
        clientId: 'client-1',
        policyNumber: 'POLICY-1',
        status: 'INFORCE',
        sourceStatus: 'Active',
        premium: 1_200,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-2',
        policyNumber: 'POLICY-2',
        status: 'INFORCE',
        sourceStatus: 'Pending Lapse',
        premium: 1_800,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-3',
        policyNumber: 'POLICY-3',
        status: 'LAPSED',
        sourceStatus: 'Lapsed',
        premium: 900,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-4',
        policyNumber: 'POLICY-4',
        status: 'CANCELLED',
        sourceStatus: 'Not Active',
        premium: 500,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
    ])

    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Sua carteira, sob controle.' })).toBeVisible()
    expect(screen.queryByTestId('commission-trend')).not.toBeInTheDocument()

    const hero = screen.getByRole('heading', { name: 'Sua carteira, sob controle.' }).closest('article')
    const queue = screen.getByRole('heading', { name: 'Prioridades de hoje' }).closest('aside')
    expect(hero).not.toBeNull()
    expect(queue).not.toBeNull()

    expect(within(hero!).getByText('Clientes ativos conciliados').parentElement).toHaveTextContent('2')
    expect(within(hero!).getByText('Apólices ativas').parentElement).toHaveTextContent('2')
    expect(within(hero!).getByText('Prêmio anual previsto · ativos').parentElement).toHaveTextContent(/3\.000/)
    expect(within(hero!).getByText('Prêmio anual médio por cliente').parentElement).toHaveTextContent(/1\.500/)
    expect(within(hero!).getByText('A entrar em vigor').closest('a')).toHaveAttribute('href', '/agent/policies?queue=ENTER_INFORCE')
    expect(within(hero!).getByText('A entrar em vigor').closest('a')).toHaveTextContent('45')
    expect(within(hero!).getByText('Aguardando agente').closest('a')).toHaveAttribute('href', '/agent/policies?queue=WAITING_AGENT')
    expect(within(hero!).getByText('Aguardando cliente').closest('a')).toHaveAttribute('href', '/agent/policies?queue=WAITING_CLIENT')

    expect(within(queue!).getByText('Pending Lapse').closest('a')).toHaveAttribute('href', '/agent/policies?status=PENDING_LAPSE')
    expect(within(queue!).getByText('Pending Lapse').closest('a')).toHaveTextContent('1')
    expect(within(queue!).getByText('Lapsed').closest('a')).toHaveAttribute('href', '/agent/policies?status=LAPSED')
    expect(within(queue!).getByText('Lapsed').closest('a')).toHaveTextContent('1')
    expect(within(queue!).getByText('Canceled').closest('a')).toHaveAttribute('href', '/agent/policies?status=CANCELLED')
    expect(within(queue!).getByText('Canceled').closest('a')).toHaveTextContent('1')
    expect(within(hero!).getByText('Prêmio anual em risco').parentElement).toHaveTextContent(/1\.800/)
  })

  it('does not present a partial AAP subtotal as the whole portfolio', async () => {
    mocks.getCurrentAgentAccess.mockResolvedValue({
      scopeAgentIds: ['agent-1'],
      enabledModules: ['TODAY', 'POLICIES'],
      canViewTeamData: false,
      canViewAgencyNationalLife: false,
      canManageTeam: false,
    })
    mocks.policyCount.mockResolvedValue(2)
    mocks.policyFindMany.mockResolvedValue([
      {
        clientId: 'client-1',
        status: 'INFORCE',
        sourceStatus: 'Active',
        premium: 1_200,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-2',
        status: 'INFORCE',
        sourceStatus: 'Pending Lapse',
        premium: null,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
    ])

    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    const hero = screen.getByRole('heading', { name: 'Sua carteira, sob controle.' }).closest('article')
    expect(hero).not.toBeNull()
    expect(within(hero!).getByText('Prêmio anual previsto · ativos').parentElement).toHaveTextContent('—')
    expect(within(hero!).getByText('Prêmio anual médio por cliente').parentElement).toHaveTextContent('—')
    expect(within(hero!).getByText('Prêmio anual em risco').parentElement).toHaveTextContent('—')
    expect(within(hero!).getByText('Prêmio anual em risco').parentElement).toHaveTextContent('0/1 apólices com prêmio anual')
    expect(within(hero!).getByText('Target Premium capturado').parentElement).toHaveTextContent('Total da carteira em apuração')
    expect(within(hero!).getByText(/Ausência de dados não significa Target Premium zero/)).toBeVisible()
  })

  it('renders exact captured CTP without requiring NPN or calling it confirmed PC', async () => {
    mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1', npn: null })
    mocks.getCurrentAgentAccess.mockResolvedValue({
      scopeAgentIds: ['agent-1'],
      enabledModules: ['TODAY', 'POLICIES'],
      canViewTeamData: false,
      canViewAgencyNationalLife: false,
      canManageTeam: false,
    })
    mocks.policyFindMany.mockResolvedValue([
      { clientId: 'client-1', status: 'INFORCE', sourceStatus: 'Active', premium: 960, sourceUpdatedAt: new Date() },
    ])
    mocks.targetPremiumAggregate.mockResolvedValue({ _count: { ctp: 1 }, _sum: { ctp: 325.8 } })

    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    const target = screen.getByText('Target Premium capturado').parentElement
    expect(target).toHaveTextContent('US$ 325,80')
    expect(target).toHaveTextContent('Total da carteira em apuração')
    expect(target).toHaveTextContent('apenas o subtotal de 1 detalhes capturados')
    expect(target).toHaveTextContent('NPN é opcional')
    expect(target).not.toHaveTextContent('0 PC')
  })
})
