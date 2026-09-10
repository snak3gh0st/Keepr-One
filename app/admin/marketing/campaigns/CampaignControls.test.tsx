// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CampaignRow, MarketingActionResult } from '@/lib/marketing/types'

const mocks = vi.hoisted(() => ({
  save: vi.fn<(form: FormData) => Promise<MarketingActionResult>>(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@/app/admin/marketing/actions', () => ({ saveCampaignAction: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('@/components/i18n/LanguageProvider', () => ({ useI18n: () => ({ copy: (pt: string) => pt, language: 'PT' }) }))

import { CampaignForm } from './CampaignForm'
import { CampaignLink } from './CampaignLink'
import { CampaignDirectory } from './CampaignDirectory'
import { campaignCapturePath } from './campaign-labels'

const campaign: CampaignRow = {
  id: 'test-campaign', name: 'Founders', slug: 'founders-program', description: 'Lançamento Keepr One',
  channel: 'ORGANIC', status: 'ACTIVE', budgetCents: 150025,
  startsAt: '2026-09-10T00:00:00.000Z', endsAt: null, createdAt: '2026-09-10T12:00:00.000Z',
  totalLeads: 12, convertedLeads: 2,
}

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('campaign form', () => {
  it('keeps entered values and announces server validation errors', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue({ ok: false, message: 'Revise os campos destacados.', fieldErrors: { name: ['Escolha outro nome.'] } })
    render(<CampaignForm />)
    await user.type(screen.getByLabelText('Nome da campanha'), 'Nova campanha')
    await user.click(screen.getByRole('button', { name: 'Criar campanha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise os campos destacados.')
    expect(screen.getByLabelText('Nome da campanha')).toHaveValue('Nova campanha')
    expect(screen.getByLabelText('Nome da campanha')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Nome da campanha')).toHaveAccessibleDescription('Escolha outro nome.')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('opens the created campaign after a successful save', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue({ ok: true, id: 'new-campaign' })
    render(<CampaignForm />)
    await user.type(screen.getByLabelText('Nome da campanha'), 'Founders Meta')
    await user.selectOptions(screen.getByLabelText('Canal de aquisição'), 'META_ADS')
    await user.click(screen.getByRole('button', { name: 'Criar campanha' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/admin/marketing/campaigns/new-campaign?created=1'))
    const form = mocks.save.mock.calls[0][0]
    expect(form.get('name')).toBe('Founders Meta')
    expect(form.get('channel')).toBe('META_ADS')
    expect(form.get('status')).toBe('DRAFT')
  })

  it('preserves the existing ID, exact USD budget and calendar date on edit', async () => {
    const user = userEvent.setup()
    mocks.save.mockResolvedValue({ ok: true, id: campaign.id })
    render(<CampaignForm campaign={campaign} />)
    await user.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Alterações salvas.')
    const form = mocks.save.mock.calls[0][0]
    expect(form.get('id')).toBe(campaign.id)
    expect(form.get('budget')).toBe('1500.25')
    expect(form.get('startsAt')).toBe('2026-09-10')
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})

describe('campaign capture link', () => {
  it('copies an absolute URL with the campaign attribution and opens a separate tab', async () => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const path = campaignCapturePath('founders-meta', 'META_ADS')
    render(<CampaignLink path={path} />)
    await user.click(screen.getByRole('button', { name: 'Copiar link' }))
    expect(write).toHaveBeenCalledWith(new URL(path, window.location.origin).href)
    expect(screen.getByRole('status')).toHaveTextContent('Link completo copiado')
    expect(screen.getByRole('link', { name: /Abrir página/ })).toHaveAttribute('href', path)
    expect(screen.getByRole('link', { name: /Abrir página/ })).toHaveAttribute('target', '_blank')
    expect(path).toContain('marketing_campaign=founders-meta')
    expect(path).toContain('utm_medium=paid_social')
  })

  it('provides the full URL for manual copying when the clipboard is unavailable', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard blocked'))
    render(<CampaignLink path="/founders?marketing_campaign=founders" />)
    await user.click(screen.getByRole('button', { name: 'Copiar link' }))
    const input = await screen.findByLabelText('Link completo')
    expect(input).toHaveValue(new URL('/founders?marketing_campaign=founders', window.location.origin).href)
    expect(screen.getByRole('status')).toHaveTextContent('Selecione e copie o link abaixo')
  })
})

it('filters campaigns by channel and restores the list from an empty search', async () => {
  const user = userEvent.setup()
  render(<CampaignDirectory campaigns={[campaign, { ...campaign, id: 'meta', name: 'Campanha Meta', channel: 'META_ADS' }]} />)
  await user.selectOptions(screen.getByLabelText('Canal'), 'META_ADS')
  expect(screen.queryByRole('link', { name: 'Founders' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Campanha Meta' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Buscar campanha'), 'inexistente')
  expect(screen.getByText('Nenhuma campanha encontrada')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Limpar filtros' }))
  expect(screen.getByRole('link', { name: 'Founders' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Campanha Meta' })).toBeInTheDocument()
})
