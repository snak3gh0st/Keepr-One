import { NLG_ORIGIN, shouldInstrumentNationalLifePath } from '../lib/constants'
import { createGridExtractionRunner, type RequestTemplate } from '../lib/grid-extraction'
import { parseAbortGridMessage, parseBeginExportMessage, parseBeginGridMessage } from '../lib/messages'

const DATATABLE_PATH = '/agent/Datatable/GetJsonResult'
const DOWNLOAD_EXCEL_PATH = '/agent/Datatable/DownloadExcel'
const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'
const EXPORT_CHUNK_BYTES = 1024 * 1024
const EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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

    async function sha256Hex(bytes: Uint8Array): Promise<string> {
      const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    }

    async function beginOfficialExport(message: NonNullable<ReturnType<typeof parseBeginExportMessage>>) {
      try {
        const requestTemplate = await waitForTemplate()
        const body = new URLSearchParams(requestTemplate.body)
        body.set('IsEnableContactFields', 'true')
        const response = await originalFetch(`${NLG_ORIGIN}${DOWNLOAD_EXCEL_PATH}`, {
          method: 'POST',
          headers: requestTemplate.headers,
          body: body.toString(),
          credentials: 'include',
          cache: 'no-store',
        })
        if (!response.ok) throw new Error('PORTAL_REQUEST_FAILED')
        const payload = await response.json() as Record<string, unknown>
        if (
          !Array.isArray(payload.FileContents) ||
          !payload.FileContents.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
          typeof payload.FileDownloadName !== 'string' ||
          !/^NLG_InforceClientInfo_[0-9]{8}\.xlsx$/.test(payload.FileDownloadName)
        ) throw new Error('INVALID_EXPORT_RESPONSE')
        const bytes = Uint8Array.from(payload.FileContents)
        if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
          throw new Error('INVALID_EXPORT_RESPONSE')
        }
        const base = {
          gridKey: message.sourceKey,
          token: message.token,
          correlationId: message.correlationId,
        }
        post({
          type: 'EXPORT_BEGIN',
          ...base,
          fileName: payload.FileDownloadName,
          contentType: EXPORT_CONTENT_TYPE,
          expectedBytes: bytes.length,
          expectedSha256: await sha256Hex(bytes),
        })
        for (let offset = 0, sequence = 0; offset < bytes.length; offset += EXPORT_CHUNK_BYTES, sequence += 1) {
          post({
            type: 'EXPORT_CHUNK',
            ...base,
            sequence,
            bytes: Array.from(bytes.slice(offset, offset + EXPORT_CHUNK_BYTES)),
          })
        }
        post({ type: 'EXPORT_DONE', ...base })
      } catch (error) {
        const code = error instanceof Error && error.message === 'TEMPLATE_UNAVAILABLE'
          ? 'TEMPLATE_UNAVAILABLE'
          : error instanceof Error && error.message === 'PORTAL_REQUEST_FAILED'
            ? 'PORTAL_REQUEST_FAILED'
            : 'INVALID_EXPORT_RESPONSE'
        post({
          type: 'EXPORT_ERROR',
          gridKey: message.sourceKey,
          token: message.token,
          correlationId: message.correlationId,
          code,
        })
      }
    }

    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin) return
      if (typeof event.data !== 'object' || event.data === null || event.data.channel !== CHANNEL) return
      const begin = parseBeginGridMessage(event.data.payload)
      if (begin) {
        void runner.begin(begin)
        return
      }
      const beginExport = parseBeginExportMessage(event.data.payload)
      if (beginExport) {
        void beginOfficialExport(beginExport)
        return
      }
      const abort = parseAbortGridMessage(event.data.payload)
      if (abort) runner.abort(abort)
    })
  },
})
