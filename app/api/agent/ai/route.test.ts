import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ agent: vi.fn(), overview: vi.fn(), enabled: vi.fn() }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.agent }))
vi.mock('@/lib/kbot-followup/domain', () => ({ featureEnabled: mocks.enabled }))
vi.mock('@/lib/kbot-ai/service', () => ({ getAiOverview: mocks.overview }))
import { GET } from './route'
beforeEach(() => { vi.clearAllMocks(); mocks.agent.mockResolvedValue({ id: 'owner' }); mocks.enabled.mockReturnValue(true); mocks.overview.mockResolvedValue({ enabled: true }) })
const request = (query = '') => new Request(`https://keepr.test/api/agent/ai${query}`)
describe('AI overview authorization', () => {
  it('derives scope from the session and prevents response caching', async () => {
    const response = await GET(request('?period=7d&filter=attention&page=2'))
    expect(mocks.overview).toHaveBeenCalledWith('owner', { period: '7d', filter: 'attention', page: 2 })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it.each(['?agentId=other', '?period=all', '?page=-1', '?page=1.5', '?page=10001', '?filter=bad'])('rejects unsupported query %s', async query => {
    expect((await GET(request(query))).status).toBe(400)
    expect(mocks.overview).not.toHaveBeenCalled()
  })
  it('returns no product data without an authenticated agent', async () => {
    mocks.agent.mockRejectedValue(new Error('Not authenticated'))
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(mocks.overview).not.toHaveBeenCalled()
    expect(await response.json()).toEqual({ error: 'AI_OVERVIEW_UNAVAILABLE' })
  })
  it('does not query unenabled follow-up tables', async () => {
    mocks.enabled.mockReturnValue(false)
    expect(await (await GET(request())).json()).toEqual({ enabled: false })
    expect(mocks.overview).not.toHaveBeenCalled()
  })
})
