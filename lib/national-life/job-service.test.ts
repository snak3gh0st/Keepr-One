import { describe, expect, it } from 'vitest'
import { assertBrowserJobTransition, type BrowserJobState } from './job-state'
import { createBrowserJobService, type BrowserJobRepository } from './job-service'

type TestJob = Awaited<ReturnType<ReturnType<typeof createBrowserJobService>['claimNextJob']>> extends infer T
  ? Exclude<T, null>
  : never

function buildJob(
  overrides: Partial<TestJob> & Pick<TestJob, 'agentId' | 'operation' | 'input' | 'idempotencyKey'>,
): TestJob {
  const now = new Date('2026-07-27T12:00:00.000Z')

  return {
    id: overrides.id ?? `job-${Math.random().toString(36).slice(2, 10)}`,
    agentId: overrides.agentId,
    caseId: overrides.caseId ?? null,
    provider: overrides.provider ?? 'NATIONAL_LIFE',
    operation: overrides.operation,
    state: overrides.state ?? 'QUEUED',
    idempotencyKey: overrides.idempotencyKey,
    input: overrides.input,
    result: overrides.result ?? null,
    safeErrorCode: overrides.safeErrorCode ?? null,
    safeErrorDetail: overrides.safeErrorDetail ?? null,
    attemptCount: overrides.attemptCount ?? 0,
    availableAt: overrides.availableAt ?? now,
    leaseOwner: overrides.leaseOwner ?? null,
    leaseExpiresAt: overrides.leaseExpiresAt ?? null,
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    continuationKeyVersion: overrides.continuationKeyVersion ?? null,
    continuationIv: overrides.continuationIv ?? null,
    continuationCiphertext: overrides.continuationCiphertext ?? null,
    continuationAuthTag: overrides.continuationAuthTag ?? null,
    continuationExpiresAt: overrides.continuationExpiresAt ?? null,
  }
}

type TransitionRecord = {
  jobId: string
  from: BrowserJobState
  to: BrowserJobState
}

function createInMemoryRepository(
  seed: TestJob[] = [],
): BrowserJobRepository & {
  snapshot(): Promise<TestJob[]>
  transitionLog(): Promise<TransitionRecord[]>
} {
  const jobs = seed.map((job) => structuredClone(job))
  const transitions: TransitionRecord[] = []

  function updateStoredJob(
    jobId: string,
    expectedState: BrowserJobState,
    patch: Partial<TestJob>,
  ): TestJob | null {
    const index = jobs.findIndex((job) => job.id === jobId && job.state === expectedState)

    if (index === -1) {
      return null
    }

    jobs[index] = {
      ...jobs[index],
      ...patch,
      updatedAt: patch.updatedAt ?? new Date(),
    }

    return structuredClone(jobs[index])
  }

  return {
    async findByIdempotencyKey(idempotencyKey) {
      return structuredClone(jobs.find((job) => job.idempotencyKey === idempotencyKey) ?? null)
    },

    async findMostRecentByRetryKeyFamily(baseKey, states) {
      return (
        structuredClone(
          jobs
            .filter(
              (job) =>
                (job.idempotencyKey === baseKey ||
                  job.idempotencyKey.startsWith(`${baseKey}:retry:`)) &&
                (!states?.length || states.includes(job.state)),
            )
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null,
        )
      )
    },

    async create(input) {
      const created = buildJob({
        id: `job-${jobs.length + 1}`,
        agentId: input.agentId,
        caseId: input.caseId ?? null,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        input: input.input,
        state: input.state ?? 'QUEUED',
        attemptCount: input.attemptCount ?? 0,
        availableAt: input.availableAt ?? new Date(),
      })

      jobs.push(created)
      return structuredClone(created)
    },

    async claimNextAvailable({ now, workerId, leaseExpiresAt }) {
      const job = jobs
        .filter((candidate) => {
          const leaseActive = candidate.leaseExpiresAt && candidate.leaseExpiresAt > now

          return candidate.state === 'QUEUED' && candidate.availableAt <= now && !leaseActive
        })
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0]

      if (!job) {
        return null
      }

      const index = jobs.findIndex((candidate) => candidate.id === job.id)

      jobs[index] = {
        ...job,
        state: 'RUNNING',
        leaseOwner: workerId,
        leaseExpiresAt,
        startedAt: job.startedAt ?? now,
        attemptCount: job.attemptCount + 1,
        updatedAt: now,
      }

      return structuredClone(jobs[index])
    },

    async transitionIfState({ jobId, from, patch }) {
      if (patch.state && patch.state !== from) {
        assertBrowserJobTransition(from, patch.state)
        transitions.push({
          jobId,
          from,
          to: patch.state,
        })
      }

      return updateStoredJob(jobId, from, patch)
    },

    async listExpiredRunningJobs(now) {
      return structuredClone(
        jobs.filter(
          (job) => job.state === 'RUNNING' && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now,
        ),
      )
    },

    async snapshot() {
      return jobs.map((job) => structuredClone(job))
    },

    async transitionLog() {
      return transitions.map((transition) => structuredClone(transition))
    },
  }
}

