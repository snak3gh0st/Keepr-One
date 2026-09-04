// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FollowupWorkspace, type FollowupView } from './FollowupWorkspace'
const view: FollowupView = { enabled: true, aiAvailable: true, reservationPerMessage: 192,
  balance: { available: 1000, reserved: 0, spent: 0 }, catalog: null, hasSubscription: false, jobs: [],
  candidates: [{ id: 'policy:one', customerName: 'Ana Teste', phone: '+14075550100', reason: 'LAPSE_WARNING', fingerprint: 'f'.repeat(64), blockedReason: null,
    sourceHref: '/agent/policies/one', sourceAt: '2026-09-04T12:00:00Z' }],
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('manual and AI follow-up experience', () => {
  it('keeps manual contact available with zero credits', () => {
    render(<FollowupWorkspace initialData={{ ...view, balance: { available: 0, reserved: 0, spent: 0 } }} />)
    expect(screen.getByRole('button', { name: 'Abrir WhatsApp' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Fazer com IA/ })).toBeDisabled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
  it('starts with one button click and no second confirmation', async () => {
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => Response.json(options?.method === 'POST' ? { batchId: 'batch' } : view))
    vi.stubGlobal('fetch', fetch)
    render(<FollowupWorkspace initialData={view} />)
    await userEvent.click(screen.getByRole('button', { name: /Fazer com IA/ }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Follow-up iniciado'))
    const posts = fetch.mock.calls.filter(c => c[1]?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1]!.body as string)).toMatchObject({ action: 'start', language: 'PT', candidates: [{ id: 'policy:one', fingerprint: 'f'.repeat(64) }] })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('shows friendly credits and distinguishes sending uncertainty', () => {
    render(<FollowupWorkspace initialData={{ ...view, jobs: [{ id: 'job', batchId: 'batch', customerName: 'Ana Teste', status: 'UNKNOWN', conversationId: '9', content: 'Olá, Ana!',
      inputTokens: 616, outputTokens: 55, creditState: 'SPENT', billedTokens: 671, reservedTokens: 960, errorCode: 'SEND_UNCONFIRMED', createdAt: '2026-09-04' }] }} />)
    expect(screen.getByText('7 créditos utilizados')).toBeInTheDocument()
    expect(screen.getByText('Envio não confirmado')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir conversa' })).toHaveAttribute('href', '/agent/mensagens?conversation=9')
  })
  it('manual opening does not invoke start or generation', async () => {
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => Response.json(options?.method === 'POST' ? { ok: true } : view))
    vi.stubGlobal('fetch', fetch)
    render(<FollowupWorkspace initialData={{ ...view, aiAvailable: false }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ action: 'open', candidateId: 'policy:one' })
  })
})
