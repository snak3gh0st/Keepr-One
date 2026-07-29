import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  getClaimableConnectionAttemptStates,
  runNationalLifeRuntime,
  type RuntimeDeps,
} from './runtime'

function createDeps(options: {
  attempts?: Array<{ id: string } | null>
  jobs?: Array<{ id: string } | null>
  runAttempt?: (id: string) => Promise<void>
  runJob?: (id: string) => Promise<void>
}) {
  const signals = new EventEmitter()
  const calls: string[] = []
  const attempts = [...(options.attempts ?? [null])]
  const jobs = [...(options.jobs ?? [null])]

  const deps: RuntimeDeps = {
    viewer: {
      env: {
        signingKey: Buffer.alloc(32, 4),
        appOrigin: 'https://app.keepr.one',
      },
      now: () => new Date('2026-07-28T12:00:00.000Z'),
      store: {
        consumeBootstrapNonce: vi.fn(),
        getOwnedAttemptRuntime: vi.fn(),
      },
    },
    signals,
    async listen() {
      calls.push('broker:listen')
    },
    async closeServer() {
      calls.push('broker:close')
    },
    async claimConnectionAttempt() {
      calls.push('attempt:claim')
      return attempts.length > 0 ? attempts.shift() ?? null : null
    },
    async runConnectionAttempt(id) {
      calls.push(`attempt:run:${id}`)
      await options.runAttempt?.(id)
    },
    async claimBrowserJob() {
      calls.push('job:claim')
      return jobs.length > 0 ? jobs.shift() ?? null : null
    },
    async runBrowserJob(id) {
      calls.push(`job:run:${id}`)
      await options.runJob?.(id)
    },
    async cleanupLeasedInteractiveAttempts() {
      calls.push('attempt:cleanup-leases')
    },
    logError(context) {
      calls.push(`error:${context.kind}:${context.code}`)
    },
  }

  return { deps, calls, signals }
}

async function flush() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

describe('dedicated National Life runtime loops', () => {
  it('claims only active connection-attempt states', () => {
    expect(getClaimableConnectionAttemptStates()).toEqual([
      'OPENING_PORTAL',
      'AWAITING_LOGIN',
      'AWAITING_MFA',
    ])
    expect(getClaimableConnectionAttemptStates()).not.toEqual(
      expect.arrayContaining(['FAILED', 'CANCELLED', 'EXPIRED']),
    )
  })

  it('claims interactive attempts and read-only jobs independently', async () => {
    vi.useFakeTimers()
    const test = createDeps({
      attempts: [{ id: 'attempt-1' }, null],
      jobs: [{ id: 'job-1' }, null],
    })

    const running = runNationalLifeRuntime(test.deps)
    await flush()

    expect(test.calls).toContain('attempt:run:attempt-1')
    expect(test.calls).toContain('job:run:job-1')

    test.signals.emit('SIGTERM')
    await vi.runAllTimersAsync()
    await running
    vi.useRealTimers()
  })

  it('continues later claims when one unit fails', async () => {
    vi.useFakeTimers()
    const test = createDeps({
      attempts: [{ id: 'attempt-1' }, { id: 'attempt-2' }, null],
      runAttempt: async (id) => {
        if (id === 'attempt-1') {
          throw new Error('safe-failure')
        }
      },
    })

    const running = runNationalLifeRuntime(test.deps)
    await flush()

    expect(test.calls).toContain('error:attempt:RUNTIME_UNIT_FAILED')
    expect(test.calls.join(' ')).not.toContain('safe-failure')
    expect(test.calls).toContain('attempt:run:attempt-2')

    test.signals.emit('SIGTERM')
    await vi.runAllTimersAsync()
    await running
    vi.useRealTimers()
  })

  it('waits 1000 ms instead of busy-spinning when queues are empty', async () => {
    vi.useFakeTimers()
    const test = createDeps({})

    const running = runNationalLifeRuntime(test.deps)
    await flush()
    expect(test.calls.filter((call) => call === 'attempt:claim')).toHaveLength(1)
    expect(test.calls.filter((call) => call === 'job:claim')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(test.calls.filter((call) => call === 'attempt:claim')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(test.calls.filter((call) => call === 'attempt:claim')).toHaveLength(2)
    expect(test.calls.filter((call) => call === 'job:claim')).toHaveLength(2)

    test.signals.emit('SIGTERM')
    await vi.runAllTimersAsync()
    await running
    vi.useRealTimers()
  })

  it('on SIGTERM stops claims, cleans leases, then closes the broker', async () => {
    vi.useFakeTimers()
    const test = createDeps({})

    const running = runNationalLifeRuntime(test.deps)
    await flush()
    const claimsBeforeShutdown = test.calls.filter((call) => call.endsWith(':claim')).length

    test.signals.emit('SIGTERM')
    await vi.runAllTimersAsync()
    await running

    expect(test.calls.filter((call) => call.endsWith(':claim'))).toHaveLength(
      claimsBeforeShutdown,
    )
    expect(test.calls.slice(-2)).toEqual([
      'attempt:cleanup-leases',
      'broker:close',
    ])
    vi.useRealTimers()
  })
})
