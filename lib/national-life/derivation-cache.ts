import 'server-only'

/**
 * Carrier snapshots only change when a sync run completes, but the dashboard
 * and the policy pages re-derive them from the raw grid pages on every request
 * — for a full book that is tens of MB of JSON per navigation.
 *
 * This memoizes a derivation against a version string the caller already knows
 * (a stage-completion id, a fetch timestamp). A new sync produces a new version
 * and the old entry is replaced, so freshness follows the data rather than a
 * clock. It deliberately does NOT use the Next data cache: the derived values
 * are multi-megabyte object graphs, and serializing them through an incremental
 * cache would trade one cost for another.
 *
 * In-process by design. A second container derives once on its own, and a
 * deploy starts cold — both are one extra derivation, not a correctness
 * problem, because the version key still decides what is current.
 */

/**
 * Each entry retains a derived object graph built from thousands of carrier
 * rows — several megabytes for a full book. The container runs with no memory
 * limit on a host shared with twenty other services, so this stays deliberately
 * small: it exists to stop the same agent re-deriving on consecutive clicks,
 * not to hold every agent's book at once.
 */
const MAX_ENTRIES = 12

type Entry = { version: string; value: Promise<unknown> }

const store = new Map<string, Entry>()

/**
 * `version === null` means the caller could not establish a version (no
 * completed run yet). That derivation runs uncached rather than risking a stale
 * read under a key that cannot change.
 */
export async function memoizeByVersion<T>(
  scope: string,
  version: string | null,
  produce: () => Promise<T>,
): Promise<T> {
  if (version === null) return produce()

  const hit = store.get(scope)
  if (hit && hit.version === version) {
    // Refresh recency so the eviction below drops genuinely idle scopes.
    store.delete(scope)
    store.set(scope, hit)
    return hit.value as Promise<T>
  }

  // The promise is stored, not its result: two requests arriving on a cold
  // scope — the common case right after a deploy or a new sync — then share one
  // derivation instead of both reading and parsing the same megabytes.
  const pending = produce()
  const entry: Entry = { version, value: pending }
  store.delete(scope)
  store.set(scope, entry)

  // A failed derivation must not be remembered, or the scope stays broken until
  // the next sync changes the version.
  pending.catch(() => {
    if (store.get(scope) === entry) store.delete(scope)
  })

  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next()
    if (oldest.done) break
    store.delete(oldest.value)
  }

  return pending
}

/** Test seam. Never called by application code. */
export function resetDerivationCache(): void {
  store.clear()
}
