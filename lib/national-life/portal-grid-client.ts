// Reads the National Life agent-portal DataTables grids through the portal's own
// JSON endpoint instead of scraping the rendered table.
//
// The payload carries an opaque `DatatableId` that identifies the grid, so rather
// than reconstruct the request we let the page issue its own first call, capture
// that exact body, and replay it with a shifted `start`. That keeps us correct
// even if the carrier adds columns or filters.
export const NATIONAL_LIFE_GRID_ENDPOINT_PATH = '/agent/Datatable/GetJsonResult'

export const NATIONAL_LIFE_GRIDS = {
  NEW_BUSINESS: '/agent/book-of-business/new-business/all-new-business-cases',
  RECENTLY_CLOSED: '/agent/book-of-business/new-business/recently-closed-cases',
  INFORCE_CLIENTS: '/agent/book-of-business/inforce-book/all-clients',
} as const

export type NationalLifeGridKey = keyof typeof NATIONAL_LIFE_GRIDS

export type GridRow = Record<string, unknown>

export type GridPayload = {
  recordsTotal?: number
  recordsFiltered?: number
  data?: GridRow[]
}

// Minimal surface of the Playwright page the client needs, so it can be tested
// without a browser.
export type GridPage = {
  url(): string
  goto(url: string, options?: { waitUntil?: 'domcontentloaded'; timeout?: number }): Promise<unknown>
  waitForRequest(
    predicate: (request: { url(): string; method(): string }) => boolean,
    options?: { timeout?: number },
  ): Promise<{ url(): string; postData(): string | null; headers(): Record<string, string> }>
  waitForTimeout(ms: number): Promise<void>
  request: {
    post(
      url: string,
      options: { data: unknown; headers?: Record<string, string> },
    ): Promise<{ ok(): boolean; status(): number; json(): Promise<unknown> }>
  }
}

export class NationalLifeGridError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function asPayload(value: unknown): GridPayload {
  if (!value || typeof value !== 'object') {
    throw new NationalLifeGridError('GRID_PAYLOAD_INVALID', 'Grid response was not an object')
  }
  return value as GridPayload
}

/// Shifts the captured DataTables body to a new offset. Returns a fresh object so
/// the captured template is never mutated across pages.
export function withOffset(template: unknown, start: number, length: number): unknown {
  const cloned = structuredClone(template) as {
    objJsonModel?: { start?: number; length?: number; draw?: number }
  }
  if (!cloned.objJsonModel || typeof cloned.objJsonModel !== 'object') {
    throw new NationalLifeGridError(
      'GRID_TEMPLATE_INVALID',
      'Captured grid request had no objJsonModel envelope',
    )
  }
  cloned.objJsonModel.start = start
  cloned.objJsonModel.length = length
  cloned.objJsonModel.draw = Math.floor(start / Math.max(length, 1)) + 1
  return cloned
}

export function rowsFrom(payload: GridPayload): GridRow[] {
  return Array.isArray(payload.data) ? payload.data : []
}

export type FetchGridOptions = {
  pageSize?: number
  maxRows?: number
  settleMs?: number
  timeoutMs?: number
}

/// Loads a grid page, captures its own first JSON call, then pages through the
/// remainder. Returns every row the carrier reports for that grid.
export async function fetchNationalLifeGrid(
  page: GridPage,
  gridPath: string,
  portalLoginUrl: string,
  options: FetchGridOptions = {},
): Promise<{ rows: GridRow[]; recordsTotal: number; endpoint: string }> {
  const pageSize = options.pageSize ?? 100
  const maxRows = options.maxRows ?? 10_000
  const timeoutMs = options.timeoutMs ?? 45_000

  const target = new URL(gridPath, portalLoginUrl).toString()
  const pendingRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().includes(NATIONAL_LIFE_GRID_ENDPOINT_PATH),
    { timeout: timeoutMs },
  )

  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs })

  let captured: {
    url(): string
    postData(): string | null
    headers(): Record<string, string>
  }
  try {
    captured = await pendingRequest
  } catch {
    throw new NationalLifeGridError(
      'GRID_REQUEST_NOT_OBSERVED',
      `Grid at ${gridPath} never issued its JSON request`,
    )
  }

  const rawBody = captured.postData()
  if (!rawBody) {
    throw new NationalLifeGridError('GRID_REQUEST_EMPTY', 'Grid request carried no body')
  }

  let template: unknown
  try {
    template = JSON.parse(rawBody)
  } catch {
    throw new NationalLifeGridError('GRID_REQUEST_UNPARSEABLE', 'Grid request body was not JSON')
  }

  const endpoint = captured.url()
  // Reuse the page's own headers so the antiforgery token and content type match.
  const capturedHeaders = captured.headers()
  const headers: Record<string, string> = {
    'content-type': capturedHeaders['content-type'] ?? 'application/json',
  }
  for (const name of ['__requestverificationtoken', 'x-requested-with', 'requestverificationtoken']) {
    const value = capturedHeaders[name]
    if (value) {
      headers[name] = value
    }
  }

  const rows: GridRow[] = []
  let recordsTotal = 0
  let start = 0

  while (start < maxRows) {
    const response = await page.request.post(endpoint, {
      data: withOffset(template, start, pageSize),
      headers,
    })

    if (!response.ok()) {
      throw new NationalLifeGridError(
        'GRID_REQUEST_REJECTED',
        `Grid endpoint returned HTTP ${response.status()}`,
      )
    }

    const payload = asPayload(await response.json())
    if (typeof payload.recordsTotal === 'number') {
      recordsTotal = payload.recordsTotal
    }

    const pageRows = rowsFrom(payload)
    rows.push(...pageRows)

    // Stop on a short page as well as on the reported total: a grid that reports
    // nothing still terminates.
    if (pageRows.length < pageSize) {
      break
    }
    start += pageSize
    if (recordsTotal && rows.length >= recordsTotal) {
      break
    }
  }

  return { rows, recordsTotal: recordsTotal || rows.length, endpoint }
}
