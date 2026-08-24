import { describe, expect, it } from 'vitest'
import { fetchWithinBudget } from './fetch-budget'

describe('fetchWithinBudget', () => {
  it('returns the response untouched when the request settles in time', async () => {
    const response = new Response('ok')
    const result = await fetchWithinBudget(async () => response, 'https://example.test', {}, 1000)
    expect(result).toBe(response)
  })

  it('rejects as a failed portal request when the request outlives the budget', async () => {
    await expect(
      fetchWithinBudget(() => new Promise<Response>(() => {}), 'https://example.test', {}, 10),
    ).rejects.toThrow('PORTAL_REQUEST_FAILED')
  })

  /// Rejecting alone would leave the carrier request in flight, still holding the
  /// tab's connection and still able to deliver a body nobody reads. The point of
  /// the budget is to end the attempt, not just to stop waiting on it.
  it('aborts the underlying request when the budget expires', async () => {
    let seen: AbortSignal | undefined
    await expect(
      fetchWithinBudget(
        (_url, init) => {
          seen = init?.signal ?? undefined
          return new Promise<Response>(() => {})
        },
        'https://example.test',
        {},
        10,
      ),
    ).rejects.toThrow('PORTAL_REQUEST_FAILED')
    expect(seen?.aborted).toBe(true)
  })
})
