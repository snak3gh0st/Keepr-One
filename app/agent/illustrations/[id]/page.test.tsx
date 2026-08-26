// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('@/lib/national-life/illustration-command-status', () => ({
  getIllustrationCommandStatuses: mocks.getCommandStatuses,
}))
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
})
