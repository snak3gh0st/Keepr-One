/// A carrier request that never answers is indistinguishable, from the outside,
/// from one that is merely slow — and the export path had no way to tell them
/// apart. Without a budget the in-force XLSX request could hang forever: no
/// EXPORT_ERROR was ever posted, the stage never settled, and the run sat
/// untouched until the 30-minute TTL killed it. Because that stage is index 2 of
/// 26, every source behind it went unread.
///
/// The budget converts silence into a reportable failure, and aborts the request
/// on the way out so the attempt actually ends instead of lingering on the tab's
/// connection with a body nobody will read.
///
/// The deadline races the request rather than relying on the abort to reject it.
/// Delegating the guarantee to the caller's fetch is the same assumption that
/// produced the original hang: it holds for the platform fetch and for nothing
/// else. Racing makes the budget unconditional — the abort is how the attempt is
/// released, never how the wait ends.
export async function fetchWithinBudget(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  budgetMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('PORTAL_REQUEST_FAILED'))
    }, budgetMs)
  })
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }).catch((error: unknown) => {
        // An abort here is our own deadline firing, already reported by the race.
        // Rethrowing the raw AbortError would surface as a malformed response.
        if (controller.signal.aborted) throw new Error('PORTAL_REQUEST_FAILED')
        throw error
      }),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}
