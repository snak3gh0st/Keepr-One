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
