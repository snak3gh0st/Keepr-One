// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import IllustrationsPage from './page'

const state = vi.hoisted(() => ({ read: vi.fn(), parse: vi.fn(), statuses: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: async () => ({ name: 'Agent' }) } } }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: async () => ({ id: 'agent-1', userId: 'user-1' }) }))
vi.mock('@/lib/i18n/server', () => ({
  getServerI18n: async () => ({
    language: 'PT',
    copy: (pt: string, _en: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce((message, [key, value]) => message.replaceAll(`{${key}}`, String(value)), pt),
  }),
}))
vi.mock('@/lib/national-life/local-connector/config', () => ({ getNationalLifeLocalConnectorConfig: () => ({ enabled: false }) }))
vi.mock('@/lib/national-life/illustration-directory', () => ({
  parseIllustrationDirectoryFilters: state.parse,
  readIllustrationDirectory: state.read,
}))
vi.mock('@/lib/national-life/illustration-command-status', () => ({ getIllustrationCommandStatuses: state.statuses }))
vi.mock('@/components/Shell', () => ({ Shell: ({ children }: PropsWithChildren) => <div>{children}</div> }))
vi.mock('@/components/PageHeader', () => ({ PageHeader: ({ children }: PropsWithChildren) => <div>{children}</div> }))
vi.mock('./IllustrationPdfButton', () => ({ IllustrationPdfButton: () => <button>PDF</button> }))
vi.mock('./StartApplicationFromIllustrationButton', () => ({ StartApplicationFromIllustrationButton: () => <button>Application</button> }))
vi.mock('@/components/kbot/KBotAvatar', () => ({ KBotAvatar: () => <div>KBot</div> }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('renders the later illustration page, scopes command feedback to it, and preserves application intent in pagination', async () => {
  const filters = { query: '', document: null, sort: 'recent', page: 5 }
  state.parse.mockReturnValue(filters)
  state.read.mockResolvedValue({
    items: [{
      id: 'illustration-101',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      insuredName: 'Record 101',
      faceAmount: 100_000,
      premium: 100,
      targetPremium: null,
      targetPremiumSource: null,
      productName: 'IUL',
      documentFetchedAt: new Date('2026-09-01T00:00:00.000Z'),
      documentMimeType: 'application/pdf',
      client: { id: 'client-1', name: 'Client 101' },
    }],
    total: 101,
    page: 5,
    pageCount: 5,
    summary: { total: 101, ready: 100, pending: 1 },
    filters,
  })
  state.statuses.mockResolvedValue(new Map())

  render(await IllustrationsPage({ searchParams: Promise.resolve({ intent: 'application', page: '5' }) }))

  expect(screen.getByRole('link', { name: 'Record 101' })).toHaveAttribute(
    'href',
    '/agent/illustrations/illustration-101?intent=application',
  )
  expect(screen.getByRole('link', { name: 'Anterior' })).toHaveAttribute(
    'href',
    '/agent/illustrations?intent=application&page=4',
  )
  expect(state.statuses).toHaveBeenCalledWith('agent-1', ['illustration-101'])
})
