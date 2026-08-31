// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  findUniqueUser: vi.fn(),
  findFirstIllustration: vi.fn(),
  notFound: vi.fn(),
  getCommandStatuses: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
    illustration: { findFirst: mocks.findFirstIllustration },
  },
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/lib/national-life/illustration-command-status', async () => {
  const actual = await vi.importActual<typeof import('@/lib/national-life/illustration-command-status')>(
    '@/lib/national-life/illustration-command-status',
  )
  return { ...actual, getIllustrationCommandStatuses: mocks.getCommandStatuses }
})
vi.mock('@/components/Shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({
    title,
    description,
    children,
  }: {
    title: string
    description?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <header>
      <h1>{title}</h1>
      {description}
      {children}
    </header>
  ),
}))
vi.mock('../IllustrationPdfButton', () => ({
  IllustrationPdfButton: () => <button>Gerar PDF</button>,
}))

import IllustrationDetailPage from './page'

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.findUniqueUser.mockResolvedValue({ name: 'Ana Corretora' })
  mocks.getCommandStatuses.mockResolvedValue(new Map())
  // Mirrors what next/navigation's real notFound() does: it throws rather
  // than returning, which is what lets the page function short-circuit.
  mocks.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
})

describe('Illustration detail page', () => {
  // Scoped in the query, not checked after it: an id that belongs to another
  // agent has to come back exactly like an id that never existed, so the
  // list of illustrations one agent can see never leaks into another's URL
  // bar.
  it('404s when the id does not belong to the signed-in agent', async () => {
    mocks.findFirstIllustration.mockResolvedValue(null)

    await expect(
      IllustrationDetailPage({ params: Promise.resolve({ id: 'someone-elses-id' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.findFirstIllustration).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses-id', agentId: 'agent-1' } }),
    )
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('labels the premium as agent input until the official PDF exists', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-1',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      insuredName: 'Cliente Teste',
      insuredDateOfBirth: null,
      productName: 'FlexLife',
      faceAmount: 250000,
      targetPremium: 350,
      targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
      documentFetchedAt: null,
      documentMimeType: null,
    })

    render(await IllustrationDetailPage({ params: Promise.resolve({ id: 'illustration-1' }) }))

    expect(screen.getByText('Prêmio mensal informado')).toBeTruthy()
    expect(screen.getByText('Informado pelo agente para a ilustração')).toBeTruthy()
    expect(screen.queryByText('O que a seguradora respondeu')).toBeNull()
  })

  it('shows the material Foresight choices that will be verified before a carrier save', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-reviewed-inputs',
      createdAt: new Date('2026-08-27T12:00:00.000Z'),
      insuredName: 'Cliente Teste',
      insuredDateOfBirth: new Date('1988-02-06T00:00:00.000Z'),
      productName: 'FlexLife',
      faceAmount: 1_000_000,
      targetPremium: 350,
      targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
      documentFetchedAt: null,
      documentMimeType: null,
      caseId: null,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 1,
          firstName: 'Cliente',
          lastName: 'Teste',
          dateOfBirth: '1988-02-06',
          issueState: 'FL',
          gender: 'Female',
          rateClass: 'Standard_NT',
          faceAmount: 1_000_000,
          monthlyPremium: 350,
          deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
      },
    })

    render(await IllustrationDetailPage({ params: Promise.resolve({ id: 'illustration-reviewed-inputs' }) }))

    expect(screen.getByText('Parâmetros do Foresight')).toBeTruthy()
    expect(screen.getByText('FL')).toBeTruthy()
    expect(screen.getByText('Feminino • Standard não-tabagista')).toBeTruthy()
    expect(screen.getByText('A — nivelado')).toBeTruthy()
    expect(screen.getByText('Mensal • Specify Amount')).toBeTruthy()
    expect(screen.getByText('S&P 500 — foco em teto (100%)')).toBeTruthy()
  })

  it('shows the carrier-confirmed result for a premium-solved IUL only after the PDF exists', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-solved-iul',
      createdAt: new Date('2026-08-27T12:00:00.000Z'),
      insuredName: 'Cliente Teste',
      insuredDateOfBirth: new Date('1988-02-06T00:00:00.000Z'),
      productName: 'FlexLife',
      faceAmount: 250_000,
      premium: 350,
      targetPremium: 350,
      targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
      documentFetchedAt: new Date('2026-08-27T12:02:00.000Z'),
      documentMimeType: 'application/pdf',
      caseId: null,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 2,
          firstName: 'Cliente', lastName: 'Teste', dateOfBirth: '1988-02-06', issueState: 'FL',
          gender: 'Female', rateClass: 'Standard_NT', solveBasis: 'PREMIUM', targetMonthlyPremium: 350,
          deathBenefitOption: 'A_Level', strategy: 'SP500PointToPointCapFocus',
        },
        foresightResult: {
          solveBasis: 'PREMIUM', requestedAmount: 350, confirmedFaceAmount: 250_000,
          confirmedMonthlyPremium: 350, confirmedAnnualPremium: 4_200,
        },
      },
    })

    render(await IllustrationDetailPage({ params: Promise.resolve({ id: 'illustration-solved-iul' }) }))

    expect(screen.getByText('Prêmio mensal confirmado')).toBeTruthy()
    expect(screen.getByText('Prêmio anual confirmado')).toBeTruthy()
    expect(screen.getByText('$4,200.00')).toBeTruthy()
    expect(screen.getByText('Confirmado no Foresight com o PDF oficial')).toBeTruthy()
    expect(screen.getByText('Resolvido pelo prêmio mensal')).toBeTruthy()
    expect(screen.getByText('Based on Target Premium')).toBeTruthy()
    expect(screen.getByText('Pedido do agente')).toBeTruthy()
    expect(screen.getByText('Confirmação da National Life')).toBeTruthy()
    expect(screen.getByText('$350.00 por mês')).toBeTruthy()
    expect(screen.getByText('$4,200.00 por ano')).toBeTruthy()
  })

  it('shows the official Term premium instead of empty IUL input fields', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-term-result',
      createdAt: new Date('2026-08-31T18:27:54.748Z'),
      insuredName: 'KBot Illustration Term Test',
      insuredDateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      productName: 'LSW Term',
      faceAmount: 500_000,
      premium: 62.92,
      targetPremium: 62.92,
      targetPremiumSource: 'CARRIER_CALCULATED_FOR_TERM',
      documentFetchedAt: new Date('2026-08-31T20:46:47.317Z'),
      documentMimeType: 'application/pdf',
      caseId: null,
      rawPayload: {
        foresightTermDraft: {
          schemaVersion: 1, carrierProduct: 'LSW Term', firstName: 'KBot',
          lastName: 'Illustration Term Test', dateOfBirth: '1990-01-01', issueState: 'FL',
          gender: 'Male', rateClass: 'Standard_NT', faceAmount: 500_000,
          premiumMode: 'Monthly', termDuration: '20-G',
        },
        foresightTermResult: {
          source: 'OFFICIAL_PDF', premiumMode: 'Monthly', confirmedFaceAmount: 500_000,
          confirmedMonthlyPremium: 62.92, confirmedAnnualPremium: 755.04,
        },
      },
    })

    render(await IllustrationDetailPage({ params: Promise.resolve({ id: 'illustration-term-result' }) }))

    expect(screen.getByText('Resultado confirmado pela National')).toBeTruthy()
    expect(screen.getByText('Prêmio mensal confirmado')).toBeTruthy()
    expect(screen.getAllByText('$62.92').length).toBeGreaterThan(0)
    expect(screen.getByText('Total anual no modo mensal')).toBeTruthy()
    expect(screen.getByText('$755.04')).toBeTruthy()
    expect(screen.getByText('Confirmado no Foresight com o PDF oficial')).toBeTruthy()
    expect(screen.queryByText('Prêmio mensal informado')).toBeNull()
  })

  it('explains when the carrier confirms values different from the agent input', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-adjusted-iul', createdAt: new Date('2026-08-27T12:00:00.000Z'),
      insuredName: 'Ale Teste', insuredDateOfBirth: new Date('1998-03-12T00:00:00.000Z'),
      productName: 'FlexLife', faceAmount: 2_000_000, premium: 105, targetPremium: 100,
      targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
      documentFetchedAt: new Date('2026-08-27T12:02:00.000Z'), documentMimeType: 'application/pdf',
      caseId: null,
      rawPayload: {
        foresightDraft: {
          schemaVersion: 2, firstName: 'Ale', lastName: 'Teste', dateOfBirth: '1998-03-12',
          issueState: 'FL', gender: 'Male', rateClass: 'Standard_NT', solveBasis: 'PREMIUM',
          targetMonthlyPremium: 100, deathBenefitOption: 'A_Level',
          strategy: 'SP500PointToPointCapFocus',
        },
        foresightResult: {
          solveBasis: 'PREMIUM', requestedAmount: 100, confirmedFaceAmount: 2_000_000,
          confirmedMonthlyPremium: 105, confirmedAnnualPremium: 1_260,
        },
      },
    })

    render(await IllustrationDetailPage({ params: Promise.resolve({ id: 'illustration-adjusted-iul' }) }))

    expect(screen.getByText(/Você informou \$100\.00 por mês/)).toBeTruthy()
    expect(screen.getByText(/National Life confirmou \$105\.00 por mês e \$1,260\.00 por ano/)).toBeTruthy()
  })

  it('shows a premium rejection as a scenario review instead of an in-progress Foresight run', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-rejected-premium',
      createdAt: new Date('2026-08-27T12:00:00.000Z'),
      insuredName: 'Cliente Teste',
      insuredDateOfBirth: null,
      productName: 'FlexLife',
      faceAmount: 1_000_000,
      targetPremium: 50,
      targetPremiumSource: 'AGENT_INPUT_FOR_FORESIGHT',
      documentFetchedAt: null,
      documentMimeType: null,
    })
    mocks.getCommandStatuses.mockResolvedValue(new Map([[
      'illustration-rejected-premium',
      { state: 'FAILED', safeErrorCode: 'FORESIGHT_PREMIUM_WRITE_MISMATCH' },
    ]]))

    render(await IllustrationDetailPage({ params: Promise.resolve({ id: 'illustration-rejected-premium' }) }))

    expect(screen.getByText('O Foresight não aceitou este cenário')).toBeTruthy()
    expect(screen.getAllByText(
      'O Foresight não aceitou o prêmio mensal informado para este cenário. Revise o prêmio e gere uma nova ilustração; nenhum PDF foi emitido.',
    ).length).toBeGreaterThan(0)
    expect(screen.queryByText('Gerando a ilustração oficial')).toBeNull()
  })
})
