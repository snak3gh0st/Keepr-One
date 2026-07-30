import { describe, expect, it, vi } from 'vitest'
import {
  releaseBrowserLock,
  tryAcquireBrowserLock,
  withBrowserLock,
  withBrowserLockWaiting,
} from './browser-lock'

function client(locked: boolean) {
  const calls: string[] = []
  return {
    calls,
    $queryRawUnsafe: vi.fn(async (query: string) => {
      calls.push(query)
      return (query.includes('pg_try_advisory_lock') ? [{ locked }] : [{}]) as never
    }),
  }
}

/// A lock that refuses the first `refusals` attempts and then grants — the shape
/// of a keep-alive tick that is already running when a probe starts.
function clientBusyFor(refusals: number) {
  const calls: string[] = []
  let attempts = 0
  return {
    calls,
    attempts: () => attempts,
    $queryRawUnsafe: vi.fn(async (query: string) => {
      calls.push(query)
      if (!query.includes('pg_try_advisory_lock')) {
        return [{}] as never
      }
      attempts += 1
      return [{ locked: attempts > refusals }] as never
    }),
  }
}

describe('National Life browser lock', () => {
  it('reports the lock as taken when Postgres grants it', async () => {
    await expect(tryAcquireBrowserLock(client(true))).resolves.toBe(true)
  })

  it('reports a refusal rather than assuming success', async () => {
    await expect(tryAcquireBrowserLock(client(false))).resolves.toBe(false)
  })

  it('runs the work and releases when it holds the lock', async () => {
    const db = client(true)
    const work = vi.fn(async () => 'done')

    await expect(withBrowserLock(db, work)).resolves.toBe('done')
    expect(work).toHaveBeenCalledOnce()
    expect(db.calls.some((query) => query.includes('pg_advisory_unlock'))).toBe(true)
  })

  it('skips the work entirely when another job holds it', async () => {
    const db = client(false)
    const work = vi.fn(async () => 'done')

    // null, not a thrown error and not a silent success: the caller has to be
    // able to report that nothing ran.
    await expect(withBrowserLock(db, work)).resolves.toBeNull()
    expect(work).not.toHaveBeenCalled()
    expect(db.calls.some((query) => query.includes('pg_advisory_unlock'))).toBe(false)
  })

  it('releases the lock even when the work throws', async () => {
    const db = client(true)

    await expect(
      withBrowserLock(db, async () => {
        throw new Error('extraction blew up')
      }),
    ).rejects.toThrow('extraction blew up')
    expect(db.calls.some((query) => query.includes('pg_advisory_unlock'))).toBe(true)
  })

  it('releases on demand', async () => {
    const db = client(true)
    await releaseBrowserLock(db)
    expect(db.calls.some((query) => query.includes('pg_advisory_unlock'))).toBe(true)
  })
})

describe('National Life browser lock — waiting variant', () => {
  it('runs immediately when the lock is free', async () => {
    const db = client(true)
    const sleep = vi.fn(async () => {})

    await expect(
      withBrowserLockWaiting(db, async () => 'done', { sleep, timeoutMs: 60_000, pollMs: 1_000 }),
    ).resolves.toBe('done')
    // Nothing was contended, so nothing should have waited.
    expect(sleep).not.toHaveBeenCalled()
  })

  it('waits out a keep-alive tick instead of giving up on it', async () => {
    const db = clientBusyFor(3)
    const sleep = vi.fn(async () => {})

    await expect(
      withBrowserLockWaiting(db, async () => 'done', { sleep, timeoutMs: 60_000, pollMs: 5_000 }),
    ).resolves.toBe('done')
    expect(db.attempts()).toBe(4)
    expect(sleep).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenLastCalledWith(5_000)
  })

  it('gives up after the deadline rather than polling forever', async () => {
    const db = client(false)
    const sleep = vi.fn(async () => {})
    // A clock that advances a full poll interval per wait, so the deadline is
    // reached deterministically without real time passing.
    let elapsed = 0
    const now = () => {
      const value = elapsed
      elapsed += 5_000
      return value
    }

    await expect(
      withBrowserLockWaiting(db, async () => 'done', {
        sleep,
        now,
        timeoutMs: 20_000,
        pollMs: 5_000,
      }),
    ).resolves.toBeNull()
    expect(db.calls.some((query) => query.includes('pg_advisory_unlock'))).toBe(false)
  })

  it('releases the lock even when the work throws', async () => {
    const db = clientBusyFor(1)
    const sleep = vi.fn(async () => {})

    await expect(
      withBrowserLockWaiting(
        db,
        async () => {
          throw new Error('probe blew up')
        },
        { sleep, timeoutMs: 60_000, pollMs: 1_000 },
      ),
    ).rejects.toThrow('probe blew up')
    expect(db.calls.some((query) => query.includes('pg_advisory_unlock'))).toBe(true)
  })
})
