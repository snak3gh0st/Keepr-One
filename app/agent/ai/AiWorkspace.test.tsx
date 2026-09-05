// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiWorkspace } from './AiWorkspace'
import { aiOverviewFixture as view } from '@/tests/fixtures/ai-overview'
const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(Response.json(view)); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('K-Bot AI control center', () => {
  it('shows exact available balance to assistive technology and does not claim replies or recovered revenue', async () => {
    render(<AiWorkspace initialData={view} />)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '663')
    expect(screen.getByText('Créditos da conta')).toBeInTheDocument()
    expect(screen.queryByText(/US\$/)).toBeNull()
    const impact = screen.getByRole('region', { name: 'Resultados confirmados' })
    expect(within(impact).getByText('Envios confirmados')).toBeInTheDocument()
    expect(within(impact).getByText(/Uma entrega ainda não confirma resposta/)).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true)
  })
  it('stops only the selected batch through the existing endpoint and never starts AI', async () => {
    fetchMock.mockImplementation(async (_url, options) => Response.json(options.method === 'POST' ? { cancelled: 1 } : view))
    render(<AiWorkspace initialData={view} />)
    await userEvent.click(screen.getByText('Bruno Exemplo'))
    await userEvent.click(screen.getByRole('button', { name: 'Interromper lote' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Interrupção solicitada'))
    const posts = fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0][0]).toBe('/api/agent/kbot/followups')
    expect(JSON.parse(posts[0][1].body)).toEqual({ action: 'cancel', batchId: view.activity.jobs[0].batchId })
  })
  it('retains consumed credits on a failed action and does not show a prepared-message receipt without content', async () => {
    render(<AiWorkspace initialData={view} />)
    await userEvent.click(screen.getByText('Clara Exemplo'))
    const article = screen.getByText('Clara Exemplo').closest('article')!
    expect(within(article).getByText('<1')).toBeInTheDocument()
    expect(within(article).getByText(/Créditos já utilizados permanecem consumidos/)).toBeInTheDocument()
    expect(within(article).getByText('Mensagem preparada').closest('li')).toHaveAttribute('data-done', 'false')
  })
  it('refetches period and history filters and resets pagination', async () => {
    render(<AiWorkspace initialData={view} />)
    await userEvent.selectOptions(screen.getByLabelText('Período'), '7d')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/agent/ai?period=7d&filter=all&page=0')).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Precisa de atenção' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/agent/ai?period=7d&filter=attention&page=0')).toBe(true))
  })
  it('keeps the last snapshot visible on a refresh failure and recovers on retry', async () => {
    fetchMock.mockRejectedValue(new Error('Offline'))
    render(<AiWorkspace initialData={view} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('última consulta')
    expect(screen.getByText('Ana Exemplo')).toBeInTheDocument()
    fetchMock.mockImplementation(async () => Response.json(view))
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
  it('has an honest disabled state without fabricated zero usage', async () => {
    fetchMock.mockImplementation(async () => Response.json({ enabled: false }))
    render(<AiWorkspace initialData={{ enabled: false }} />)
    expect(screen.getByText('Seu centro AI está em preparação.')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  })
})
