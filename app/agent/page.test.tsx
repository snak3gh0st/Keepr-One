// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
  inforceFindMany: vi.fn(),
  targetPremiumAggregate: vi.fn(),
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
}))

vi.mock('@/lib/agent-context', () => ({
  getCurrentAgent: mocks.getCurrentAgent,
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
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  confirmedCreditCount: 0,
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
  mocks.inforceFindMany.mockResolvedValue([])
  mocks.targetPremiumAggregate.mockResolvedValue({ _count: { ctp: 0 }, _sum: { ctp: null } })
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
  it('does not query or render disabled modules for a TODAY-only account', async () => {
    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Seu dia começa com clareza.' })).toBeVisible()
    expect(mocks.getPromotionSnapshot).not.toHaveBeenCalled()
    expect(mocks.getPromotionPreview).not.toHaveBeenCalled()
    expect(mocks.policyCount).not.toHaveBeenCalled()
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

  it('preserves the unrestricted legacy dashboard when enabledModules is null', async () => {
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
    expect(mocks.commissionAggregate).toHaveBeenCalled()
    expect(mocks.caseCount).toHaveBeenCalled()
    expect(mocks.requirementCount).toHaveBeenCalled()
    expect(mocks.carrierRowsFindMany).toHaveBeenCalled()
    expect(mocks.getCalendarConnection).toHaveBeenCalledWith('user-1')
    expect(screen.getByTestId('commission-trend')).toBeInTheDocument()
    expect(screen.getByTestId('today-meetings')).toBeInTheDocument()
    expect(screen.getByTestId('upcoming-meetings')).toBeInTheDocument()
    expect(screen.getByTestId('journey-preview')).toBeInTheDocument()
    expect(screen.getByTestId('operation-signals')).toBeInTheDocument()
  })

  it('renders carrier-backed subtotals while an in-force snapshot is reconciling', async () => {
    mocks.getCurrentAgentAccess.mockResolvedValue({
      scopeAgentIds: ['agent-1'],
      enabledModules: ['TODAY', 'COMMISSIONS', 'POLICIES'],
      canViewTeamData: false,
      canViewAgencyNationalLife: false,
      canManageTeam: false,
    })
    mocks.policyCount.mockResolvedValue(2)
    mocks.policyFindMany.mockResolvedValue([
      {
        clientId: 'client-1',
        policyNumber: 'POLICY-1',
        faceAmount: 100_000,
        faceAmountSource: 'NATIONAL_LIFE_POLICY_DETAIL',
        premium: 1_200,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
      {
        clientId: 'client-2',
        policyNumber: 'POLICY-2',
        faceAmount: null,
        faceAmountSource: null,
        premium: 1_800,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
    ])
    mocks.inforceFindMany.mockResolvedValue([
      { policyNumber: 'POLICY-1', policyStatus: 'Active', fetchedAt: new Date('2026-09-03T16:00:00.000Z') },
    ])

    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    expect(screen.getByLabelText('Target Premium indisponível')).toBeVisible()
    const activeClientsMetric = screen.getAllByText('Clientes ativos National')
      .find((element) => element.tagName === 'P')
    expect(activeClientsMetric?.parentElement).toHaveTextContent('2')
    expect(screen.getAllByText(/100\.000/).some((element) => element.tagName === 'P')).toBe(true)
    expect(screen.getAllByText(/3\.000/).some((element) => element.tagName === 'P')).toBe(true)
    expect(screen.getByText(/Subtotal confirmado · 1\/2 apólices/)).toBeVisible()
    expect(screen.getByText(/Subtotal confirmado · 2\/2 apólices/)).toBeVisible()
  })

  it('renders captured carrier CTP instead of claiming an empty ledger is zero', async () => {
    mocks.getPromotionSnapshot.mockResolvedValue({
      ...promotionSnapshot,
      pendingPersonalPc: 325.8,
      pendingCreditCount: 1,
      hasPromotionData: true,
    })
    mocks.getCurrentAgentAccess.mockResolvedValue({
      scopeAgentIds: ['agent-1'],
      enabledModules: ['TODAY', 'COMMISSIONS', 'POLICIES'],
      canViewTeamData: false,
      canViewAgencyNationalLife: false,
      canManageTeam: false,
    })
    mocks.policyFindMany.mockResolvedValue([
      {
        clientId: 'client-1',
        policyNumber: 'POLICY-1',
        faceAmount: null,
        faceAmountSource: null,
        premium: 960,
        sourceUpdatedAt: new Date('2026-09-03T16:00:00.000Z'),
      },
    ])
    mocks.targetPremiumAggregate.mockResolvedValue({
      _count: { ctp: 1 },
      _sum: { ctp: 325.8 },
    })

    render(await AgentDashboard({ searchParams: Promise.resolve({}) }))

    expect(screen.getByLabelText(/Target Premium capturado de/)).toHaveTextContent('US$ 325,80')
    expect(screen.queryByText(/valor confirmado é zero/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Subtotal exato de CTP capturado no detalhe de 1 de 1 apólice/)).toBeVisible()
  })
})