describe('National Life browser job service', () => {
  it('deduplicates an active case sync by agent, case and five-minute bucket', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-existing',
        agentId: 'agent-1',
        caseId: 'case-1',
        operation: 'SYNC_CASE_READ',
        idempotencyKey: 'national-life:case-sync:agent-1:case-1:5950512',
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
      }),
    ])

    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
      now: () => new Date('2026-07-27T12:02:00.000Z'),
    })

    await expect(
      service.enqueueCaseReadSync({
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
      }),
    ).resolves.toEqual({ jobId: 'job-existing', duplicate: true })
  })

  it('deduplicates against an active re-enqueue after the base-key job already finished', async () => {
    const baseKey = 'national-life:case-sync:agent-1:case-1:5950512'
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-terminal',
        agentId: 'agent-1',
        caseId: 'case-1',
        operation: 'SYNC_CASE_READ',
        state: 'SUCCEEDED',
        finishedAt: new Date('2026-07-27T12:01:00.000Z'),
        idempotencyKey: baseKey,
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
      }),
      buildJob({
        id: 'job-active-reenqueue',
        agentId: 'agent-1',
        caseId: 'case-1',
        operation: 'SYNC_CASE_READ',
        state: 'RUNNING',
        leaseOwner: 'worker-2',
        leaseExpiresAt: new Date('2026-07-27T12:08:00.000Z'),
        startedAt: new Date('2026-07-27T12:02:00.000Z'),
        idempotencyKey: `${baseKey}:retry:1`,
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
      }),
    ])

    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
      now: () => new Date('2026-07-27T12:02:30.000Z'),
    })

    await expect(
      service.enqueueCaseReadSync({
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
      }),
    ).resolves.toEqual({ jobId: 'job-active-reenqueue', duplicate: true })

    await expect(repository.snapshot()).resolves.toHaveLength(2)
  })

  it('does not deduplicate across distinct buckets that share a numeric prefix', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-other-bucket',
        agentId: 'agent-1',
        caseId: 'case-1',
        operation: 'SYNC_CASE_READ',
        state: 'RUNNING',
        leaseOwner: 'worker-2',
        leaseExpiresAt: new Date('2026-07-27T12:08:00.000Z'),
        startedAt: new Date('2026-07-27T12:02:00.000Z'),
        idempotencyKey: 'national-life:case-sync:agent-1:case-1:59505120',
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
      }),
    ])

    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
      now: () => new Date('2026-07-27T12:02:00.000Z'),
    })

    await expect(
      service.enqueueCaseReadSync({
        agentId: 'agent-1',
        caseId: 'case-1',
        applicationId: 'app-1',
        lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
      }),
    ).resolves.toEqual({ jobId: 'job-2', duplicate: false })

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        id: 'job-other-bucket',
        idempotencyKey: 'national-life:case-sync:agent-1:case-1:59505120',
      }),
      expect.objectContaining({
        id: 'job-2',
        idempotencyKey: 'national-life:case-sync:agent-1:case-1:5950512',
      }),
    ])
  })

  it('never places credentials or URLs in job input', async () => {
    const repository = createInMemoryRepository()
    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
      now: () => new Date('2026-07-27T12:02:00.000Z'),
    })

    await service.enqueueCaseReadSync({
      agentId: 'agent-1',
      caseId: 'case-1',
      applicationId: 'app-1',
      lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
      password: 'secret',
      debugUrl: 'https://carrier.example/debug',
      cookies: ['session=abc'],
    } as never)

    await service.enqueueConnectionTest('agent-1')

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        operation: 'SYNC_CASE_READ',
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
      }),
      expect.objectContaining({
        operation: 'TEST_CONNECTION',
        input: {
          scopeId: 'scope-1',
        },
      }),
    ])
  })

  it('claims one available job with a lease', async () => {
    const service = createBrowserJobService({
      repository: createInMemoryRepository([
        buildJob({
          id: 'job-1',
          agentId: 'agent-1',
          operation: 'SYNC_CASE_READ',
          idempotencyKey: 'key-1',
          input: {
            caseId: 'case-1',
            applicationId: 'app-1',
            lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
          },
        }),
      ]),
      connectionTestScopeId: 'scope-1',
    })

    await expect(service.claimNextJob('worker-1', new Date('2026-07-27T12:00:00.000Z'))).resolves.toEqual(
      expect.objectContaining({
        id: 'job-1',
        state: 'RUNNING',
        leaseOwner: 'worker-1',
        attemptCount: 1,
        startedAt: new Date('2026-07-27T12:00:00.000Z'),
        leaseExpiresAt: new Date('2026-07-27T12:06:00.000Z'),
      }),
    )
  })

  it('does not claim a job whose lease is active', async () => {
    const service = createBrowserJobService({
      repository: createInMemoryRepository([
        buildJob({
          id: 'job-1',
          agentId: 'agent-1',
          operation: 'SYNC_CASE_READ',
          idempotencyKey: 'key-1',
          input: {
            caseId: 'case-1',
            applicationId: 'app-1',
            lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
          },
          leaseOwner: 'worker-0',
          leaseExpiresAt: new Date('2026-07-27T12:05:00.000Z'),
        }),
      ]),
      connectionTestScopeId: 'scope-1',
    })

    await expect(service.claimNextJob('worker-1', new Date('2026-07-27T12:00:00.000Z'))).resolves.toBeNull()
  })

  it('requeues an expired lease below the attempt limit', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-1',
        agentId: 'agent-1',
        operation: 'SYNC_CASE_READ',
        idempotencyKey: 'key-1',
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
        state: 'RUNNING',
        attemptCount: 1,
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date('2026-07-27T11:59:00.000Z'),
      }),
    ])

    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
    })

    await expect(service.releaseExpiredLeases(new Date('2026-07-27T12:00:00.000Z'))).resolves.toBe(1)

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        id: 'job-1',
        state: 'QUEUED',
        leaseOwner: null,
        leaseExpiresAt: null,
        availableAt: new Date('2026-07-27T12:00:00.000Z'),
        safeErrorCode: 'LEASE_EXPIRED',
      }),
    ])

    await expect(repository.transitionLog()).resolves.toEqual([
      {
        jobId: 'job-1',
        from: 'RUNNING',
        to: 'RETRYABLE',
      },
      {
        jobId: 'job-1',
        from: 'RETRYABLE',
        to: 'QUEUED',
      },
    ])
  })

  it('fails an expired lease at the attempt limit', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-1',
        agentId: 'agent-1',
        operation: 'SYNC_CASE_READ',
        idempotencyKey: 'key-1',
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
        state: 'RUNNING',
        attemptCount: 3,
        leaseOwner: 'worker-1',
        leaseExpiresAt: new Date('2026-07-27T11:59:00.000Z'),
      }),
    ])

    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
    })

    await expect(service.releaseExpiredLeases(new Date('2026-07-27T12:00:00.000Z'))).resolves.toBe(1)

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        id: 'job-1',
        state: 'FAILED',
        leaseOwner: null,
        leaseExpiresAt: null,
        safeErrorCode: 'LEASE_EXPIRED',
        finishedAt: new Date('2026-07-27T12:00:00.000Z'),
      }),
    ])
  })

  it('redacts error details during transitions', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-1',
        agentId: 'agent-1',
        operation: 'SYNC_CASE_READ',
        idempotencyKey: 'key-1',
        input: {
          caseId: 'case-1',
          applicationId: 'app-1',
          lookup: { kind: 'EXTERNAL_ID', value: 'NLG-123' },
        },
        state: 'RUNNING',
      }),
    ])

    const service = createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
    })

    await service.transitionJob({
      jobId: 'job-1',
      from: 'RUNNING',
      to: 'FAILED',
      safeErrorCode: 'UNEXPECTED_WORKER_FAILURE',
      safeErrorDetail: {
        password: 'secret',
        cookie: 'session=abc',
        safeCode: 'SELECTOR_NOT_FOUND',
      },
    })

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        id: 'job-1',
        state: 'FAILED',
        safeErrorCode: 'UNEXPECTED_WORKER_FAILURE',
        safeErrorDetail: {
          password: '[REDACTED]',
          cookie: '[REDACTED]',
          safeCode: 'SELECTOR_NOT_FOUND',
        },
      }),
    ])
  })

  it('rejects invalid transitions', async () => {
    const service = createBrowserJobService({
      repository: createInMemoryRepository(),
      connectionTestScopeId: 'scope-1',
    })

    await expect(
      service.transitionJob({
        jobId: 'job-1',
        from: 'SUCCEEDED',
        to: 'QUEUED',
      }),
    ).rejects.toThrow('Invalid browser job transition')
  })
})
