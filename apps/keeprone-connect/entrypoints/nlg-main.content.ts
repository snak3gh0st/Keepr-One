import { NLG_ORIGIN, shouldInstrumentNationalLifePath } from '../lib/constants'
import { createGridExtractionRunner, type RequestTemplate } from '../lib/grid-extraction'
import { parseAbortGridMessage, parseBeginDocumentMessage, parseBeginExportMessage, parseBeginGridMessage } from '../lib/messages'
import { buildOfficialExportRequest } from '../lib/official-export-request'
import { fetchWithinBudget } from '../lib/fetch-budget'

const DATATABLE_PATH = '/agent/Datatable/GetJsonResult'
const DOWNLOAD_EXCEL_PATH = '/agent/Datatable/DownloadExcel'
const DOCUMENT_VIEWER_URL_PATH = '/agent/Document/GetDocumentViewerUrl'
const DOCUMENT_VIEWER_PATH = '/agent/correspondence/documentviewer'
const CHANNEL = 'FYNTRA_NL_CONNECTOR_V1'
const EXPORT_CHUNK_BYTES = 1024 * 1024
/// Generous for an export that works — the portal builds the whole workbook
/// server-side — while staying far short of both the 30-minute run TTL and the
/// ~20-minute carrier session, so a hung request costs one stage instead of the
/// entire sync. Every source after in-force depends on this giving up.
const EXPORT_BUDGET_MS = 3 * 60_000
const EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DOCUMENT_CONTENT_TYPE = 'application/pdf'
const DOCUMENT_BUDGET_MS = 2 * 60_000
const ALLOWED_HEADERS = new Set(['content-type', 'x-requested-with'])

type DatatableConfig = {
  DatatableId?: unknown
  ExportExcelFileName?: unknown
  FieldList?: unknown
  [key: string]: unknown
}

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

function officialExportHeaders(template: RequestTemplate | null): Record<string, string> {
  return {
    ...(template?.headers ?? {}),
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
  }
}

function inforceDatatableConfig(): DatatableConfig | null {
  const models = (window as Window & { datatableViewModel?: unknown }).datatableViewModel
  if (!Array.isArray(models)) return null
  return models.find((model): model is DatatableConfig => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) return false
    const candidate = model as DatatableConfig
    if (candidate.ExportExcelFileName === 'InforceClientInfo') return true
    return Array.isArray(candidate.FieldList) && candidate.FieldList.some((field) =>
      field && typeof field === 'object' && !Array.isArray(field) &&
      (field as { data?: unknown }).data === 'PolicyNumber',
    )
  }) ?? null
}

