import { GoogleApiError, GoogleSyncTokenExpiredError, googleErrorCode } from './errors'

export type GoogleFetch = typeof fetch

async function parseBody(response: Response) {
  if (response.status === 204) return null
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}
export async function googleFetchJson<T>(
  fetchImpl: GoogleFetch,
  url: string | URL,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
  })
  const body = await parseBody(response)
  if (!response.ok) {
    if (response.status === 410) throw new GoogleSyncTokenExpiredError(body)
    const code = googleErrorCode(body) ?? `HTTP_${response.status}`
    throw new GoogleApiError({
      message: `Google API request failed (${code})`,
      status: response.status,
      code,
      responseBody: body,
    })
  }
  return body as T
}

export function withQuery(url: string, query: Record<string, string | number | boolean | undefined>) {
  const result = new URL(url)
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) result.searchParams.set(name, String(value))
  }
  return result
}
