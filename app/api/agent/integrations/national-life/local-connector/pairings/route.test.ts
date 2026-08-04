import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enabled: vi.fn(),
  currentAgent: vi.fn(),
  createPairing: vi.fn(),
  sameOrigin: vi.fn(),
}))

vi.mock('@/lib/national-life/local-connector/config', () => ({
  isNationalLifeLocalConnectorEnabled: mocks.enabled,
  localConnectorUnavailableResponse: () =>
    Response.json(
      { error: 'NOT_AVAILABLE' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    ),
}))
vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.currentAgent }))
vi.mock('@/lib/national-life/local-connector/pairing', () => ({
  createLocalConnectorPairing: mocks.createPairing,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/security/same-origin-action', () => ({
  assertSameOriginAction: mocks.sameOrigin,
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.enabled.mockReturnValue(false)
  mocks.currentAgent.mockResolvedValue({ id: 'agent-1' })
  mocks.createPairing.mockResolvedValue({
    code: 'NL-secret',
    expiresAt: new Date('2026-08-04T12:00:00Z'),
  })
})

describe('local connector pairing route', () => {
  it('is unavailable by default without touching authentication or storage', async () => {
    const response = await POST(new Request('https://app.keepr.one/api/pairings'))

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.currentAgent).not.toHaveBeenCalled()
    expect(mocks.createPairing).not.toHaveBeenCalled()
  })

  it('creates a pairing when the feature is enabled', async () => {
    mocks.enabled.mockReturnValue(true)
    const response = await POST(
      new Request('https://app.keepr.one/api/pairings', {
        method: 'POST',
        headers: { origin: 'https://app.keepr.one', host: 'app.keepr.one' },
      }),
    )

    expect(response.status).toBe(201)
    expect(mocks.createPairing).toHaveBeenCalledWith({}, { agentId: 'agent-1' })
  })
})
