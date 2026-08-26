import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/grid-extraction', () => ({
  createGridExtractionRunner: () => ({ begin: vi.fn() }),
}))

const NLG = 'https://www.nationallife.com'
const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>()
const portalFetch = vi.fn()
const posted: Array<{ channel: string; payload: Record<string, unknown> }> = []
const xhrRequests: Array<{
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
}> = []

class FakeXMLHttpRequest {
  status = 200
  response: unknown = null
  responseType = ''
  timeout = 0
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  private method = ''
  private url = ''
  private headers: Record<string, string> = {}

  open(method: string, url: string | URL) {
    this.method = method
    this.url = String(url)
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value
  }

  send(body: string | null = null) {
    xhrRequests.push({ method: this.method, url: this.url, headers: this.headers, body })
    this.response = {
      redirectUrl: `/agent/correspondence/documentviewer?id=${'a'.repeat(32)}`,
    }
    queueMicrotask(() => this.onload?.())
  }
}

beforeEach(() => {
  vi.resetModules()
  listeners.clear()
  posted.length = 0
  xhrRequests.length = 0
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
    portalFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes('/agent/Document/GetDocumentViewerUrl')) {
        return new Response(JSON.stringify({
          redirectUrl: `/agent/correspondence/documentviewer?id=${viewerId}`,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(new TextEncoder().encode('%PDF-1.7\n'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      })
    })

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

    expect(xhrRequests).toHaveLength(1)
    expect(xhrRequests[0]).toMatchObject({
      method: 'POST',
      url: `${NLG}/agent/Document/GetDocumentViewerUrl`,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-requested-with': 'XMLHttpRequest',
      },
    })
    expect(JSON.parse(String(xhrRequests[0]?.body))).toEqual({
      requestParams: ['RU5DUllQVEVEX0hBTkRMRQ=='],
      isMergePdf: false,
      isClientTab: true,
      SubAgentNumber: '',
    })
    expect(portalFetch).toHaveBeenCalledTimes(1)
    expect(portalFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    })
  })
})
