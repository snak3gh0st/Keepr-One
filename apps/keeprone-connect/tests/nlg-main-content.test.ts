import { webcrypto } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const gridRunnerHarness = vi.hoisted(() => ({
  deps: undefined as undefined | {
    fetchPage: (template: { body: string; headers: Record<string, string> }, body: string) => Promise<Response>
  },
}))
const fetchWithinBudgetSpy = vi.hoisted(() => vi.fn())

vi.mock('../lib/grid-extraction', () => ({
  createGridExtractionRunner: (deps: typeof gridRunnerHarness.deps) => {
    gridRunnerHarness.deps = deps
    return { begin: vi.fn() }
  },
}))

vi.mock('../lib/fetch-budget', () => ({
  fetchWithinBudget: fetchWithinBudgetSpy,
}))

const NLG = 'https://www.nationallife.com'
const listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>()
const portalFetch = vi.fn()
const posted: Array<{ channel: string; payload: Record<string, unknown> }> = []
type JQueryAjaxOptions = {
  type: string
  timeout: number
  url: string
  data: string
  cache: boolean
  contentType: string
  dataType: string
  success: (response: { redirectUrl: string }) => void
  error: () => void
}
const jqueryRequests: JQueryAjaxOptions[] = []
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
  jqueryRequests.length = 0
  xhrRequests.length = 0
  portalFetch.mockReset()
  gridRunnerHarness.deps = undefined
  fetchWithinBudgetSpy.mockReset()
  fetchWithinBudgetSpy.mockImplementation(
    (fetchImpl: typeof fetch, url: string, init: RequestInit) => fetchImpl(url, init),
  )

  const fakeWindow = {
    fetch: portalFetch,
    setTimeout,
    clearTimeout,
    jQuery: {
      ajax: (options: JQueryAjaxOptions) => {
        jqueryRequests.push(options)
        queueMicrotask(() => options.success({
          redirectUrl: `/agent/correspondence/documentviewer?id=${'a'.repeat(32)}`,
        }))
        return { abort: vi.fn() }
      },
    },
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

describe('National Life grid request budget', () => {
  it('bounds every DataTables page request so a silent carrier response cannot freeze the run', async () => {
    portalFetch.mockResolvedValue(new Response('{}', { status: 200 }))

    const contentScript = (await import('../entrypoints/nlg-main.content')).default as unknown as {
      main: () => void
    }
    contentScript.main()

    await gridRunnerHarness.deps?.fetchPage(
      { body: 'draw=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      'draw=2',
    )

    expect(fetchWithinBudgetSpy).toHaveBeenCalledWith(
      expect.any(Function),
      `${NLG}/agent/Datatable/GetJsonResult`,
      expect.objectContaining({
        method: 'POST',
        body: 'draw=2',
        credentials: 'include',
        cache: 'no-store',
      }),
      60_000,
    )
  })
})

describe('National Life FlexLife quote request', () => {
  it('posts the sealed request from the authenticated Illustration tool page', async () => {
    const snapshot = {
      schemaVersion: 1,
      illustrationId: 'ill_quote_1',
      request: {
        IssueState: 'FL', FirstName: 'KeeprOne', LastName: 'Test', DateOfBirth: '08/26/1981',
        IssueAge: 45, Gender: 'Male', RateClass: 'Standard_NT', SolveType: 'Specify_Amount',
        Amount: 250000, DeathBenefitOption: 'A_Level', Strategy: 'SP500PointToPointCapFocus',
        Allocation: 100, ProductCode: '956', PremiumMode: 'Monthly',
      },
    }
    portalFetch.mockResolvedValue(new Response(JSON.stringify({
      Success: true, AnnualPremium: 5100,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('location', {
      origin: NLG,
      href: `${NLG}/agent/tools/business-tools/illustrations`,
      pathname: '/agent/tools/business-tools/illustrations',
    })
    const contentScript = (await import('../entrypoints/nlg-main.content')).default as unknown as {
      main: () => void
    }
    contentScript.main()
    listeners.get('message')?.at(-1)?.({
      source: window,
      origin: NLG,
      data: {
        channel: 'FYNTRA_NL_CONNECTOR_V1',
        payload: {
          type: 'EXECUTE_FLEXLIFE_QUOTE', token: 't'.repeat(32),
          correlationId: 'c'.repeat(16),
          inputHash: 'be96cd11f9ca6da7bd5d9734386d5aec91e8c5c8ceeaf70a60e78874333a5558',
          snapshot,
        },
      },
    })

    await vi.waitFor(() => {
      expect(posted.some(({ payload }) => payload.type === 'FLEXLIFE_QUOTE_DONE')).toBe(true)
    })
    expect(fetchWithinBudgetSpy).toHaveBeenCalledWith(
      expect.any(Function),
      `${NLG}/agent/RapidSolve/GetQuote`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify(snapshot.request),
        credentials: 'include',
        cache: 'no-store',
      },
      60_000,
    )
    expect(posted.at(-1)?.payload).toMatchObject({
      type: 'FLEXLIFE_QUOTE_DONE',
      inputHash: 'be96cd11f9ca6da7bd5d9734386d5aec91e8c5c8ceeaf70a60e78874333a5558',
      response: { Success: true, AnnualPremium: 5100 },
    })
  })
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

    expect(jqueryRequests).toHaveLength(1)
    expect(jqueryRequests[0]).toMatchObject({
      type: 'POST',
      url: '/agent/Document/GetDocumentViewerUrl',
      timeout: 120_000,
      cache: false,
      contentType: 'application/json; charset=utf-8',
      dataType: 'json',
    })
    expect(JSON.parse(String(jqueryRequests[0]?.data))).toEqual({
      requestParams: ['RU5DUllQVEVEX0hBTkRMRQ=='],
      isMergePdf: false,
      isClientTab: true,
      SubAgentNumber: '',
    })
    expect(xhrRequests).toHaveLength(0)
    expect(portalFetch).toHaveBeenCalledTimes(1)
    expect(portalFetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    })
  })
})
