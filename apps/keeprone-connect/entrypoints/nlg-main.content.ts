import { NLG_ORIGIN, shouldInstrumentNationalLifePath } from '../lib/constants'
import { createGridExtractionRunner, type RequestTemplate } from '../lib/grid-extraction'
import { parseAbortGridMessage, parseBeginGridMessage } from '../lib/messages'

const DATATABLE_PATH = '/agent/Datatable/GetJsonResult'
const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'
const ALLOWED_HEADERS = new Set(['content-type', 'x-requested-with'])

function allowedHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    ALLOWED_HEADERS.has(lower) ||
    lower.includes('antiforgery') ||
    lower.includes('requestverificationtoken')
  )
}

function safeEndpoint(value: string | URL): boolean {
  try {
    const url = new URL(String(value), location.href)
    return url.origin === NLG_ORIGIN && url.pathname === DATATABLE_PATH
  } catch {
    return false
  }
}

function filteredHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (allowedHeader(name)) safe[name.toLowerCase()] = value
  })
  return safe
}

export default defineContentScript({
  matches: ['https://www.nationallife.com/agent/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    if (!shouldInstrumentNationalLifePath(location.pathname)) return
    let template: RequestTemplate | null = null
    let resolveTemplate: ((value: RequestTemplate) => void) | null = null
    const originalFetch = window.fetch.bind(window)

    function capture(candidate: RequestTemplate) {
      if (template || !candidate.body) return
      template = candidate
      resolveTemplate?.(candidate)
      resolveTemplate = null
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.method === 'POST' && safeEndpoint(request.url)) {
        try {
          capture({ body: await request.clone().text(), headers: filteredHeaders(request.headers) })
        } catch {
          // The carrier request still proceeds; extraction reports a template error later.
        }
      }
      return originalFetch(request)
    }

    const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string; headers: Headers }>()
    const originalOpen = XMLHttpRequest.prototype.open
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader
    const originalSend = XMLHttpRequest.prototype.send

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async = true,
      username?: string | null,
      password?: string | null,
    ) {
      xhrMeta.set(this, { method: method.toUpperCase(), url: String(url), headers: new Headers() })
      return originalOpen.call(this, method, url, async as boolean, username, password)
    }
    XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
      const meta = xhrMeta.get(this)
      if (meta && allowedHeader(name)) meta.headers.set(name, value)
      return originalSetRequestHeader.call(this, name, value)
    }
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = xhrMeta.get(this)
      if (meta?.method === 'POST' && safeEndpoint(meta.url) && typeof body === 'string') {
        capture({ body, headers: filteredHeaders(meta.headers) })
      }
      return originalSend.call(this, body)
    }

    function post(payload: Record<string, unknown>) {
      window.postMessage({ channel: CHANNEL, payload }, location.origin)
    }

    async function waitForTemplate(): Promise<RequestTemplate> {
      if (template) return template
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          resolveTemplate = null
          reject(new Error('TEMPLATE_UNAVAILABLE'))
        }, 30_000)
        resolveTemplate = (value) => {
          window.clearTimeout(timer)
          resolve(value)
        }
      })
    }

    const runner = createGridExtractionRunner({
      waitForTemplate,
      fetchPage: (requestTemplate, body) =>
        originalFetch(`${NLG_ORIGIN}${DATATABLE_PATH}`, {
          method: 'POST',
          headers: requestTemplate.headers,
          body,
          credentials: 'include',
          cache: 'no-store',
        }),
      post,
    })

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return
      if (typeof event.data !== 'object' || event.data === null || event.data.channel !== CHANNEL) return
      const begin = parseBeginGridMessage(event.data.payload)
      if (begin) {
        void runner.begin(begin)
        return
      }
      const abort = parseAbortGridMessage(event.data.payload)
      if (abort) runner.abort(abort)
    })
  },
})
