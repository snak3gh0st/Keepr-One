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
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
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
  it('shows friendly credits and distinguishes sending uncertainty', async () => {
    render(<FollowupWorkspace initialData={{ ...view, jobs: [{ id: 'job', batchId: 'batch', customerName: 'Ana Teste', status: 'UNKNOWN', conversationId: '9', content: 'Olá, Ana!',
      inputTokens: 616, outputTokens: 55, creditState: 'SPENT', billedTokens: 671, reservedTokens: 960, errorCode: 'SEND_UNCONFIRMED', createdAt: '2026-09-04' }] }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Atividades' }))
    expect(screen.getByText(/7 créditos utilizados/)).toBeInTheDocument()
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

const candidates = (count: number) => Array.from({ length: count }, (_, i) => ({ ...view.candidates[0], id: `policy:${i}`, customerName: `Cliente ${String(i).padStart(3, '0')}`, fingerprint: String(i).padStart(64, '0') }))

describe('prioritized queue and explicit batches', () => {
  it('shows ready contacts first, pages at 25 and keeps blocked contacts searchable', async () => {
    const rows = candidates(60)
    rows[0] = { ...rows[0], blockedReason: 'PHONE_REQUIRED', phone: null }
    render(<FollowupWorkspace initialData={{ ...view, candidates: rows }} />)
    expect(screen.getAllByRole('article')).toHaveLength(25)
    expect(screen.queryByRole('heading', { name: 'Cliente 000' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    expect(screen.getByRole('heading', { name: 'Cliente 026' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Corrigir cadastro/ }))
    expect(screen.getByRole('heading', { name: 'Cliente 000' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corrigir telefone' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled()
  })
  it('selects only the affordable contacts and sends exactly the reviewed selection', async () => {
    const data = { ...view, candidates: candidates(30), balance: { ...view.balance, available: 866 } }
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => Response.json(options?.method === 'POST' ? { batchId: 'batch' } : data))
    vi.stubGlobal('fetch', fetch)
    render(<FollowupWorkspace initialData={data} />)
    expect(screen.getByRole('button', { name: /Iniciar follow-up/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar dentro do saldo' }))
    expect(screen.getAllByRole('checkbox').filter(c => (c as HTMLInputElement).checked)).toHaveLength(4)
    expect(fetch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar follow-up · 4' }))
    const posts = fetch.mock.calls.filter(c => c[1]?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1]!.body as string).candidates.map((c: { id: string }) => c.id)).toEqual(['policy:0', 'policy:1', 'policy:2', 'policy:3'])
    await waitFor(() => expect(screen.getByRole('button', { name: /Iniciar follow-up/ })).toBeDisabled())
  })
  it('caps batches at 25 and does not authorize using a rounded balance', async () => {
    const { unmount } = render(<FollowupWorkspace initialData={{ ...view, candidates: candidates(40), balance: { ...view.balance, available: 100000 } }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar dentro do saldo' }))
    expect(screen.getByRole('button', { name: 'Iniciar follow-up · 25' })).toBeEnabled()
    unmount()
    render(<FollowupWorkspace initialData={{ ...view, balance: { ...view.balance, available: 191 } }} />)
    expect(screen.getByRole('button', { name: 'Selecionar dentro do saldo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Fazer com IA/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Abrir WhatsApp' })).toBeEnabled()
  })
  it('selects from the visible filter without sending and preserves selection across pages', async () => {
    render(<FollowupWorkspace initialData={{ ...view, candidates: candidates(40) }} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Cliente 000' }))
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Cliente 025' }))
    expect(screen.getByRole('button', { name: 'Iniciar follow-up · 2' })).toBeEnabled()
    await userEvent.type(screen.getByRole('searchbox'), 'Cliente 030')
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar dentro do saldo' }))
    expect(screen.getByRole('checkbox', { name: 'Selecionar Cliente 030' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Iniciar follow-up · 1' })).toBeEnabled()
  })
  it('blocks an outdated selection after refreshing facts and retains its original fingerprint', async () => {
    const changed = { ...view, candidates: [{ ...view.candidates[0], fingerprint: 'x'.repeat(64) }] }
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => Response.json(options?.method === 'POST' ? { ok: true } : changed))
    vi.stubGlobal('fetch', fetch)
    render(<FollowupWorkspace initialData={view} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Ana Teste' }))
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Um contato selecionado mudou'))
    expect(screen.getByRole('button', { name: /Iniciar follow-up/ })).toBeDisabled()
    expect(fetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Limpar seleção' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('saves a phone without starting a follow-up', async () => {
    const data = { ...view, candidates: [{ ...view.candidates[0], phone: null, blockedReason: 'PHONE_REQUIRED' }] }
    const fetch = vi.fn(async (_url: unknown, options?: RequestInit) => Response.json(options?.method === 'POST' ? { ok: true } : view))
    vi.stubGlobal('fetch', fetch)
    render(<FollowupWorkspace initialData={data} />)
    await userEvent.click(screen.getByRole('button', { name: /Corrigir cadastro/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Corrigir telefone' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Telefone com código do país' }), '+1 407 555 0100')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar telefone' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Telefone salvo'))
    expect(fetch.mock.calls.filter(c => c[1]?.method === 'POST').map(c => JSON.parse(c[1]!.body as string))).toEqual([{ action: 'phone', candidateId: 'policy:one', fingerprint: 'f'.repeat(64), phone: '+1 407 555 0100' }])
  })
})
