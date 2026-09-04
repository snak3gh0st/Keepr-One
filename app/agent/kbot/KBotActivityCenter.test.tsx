// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KBotActivityCenter } from './KBotActivityCenter'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const snapshot = {
  sync: { runId: 'r', state: 'COMPLETED', completed: 14, total: 14, shouldPoll: false },
  illustration: { id: 'i', state: 'NEEDS_YOU' as const, updatedAt: '2026-09-04T12:00:00Z' },
  application: { id: 'a', caseId: 'c', state: 'WORKING' as const, updatedAt: '2026-09-04T12:00:00Z' },
}
describe('unified activities', () => {
  it('groups simultaneous operations and links to the existing continuation routes', async () => {
    render(<KBotActivityCenter jobs={[]} busy={false} onCancel={() => {}} initialCarrier={snapshot} />)
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'Ver resultado' })).toHaveAttribute('href', '/agent/integrations/national-life')
    await userEvent.click(screen.getByRole('button', { name: 'Precisa de você · 1' }))
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Continuar operação' })).toHaveAttribute('href', '/agent/illustrations/i')
    await userEvent.click(screen.getByRole('button', { name: 'Em andamento · 1' }))
    expect(screen.getByRole('link', { name: 'Continuar operação' })).toHaveAttribute('href', '/agent/cases/c')
  })
  it('keeps the last result visible when a later status request fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', fetch)
    render(<KBotActivityCenter jobs={[]} busy={false} onCancel={() => {}} />)
    await screen.findByText('14 de 14 áreas verificadas')
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('última informação conhecida'))
    expect(screen.getByText('14 de 14 áreas verificadas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled()
  })
})
