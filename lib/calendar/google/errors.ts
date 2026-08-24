export class GoogleApiError extends Error {
  readonly status: number
  readonly code: string
  readonly responseBody: unknown
  readonly retryable: boolean

  constructor(input: {
    message: string
    status: number
    code?: string
    responseBody?: unknown
  }) {
    super(input.message)
    this.name = 'GoogleApiError'
    this.status = input.status
    this.code = input.code ?? `HTTP_${input.status}`
    this.responseBody = input.responseBody
    this.retryable = input.status === 408 || input.status === 429 || input.status >= 500
  }
}
export class GoogleReconnectRequiredError extends Error {
  readonly code = 'GOOGLE_RECONNECT_REQUIRED'
  constructor(message = 'Google Calendar authorization must be renewed') {
    super(message)
    this.name = 'GoogleReconnectRequiredError'
  }
}

export class GoogleSyncTokenExpiredError extends GoogleApiError {
  constructor(responseBody?: unknown) {
    super({
      message: 'Google Calendar sync token expired',
      status: 410,
      code: 'SYNC_TOKEN_EXPIRED',
      responseBody,
    })
    this.name = 'GoogleSyncTokenExpiredError'
  }
}

export function googleErrorCode(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const record = body as Record<string, unknown>
  if (typeof record.error === 'string') return record.error
  if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
    const nested = record.error as Record<string, unknown>
    if (typeof nested.status === 'string') return nested.status
    if (typeof nested.message === 'string') return nested.message
    const errors = Array.isArray(nested.errors) ? nested.errors : []
    const first = errors[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const reason = (first as Record<string, unknown>).reason
      if (typeof reason === 'string') return reason
    }
  }
  return null
}
