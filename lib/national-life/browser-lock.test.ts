import { describe, expect, it, vi } from 'vitest'
import { releaseBrowserLock, tryAcquireBrowserLock, withBrowserLock } from './browser-lock'

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
