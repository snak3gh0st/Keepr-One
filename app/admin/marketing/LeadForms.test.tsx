// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeadFollowUpForm, LeadNoteForm } from './LeadForms'

const mocks = vi.hoisted(() => ({ update: vi.fn(), note: vi.fn() }))
vi.mock('./actions', () => ({ updateLeadAction: mocks.update, addLeadNoteAction: mocks.note }))
vi.mock('@/components/i18n/LanguageProvider', () => ({ useI18n: () => ({ copy: (pt: string) => pt, language: 'PT' }) }))
const lead = { id: 'lead-1', name: 'Contato teste', email: 'contact@example.com', phone: '+12015550123', status: 'NEW' as const, source: 'FOUNDERS', createdAt: '2026-09-10T12:00:00Z', nextContactAt: null, campaign: { id: 'founders-program', name: 'Founders' }, owner: null }
afterEach(cleanup)
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({ ok: true }); mocks.note.mockResolvedValue({ ok: true }) })

describe('Marketing lead follow-up', () => {
  it('converts New York appointment time to UTC and submits the owner and stage', async () => {
    render(<LeadFollowUpForm lead={lead} owners={[{ id: 'admin-1', name: 'Admin' }]} />)
    fireEvent.change(screen.getByLabelText('Etapa do lead'), { target: { value: 'QUALIFIED' } })
    fireEvent.change(screen.getByLabelText('Responsável pelo contato'), { target: { value: 'admin-1' } })
    fireEvent.change(screen.getByLabelText('Próximo contato'), { target: { value: '2026-07-10T14:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar acompanhamento' }))
    await screen.findByRole('status')
    const data = mocks.update.mock.calls[0][0] as FormData
    expect(Object.fromEntries(data)).toMatchObject({ id: 'lead-1', status: 'QUALIFIED', ownerId: 'admin-1', nextContactAt: '2026-07-10T18:30:00.000Z' })
  })
  it('rejects a nonexistent local time during daylight saving transition', async () => {
    render(<LeadFollowUpForm lead={lead} owners={[]} />)
    fireEvent.change(screen.getByLabelText('Próximo contato'), { target: { value: '2027-03-14T02:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar acompanhamento' }))
    expect(await screen.findByText('Escolha uma data e um horário válidos em Nova York.')).toBeVisible()
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('keeps the note after a failed save and clears it only on success', async () => {
    mocks.note.mockResolvedValueOnce({ ok: false, message: 'Tente novamente.' })
    render(<LeadNoteForm leadId="lead-1" />)
    fireEvent.change(screen.getByLabelText('Adicionar nota interna'), { target: { value: 'Retornar amanhã, após a reunião.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar nota' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Adicionar nota interna')).toHaveValue('Retornar amanhã, após a reunião.')
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar nota' }))
    await waitFor(() => expect(screen.getByLabelText('Adicionar nota interna')).toHaveValue(''))
    expect(mocks.note.mock.calls[1][0].get('leadId')).toBe('lead-1')
  })
})
