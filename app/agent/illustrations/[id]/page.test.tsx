// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  findUniqueUser: vi.fn(),
  findFirstIllustration: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
    illustration: { findFirst: mocks.findFirstIllustration },
  },
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
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

import QuoteSummaryPage from './page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1', userId: 'user-1' })
  mocks.findUniqueUser.mockResolvedValue({ name: 'Ana Corretora' })
  // Mirrors what next/navigation's real notFound() does: it throws rather
  // than returning, which is what lets the page function short-circuit.
  mocks.notFound.mockImplementation(() => {
    throw new Error('NEXT_NOT_FOUND')
  })
})

describe('Quote summary page', () => {
  // Scoped in the query, not checked after it: an id that belongs to another
  // agent has to come back exactly like an id that never existed, so the
  // list of illustrations one agent can see never leaks into another's URL
  // bar.
  it('404s when the id does not belong to the signed-in agent', async () => {
    mocks.findFirstIllustration.mockResolvedValue(null)

    await expect(
      QuoteSummaryPage({ params: Promise.resolve({ id: 'someone-elses-id' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')

    expect(mocks.findFirstIllustration).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'someone-elses-id', agentId: 'agent-1' } }),
    )
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  // The page's whole promise is that a value either came from the carrier or
  // renders as "—" — never as a zero, and never as a fact the carrier never
  // stated. A payload with no response fields at all is the sharpest version
  // of "carrier said nothing here": every carrier-sourced Fact must fall back
  // to the dash, including Lapse, which is the field most at risk of reading
  // a "not known" as a definite claim (see the LapseYear ripple in
  // rapid-solve.ts and quote-summary.ts).
  it('renders "—" for an absent field instead of a zero or a fabricated claim', async () => {
    mocks.findFirstIllustration.mockResolvedValue({
      id: 'illustration-1',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      insuredName: 'Cliente Teste',
      insuredDateOfBirth: null,
      productName: null,
      documentFetchedAt: null,
      rawPayload: { request: {}, response: {} },
    })

    render(await QuoteSummaryPage({ params: Promise.resolve({ id: 'illustration-1' }) }))

    const capitalDd = screen.getByText('Capital segurado').nextElementSibling
    expect(capitalDd?.textContent).toBe('—')
    expect(capitalDd?.textContent).not.toBe('$0')

    const lapseDd = screen.getByText('Lapse').nextElementSibling
    expect(lapseDd?.textContent).toBe('—')
    expect(lapseDd?.textContent).not.toBe('Não lapsa')
    expect(lapseDd?.textContent).not.toBe('Ano 0')
  })
})
