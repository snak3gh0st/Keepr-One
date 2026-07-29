import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAgent: vi.fn(),
  getStatus: vi.fn(),
}))

vi.mock('@/lib/agent-context', () => ({ getCurrentAgent: mocks.getCurrentAgent }))
vi.mock('@/lib/national-life/interactive-connection-service', () => ({
  getOwnedAttemptStatus: mocks.getStatus,
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCurrentAgent.mockResolvedValue({ id: 'agent-1' })
})

describe('owned National Life attempt status route', () => {
  it('returns only the safe owned status contract with no-store', async () => {
    mocks.getStatus.mockResolvedValue({
      id: 'attempt-1',
      state: 'AWAITING_LOGIN',
      currentOrigin: 'https://auth.nationallife.example',
      safeErrorCode: null,
      expiresAt: new Date('2026-07-28T12:10:00.000Z'),
    })
    const response = await GET(new Request('https://app.keepr.one/api/status'), {
      params: Promise.resolve({ attemptId: 'attempt-1' }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      id: 'attempt-1',
      state: 'AWAITING_LOGIN',
      currentOrigin: 'https://auth.nationallife.example',
      safeErrorCode: null,
      expiresAt: '2026-07-28T12:10:00.000Z',
    })
  })

  it('returns the same 404 for missing and non-owned attempts', async () => {
    mocks.getStatus.mockRejectedValue(new Error('not found'))
    const response = await GET(new Request('https://app.keepr.one/api/status'), {
      params: Promise.resolve({ attemptId: 'attempt-other' }),
    })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })
})