function currentPortalFilters(): Record<string, unknown>[] {
  const active = (window as Window & { activeFilterItems?: unknown }).activeFilterItems
  if (!Array.isArray(active)) return []
  return active.filter((item): item is Record<string, unknown> => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const value = item as Record<string, unknown>
    return typeof value.Key === 'string' && typeof value.Value === 'string'
  })
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
        // Inforce is currently server-rendered (`IsAjax: false`), so it never
        // emits the GetJsonResult request that the grid reader normally captures.
        // Prefer that captured model when it exists, and otherwise rebuild the
        // same DataTables form from the portal's own datatableViewModel.
        const requestTemplate = template
        const body = buildOfficialExportRequest(
          requestTemplate?.body ?? null,
          inforceDatatableConfig(),
          currentPortalFilters(),
        )
        const response = await fetchWithinBudget(
          originalFetch,
          `${NLG_ORIGIN}${DOWNLOAD_EXCEL_PATH}`,
          {
            method: 'POST',
            headers: officialExportHeaders(requestTemplate),
            body,
            credentials: 'include',
            cache: 'no-store',
          },
          EXPORT_BUDGET_MS,
        )
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

    function safeDocumentViewerUrl(value: unknown): URL | null {
      if (typeof value !== 'string' || value.length > 512) return null
      try {
        const url = new URL(value, NLG_ORIGIN)
        if (url.origin !== NLG_ORIGIN || url.pathname !== DOCUMENT_VIEWER_PATH || url.hash) return null
        const keys = [...url.searchParams.keys()]
        const id = url.searchParams.get('id')
        if (keys.length !== 1 || keys[0] !== 'id' || !id || !/^[0-9a-f]{32}$/.test(id)) return null
        return url
      } catch {
        return null
      }
    }

    function requestDocumentViewerUrl(encryptedHandle: string): Promise<{ redirectUrl?: unknown }> {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('POST', `${NLG_ORIGIN}${DOCUMENT_VIEWER_URL_PATH}`, true)
        request.timeout = DOCUMENT_BUDGET_MS
        request.responseType = 'json'
        request.setRequestHeader('content-type', 'application/json; charset=utf-8')
        request.setRequestHeader('x-requested-with', 'XMLHttpRequest')
        request.onload = () => {
          if (request.status < 200 || request.status >= 300 || !request.response) {
            reject(new Error('PORTAL_REQUEST_FAILED'))
            return
          }
          resolve(request.response as { redirectUrl?: unknown })
        }
        request.onerror = () => reject(new Error('PORTAL_REQUEST_FAILED'))
        request.ontimeout = () => reject(new Error('PORTAL_REQUEST_FAILED'))
        request.send(JSON.stringify({
          requestParams: [encryptedHandle],
          isMergePdf: false,
          isClientTab: true,
          SubAgentNumber: '',
        }))
      })
    }

    async function beginDocument(message: NonNullable<ReturnType<typeof parseBeginDocumentMessage>>) {
      const base = {
        transferId: message.transferId,
        token: message.token,
        correlationId: message.correlationId,
      }
      try {
        const viewerPayload = await requestDocumentViewerUrl(message.encryptedHandle)
        const viewerUrl = safeDocumentViewerUrl(viewerPayload.redirectUrl)
        if (!viewerUrl) throw new Error('INVALID_DOCUMENT_RESPONSE')

        const response = await fetchWithinBudget(
          originalFetch,
          viewerUrl.toString(),
          { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error' },
          DOCUMENT_BUDGET_MS,
        )
        if (!response.ok || (response.url && !safeDocumentViewerUrl(response.url))) {
          throw new Error('PORTAL_REQUEST_FAILED')
        }
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
        if (contentType !== DOCUMENT_CONTENT_TYPE) throw new Error('INVALID_DOCUMENT_RESPONSE')
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (
          bytes.length === 0 ||
          bytes.length > 25 * 1024 * 1024 ||
          new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-'
        ) throw new Error('INVALID_DOCUMENT_RESPONSE')

        post({
          type: 'DOCUMENT_BEGIN',
          ...base,
          contentType: DOCUMENT_CONTENT_TYPE,
          expectedBytes: bytes.length,
          expectedSha256: await sha256Hex(bytes),
        })
        for (let offset = 0, sequence = 0; offset < bytes.length; offset += EXPORT_CHUNK_BYTES, sequence += 1) {
          post({
            type: 'DOCUMENT_CHUNK',
            ...base,
            sequence,
            bytes: Array.from(bytes.slice(offset, offset + EXPORT_CHUNK_BYTES)),
          })
        }
        post({ type: 'DOCUMENT_DONE', ...base })
      } catch (error) {
        post({
          type: 'DOCUMENT_ERROR',
          ...base,
          code: error instanceof Error && error.message === 'PORTAL_REQUEST_FAILED'
            ? 'PORTAL_REQUEST_FAILED'
            : 'INVALID_DOCUMENT_RESPONSE',
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
      const document = parseBeginDocumentMessage(event.data.payload)
      if (document) {
        void beginDocument(document)
        return
      }
      const abort = parseAbortGridMessage(event.data.payload)
      if (abort) runner.abort(abort)
    })
  },
})
