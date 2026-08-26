import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (value: unknown, sender: unknown, respond: (value: unknown) => void) => boolean | void
let listener: Listener | undefined
const click = vi.fn()

beforeEach(() => {
  vi.resetModules()
  listener = undefined
  click.mockReset()
  vi.stubGlobal('defineContentScript', (config: unknown) => config)
  vi.stubGlobal('document', {
    body: { innerText: 'Start New Case View My Cases', click },
    forms: [],
  })
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener: (value: Listener) => { listener = value } } },
  })
})

describe('iGO read-only content bridge', () => {
  it('returns only a correlated surface enum and never clicks the page', async () => {
    const content = (await import('../entrypoints/igo-bridge.content')).default as unknown as {
      main(): void
    }
    content.main()
    const request = {
      type: 'PROBE_IGO_SURFACE',
      token: 't'.repeat(32),
      correlationId: 'c'.repeat(16),
    }
    const response = await new Promise<unknown>((resolve) => {
      expect(listener?.(request, {}, resolve)).toBe(false)
    })
    expect(response).toEqual({
      ok: true,
      type: 'IGO_SURFACE_PROBED',
      token: request.token,
      correlationId: request.correlationId,
      surface: 'IGO_HOME',
    })
    expect(click).not.toHaveBeenCalled()
    expect(JSON.stringify(response)).not.toContain('Start New Case')
  })

  it('ignores any request that asks the bridge to write', async () => {
    const content = (await import('../entrypoints/igo-bridge.content')).default as unknown as {
      main(): void
    }
    content.main()
    const respond = vi.fn()
    expect(listener?.({
      type: 'PROBE_IGO_SURFACE',
      token: 't'.repeat(32),
      correlationId: 'c'.repeat(16),
      save: true,
    }, {}, respond)).toBeUndefined()
    expect(respond).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
  })
})
