// Reads the National Life agent-portal DataTables grids through the portal's own
// JSON endpoint instead of scraping the rendered table.
//
// The payload carries an opaque `DatatableId` that identifies the grid, so rather
// than reconstruct the request we let the page issue its own first call, capture
// that exact body, and replay it with a shifted `start`. That keeps us correct
// even if the carrier adds columns or filters.
export const NATIONAL_LIFE_GRID_ENDPOINT_PATH = '/agent/Datatable/GetJsonResult'

export const NATIONAL_LIFE_GRIDS = {
  // Server-rendered portal surfaces. They use the same source-key catalogue so
  // local connector envelopes remain server-authorized, but are captured with
  // READ_PAGE rather than replaying the DataTables endpoint.
  AGENT_DASHBOARD: '/agent/',
  // New business pipeline.
  NEW_BUSINESS: '/agent/book-of-business/new-business/all-new-business-cases',
  RECENTLY_CLOSED: '/agent/book-of-business/new-business/recently-closed-cases',
  PLACEMENT_REPORT: '/agent/book-of-business/new-business/placement-report',
  INFORMAL_REQUESTS: '/agent/book-of-business/new-business/informal-request',
  TRANSFER_COMPANY_INFORMATION:
    '/agent/book-of-business/new-business/Transfer-Company-Information',
  TRANSFERS_EXCHANGES: '/agent/book-of-business/new-business/transfers-exchanges',
  // Inforce book — the basis for payment and commission reconciliation.
  // The portal redirects the menu route to the actual agent grid surface. The
  // final segment is part of the authenticated page route, not decoration: the
  // connector must wait for this URL before asking the page bridge to extract.
  INFORCE_CLIENTS:
    '/agent/book-of-business/inforce-book/all-clients/all-clients-agent',
  POLICY_PAYMENT_HISTORY: '/agent/book-of-business/inforce-book/policy-payment-history',
  DAILY_UNIT_VALUES: '/agent/book-of-business/inforce-book/daily-unit-values',
  PIP_CONTRIBUTION_INCREASE:
    '/agent/book-of-business/inforce-book/pip-contribution-increase',
  ANNUITY_PAST_DUE_CONTRIBUTIONS:
    '/agent/book-of-business/inforce-book/annuity-flow-report/past-due-contribution',
  ANNUITY_PAYROLL_FLOW_CHANGES:
    '/agent/book-of-business/inforce-book/annuity-flow-report/payroll-flow-changes',
  PREMIUM_REPORT_AGENCY: '/agent/book-of-business/inforce-book/premium-report-agency',
  LIFE_PENDING_LAPSE: '/agent/book-of-business/inforce-book/life-pending-lapse-report',
  LIFE_PERSISTENCY: '/agent/book-of-business/inforce-book/life-persistency-report',
  CORRESPONDENCE: '/agent/book-of-business/inforce-book/correspondence',
  PIP_PENDING: '/agent/book-of-business/inforce-book/pip-pending-report',
  // The follow-up log: client email, phone and free-text notes, which no other
  // grid carries.
  CLIENT_INTELLIGENCE: '/agent/book-of-business/client-intelligence',
  // Compensation.
  COMMISSIONS_OVERVIEW: '/agent/compensation/commissions/overview',
  PAID_COMMISSIONS: '/agent/compensation/commissions/paid-commissions',
  COMMISSIONS_EARNING_REPORT:
    '/agent/compensation/commissions/paid-commissions/commissions-earning-report',
  COMMISSIONS_POLICY_HISTORY:
    '/agent/compensation/commissions/paid-commissions/commissions-policy-history',
  // Maps the `GlobalId` that every commission row carries to a payee name.
  COMMISSIONS_PAYMENT_PORTAL:
    '/agent/compensation/commissions/paid-commissions/commissions-payment-portal',
  PROJECTED_COMMISSIONS: '/agent/compensation/commissions/projected-commissions',
  PAYABLE_GROSS_COMMISSIONS:
    '/agent/compensation/commissions/projected-commissions/payable-gross-commissions',
  // Redirects to `/personal`; gross pending split by product line.
  PENDING_GROSS_COMMISSIONS:
    '/agent/compensation/commissions/projected-commissions/pending-gross-commissions',
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

// A runaway-pagination backstop, not a business limit. The inforce book alone
// reports 10272 rows, so a 10000 ceiling silently dropped 272 of them.
const DEFAULT_MAX_ROWS = 100_000

/// Loads a grid page, captures its own first JSON call, then pages through the
/// remainder. Returns every row the carrier reports for that grid.
export async function fetchNationalLifeGrid(
  page: GridPage,
  gridPath: string,
  portalLoginUrl: string,
  options: FetchGridOptions = {},
): Promise<{
  rows: GridRow[]
  recordsTotal: number
  endpoint: string
  truncated: boolean
}> {
  const pageSize = options.pageSize ?? 100
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS
  const timeoutMs = options.timeoutMs ?? 45_000

  const target = new URL(gridPath, portalLoginUrl).toString()
  // The catch is attached before any await: a grid that never fires the request
  // would otherwise leave this promise floating and take the process down with an
  // unhandled rejection once it times out.
  const pendingRequest = page
    .waitForRequest(
      (request) =>
        request.method() === 'POST' && request.url().includes(NATIONAL_LIFE_GRID_ENDPOINT_PATH),
      { timeout: timeoutMs },
    )
    .catch(() => null)

  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
  } catch (error) {
    await pendingRequest
    // Keep the underlying reason: a navigation aborted by the origin guard and a
    // slow report page are the same symptom here but need opposite fixes.
    throw new NationalLifeGridError(
      'GRID_PAGE_UNREACHABLE',
      `Could not open ${gridPath}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    )
  }

  const captured = await pendingRequest
  if (!captured) {
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

  const resolvedTotal = recordsTotal || rows.length
  return {
    rows,
    recordsTotal: resolvedTotal,
    endpoint,
    // Surfaced rather than left implicit: a caller must be able to tell a
    // complete extraction from one the backstop cut short.
    truncated: rows.length < resolvedTotal,
  }
}
