/// Serialises everything that opens a carrier browser.
///
/// Steel runs a single Chrome for this deployment, so two jobs that each create a
/// session fight over it: when one released, the other died mid-navigation with
/// "Target page, context or browser has been closed" — that is how a keep-alive
/// tick killed a running extraction. The interactive-login check alone was not
/// enough, because it does not see other scripts.
///
/// A Postgres advisory lock is used rather than a table so it is released
/// automatically when the connection drops, including on a crash.
const LOCK_KEY = 8_140_2601

type LockClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export async function tryAcquireBrowserLock(client: LockClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ locked: boolean }>>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    LOCK_KEY,
  )
  return Array.isArray(rows) && rows[0]?.locked === true
}

export async function releaseBrowserLock(client: LockClient): Promise<void> {
  await client.$queryRawUnsafe('SELECT pg_advisory_unlock($1)', LOCK_KEY)
}

/// Runs `work` only when no other carrier browser job holds the lock. Returns
/// `null` when it skipped, so a caller can report that rather than pretend the
/// work ran.
export async function withBrowserLock<T>(
  client: LockClient,
  work: () => Promise<T>,
): Promise<T | null> {
  if (!(await tryAcquireBrowserLock(client))) {
    return null
  }
  try {
    return await work()
  } finally {
    await releaseBrowserLock(client)
  }
}

export type WaitForLockOptions = {
  timeoutMs?: number
  pollMs?: number
  // Injected so the wait can be tested without real time passing.
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

// Keep-alive fires every 10 minutes and holds the browser only briefly, so a
// probe that waits a few minutes outlives a tick it collided with. Skipping
// instead would mean a human re-runs the probe and pays another carrier hit.
const DEFAULT_WAIT_TIMEOUT_MS = 300_000
const DEFAULT_POLL_MS = 5_000

/// Like `withBrowserLock`, but waits for a contended lock instead of skipping.
///
/// For interactive probes and one-off investigations: they are cheap to delay
/// and expensive to re-run, which is the opposite trade-off from the scheduled
/// syncs. Still returns `null` when the deadline passes, so a caller can never
/// mistake "never ran" for "ran and found nothing" — the same mistake that
/// deleted 5,416 rows through the prune guard.
export async function withBrowserLockWaiting<T>(
  client: LockClient,
  work: () => Promise<T>,
  options: WaitForLockOptions = {},
): Promise<T | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = options.now ?? (() => Date.now())

  const deadline = now() + timeoutMs
  let acquired = await tryAcquireBrowserLock(client)
  while (!acquired) {
    if (now() >= deadline) {
      return null
    }
    await sleep(pollMs)
    acquired = await tryAcquireBrowserLock(client)
  }

  try {
    return await work()
  } finally {
    await releaseBrowserLock(client)
  }
}

export type DisconnectableLockClient = LockClient & {
  $disconnect(): Promise<void>
}

/// The same lock, held on a connection this call owns and then closes.
///
/// A Postgres advisory lock belongs to the connection that took it. The scripts
/// get away with the shared client because they are short-lived: the process
/// exits, every connection drops, and the lock goes with it. The runtime never
/// exits. Prisma pools, so `pg_advisory_unlock` can run on a different
/// connection than `pg_try_advisory_lock` did, and a lock that leaks there is
/// held until the worker restarts — blocking every carrier job and every cron
/// behind it. That is a worse outage than the collision the lock prevents.
///
/// Closing a client opened for this one call releases the lock whatever
/// happened, including on a throw the unlock never reached.
export async function withOwnedBrowserLockWaiting<T>(
  createClient: () => DisconnectableLockClient,
  work: () => Promise<T>,
  options: WaitForLockOptions = {},
): Promise<T | null> {
  const client = createClient()
  try {
    return await withBrowserLockWaiting(client, work, options)
  } finally {
    await client.$disconnect()
  }
}
