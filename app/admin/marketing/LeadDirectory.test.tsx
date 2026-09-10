// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeadDirectory } from './LeadDirectory'
import type { LeadFilters, MarketingLeadRow } from '@/lib/marketing/types'

const mocks = vi.hoisted(() => ({ bulk: vi.fn(), refresh: vi.fn() }))
vi.mock('./actions', () => ({ bulkUpdateLeadStatusAction: mocks.bulk }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/components/i18n/LanguageProvider', () => ({ useI18n: () => ({ copy: (pt: string) => pt, language: 'PT' }) }))
const filters: LeadFilters = { query: '', status: null, campaignId: null, ownerId: null, period: 'all', followUp: 'all', page: 1 }
const rows: MarketingLeadRow[] = ['first', 'second'].map(id => ({ id, name: id, email: `${id}@example.com`, phone: '+12015550123', status: 'NEW', source: 'FOUNDERS', createdAt: '2026-09-10T12:00:00Z', nextContactAt: null, campaign: { id: 'founders-program', name: 'Founders' }, owner: null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('Marketing lead selection', () => {
  it('bulk updates only visible selected records, not all filtered pages', async () => {
    mocks.bulk.mockResolvedValue({ ok: true })
    render(<LeadDirectory directory={{ rows, total: 40, page: 1, pageCount: 2 }} filters={filters} hasFilters={false} />)
    fireEvent.click(screen.getByLabelText('Selecionar todos os leads desta página'))
    fireEvent.change(screen.getByLabelText('Nova etapa dos selecionados'), { target: { value: 'CONTACTED' } })
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar etapa' }))
    await screen.findByRole('status')
    const data = mocks.bulk.mock.calls[0][0] as FormData
    expect(data.getAll('ids')).toEqual(['first', 'second'])
    expect(data.get('status')).toBe('CONTACTED')
    expect(screen.getByLabelText('Selecionar todos os leads desta página')).not.toBeChecked()
  })
  it('preserves filters in the next-page link', () => {
    render(<LeadDirectory directory={{ rows, total: 40, page: 1, pageCount: 2 }} filters={{ ...filters, query: 'ana', status: 'NEW', campaignId: 'campaign-1' }} hasFilters />)
    expect(screen.getByRole('link', { name: 'Próxima' }).getAttribute('href')).toBe('/admin/marketing?q=ana&status=NEW&campaign=campaign-1&page=2')
  })
})
