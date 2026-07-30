import { describe, expect, it, vi } from 'vitest'
import { persistRefreshedSessionContext } from './persist-session-context'

const env = { sessionScopeId: 'scope', sessionKeyVersion: 'v1', sessionKeys: {}, portalOrigins: [] }

describe('persistRefreshedSessionContext', () => {
  it('reports a capture failure instead of throwing', async () => {
    // The extraction has already succeeded by the time this runs. Letting it
    // throw would turn a good run into a failed one over bookkeeping.
    const result = await persistRefreshedSessionContext({
      steelSessionId: 'steel-1',
      env: env as never,
      stored: { id: 'session-1', agentId: 'agent-1' },
      prisma: {} as never,
      capture: vi.fn(async () => {
        throw new Error('steel went away')
      }),
    })

    expect(result).toEqual({ sessionRefreshFailed: 'steel went away' })
  })

  it('reports a store failure the same way', async () => {
    const result = await persistRefreshedSessionContext({
      steelSessionId: 'steel-1',
      env: env as never,
      stored: { id: 'session-1', agentId: 'agent-1' },
      prisma: {} as never,
      // A context that encryptBrowserContext will reject, standing in for any
      // failure downstream of a successful capture.
      capture: vi.fn(async () => ({ cookies: 'not-a-context' })),
    })

    expect(result).toHaveProperty('sessionRefreshFailed')
    expect(result).not.toHaveProperty('sessionRefreshed')
  })

  it('passes the steel session id and env through to the capturer', async () => {
    const capture = vi.fn(async () => {
      throw new Error('stop here')
    })

    await persistRefreshedSessionContext({
      steelSessionId: 'steel-42',
      env: env as never,
      stored: { id: 'session-1', agentId: 'agent-1' },
      prisma: {} as never,
      capture,
    })

    expect(capture).toHaveBeenCalledWith('steel-42', env)
  })
})
