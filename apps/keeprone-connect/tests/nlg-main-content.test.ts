import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/grid-extraction', () => ({
  createGridExtractionRunner: () => ({ begin: vi.fn() }),
}))

const NLG = 'https://www.nationallife.com'
const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>()
const portalFetch = vi.fn()
const posted: Array<{ channel: string; payload: Record<string, unknown> }> = []

class FakeXMLHttpRequest {
  open() {}
  setRequestHeader() {}
  send() {}
}

beforeEach(() => {
  vi.resetModules()
  listeners.clear()
  posted.length = 0
  portalFetch.mockReset()

  const fakeWindow = {
    fetch: portalFetch,
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, listener: (event: Record<string, unknown>) => void) => {
      const registered = listeners.get(type) ?? []
      registered.push(listener)
      listeners.set(type, registered)
    },
    postMessage: (message: { channel: string; payload: Record<string, unknown> }) => {
      posted.push(message)
    },
  }

  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('location', {
    origin: NLG,
    href: `${NLG}/agent/book-of-business/inforce-book/correspondence`,
    pathname: '/agent/book-of-business/inforce-book/correspondence',
  })
  vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('defineContentScript', (config: unknown) => config)
})

describe('National Life document viewer request', () => {
  it('requests one correspondence document without the merge-PDF mode', async () => {
    const viewerId = 'a'.repeat(32)
    portalFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        redirectUrl: `/agent/correspondence/documentviewer?id=${viewerId}`,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('%PDF-1.7\n'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }))

    const contentScript = (await import('../entrypoints/nlg-main.content')).default as unknown as {
      main: () => void
    }
    contentScript.main()

    const messageListener = listeners.get('message')?.at(-1)
    expect(messageListener).toBeDefined()
    messageListener?.({
      source: window,
      origin: NLG,
      data: {
        channel: 'FYNTRA_NL_CONNECTOR_V1',
        payload: {
          type: 'BEGIN_DOCUMENT',
          transferId: 'transfer-1',
          encryptedHandle: 'RU5DUllQVEVEX0hBTkRMRQ==',
          token: 't'.repeat(32),
          correlationId: 'correlation-id-1',
        },
      },
    })

    await vi.waitFor(() => {
      expect(posted.some(({ payload }) => payload.type === 'DOCUMENT_DONE')).toBe(true)
    })

    const request = portalFetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      requestParams: ['RU5DUllQVEVEX0hBTkRMRQ=='],
      isMergePdf: false,
      isClientTab: true,
      SubAgentNumber: '',
    })
  })
})
