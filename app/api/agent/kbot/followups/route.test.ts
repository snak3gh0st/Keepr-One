import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ agent: vi.fn(), start: vi.fn(), open: vi.fn() }))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.agent }))
vi.mock('@/lib/kbot-followup/service', () => ({ startFollowups: mocks.start, openManualConversation: mocks.open, cancelBatch: vi.fn(), changeContactPreference: vi.fn() }))
vi.mock('@/lib/kbot-followup/domain', async orig => ({ ...await orig<typeof import('@/lib/kbot-followup/domain')>(), featureEnabled: () => true }))
import { POST } from './route'
const request = (body: unknown, origin = 'https://keepr.test') => new Request('https://keepr.test/api/agent/kbot/followups', {
  method: 'POST', headers: { 'content-type': 'application/json', host: 'keepr.test', origin }, body: JSON.stringify(body),
})
beforeEach(() => { vi.clearAllMocks(); mocks.agent.mockResolvedValue({ id: 'owner' }); mocks.open.mockResolvedValue({ href: '/agent/mensagens?conversation=1' }) })
describe('follow-up authorization route', () => {
  it('rejects a cross-origin mutation before resolving account context', async () => {
    expect((await POST(request({ action: 'open', candidateId: 'policy:1' }, 'https://evil.test'))).status).toBe(403)
    expect(mocks.agent).not.toHaveBeenCalled()
  })
  it('rejects injected recipient or agent fields', async () => {
    const response = await POST(request({ action: 'open', candidateId: 'policy:1', agentId: 'other', phone: '+12345678' }))
    expect(response.status).toBe(400); expect(mocks.open).not.toHaveBeenCalled()
  })
  it('derives agent from session and never starts AI for manual action', async () => {
    expect((await POST(request({ action: 'open', candidateId: 'policy:1' }))).status).toBe(200)
    expect(mocks.open).toHaveBeenCalledWith('owner', 'policy:1')
    expect(mocks.start).not.toHaveBeenCalled()
  })
  it('does not permit unauthenticated manual or AI operations', async () => {
    mocks.agent.mockRejectedValue(new Error('Not authenticated'))
    expect((await POST(request({ action: 'open', candidateId: 'policy:1' }))).status).toBe(503)
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
