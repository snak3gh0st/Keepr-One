import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { assertBrowserJobTransition, type BrowserJobState } from './job-state'
import {
  createBrowserJobService,
  releaseJobsBlockedOnCarrierLogin,
  shouldWaitForSyncStage,
  type BrowserJobRepository,
} from './job-service'

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
    deploymentScope: overrides.deploymentScope ?? null,
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

    async findOwnedById(agentId, jobId) {
      return structuredClone(
        jobs.find((job) => job.id === jobId && job.agentId === agentId) ?? null,
      )
    },

    async listRecentByOperation({ agentId, operation, limit }) {
      return structuredClone(
        jobs
          .filter((job) => job.agentId === agentId && job.operation === operation)
          .slice()
          .reverse()
          .slice(0, limit),
      )
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
        deploymentScope: input.deploymentScope ?? null,
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
  it('blocks a sync stage while an earlier stage in the same run is not terminal', () => {
    expect(
      shouldWaitForSyncStage(
        { syncRunId: 'run-1', syncStageIndex: 2 },
        ['SUCCEEDED', 'RUNNING'],
      ),
    ).toBe(true)
    expect(
      shouldWaitForSyncStage(
        { syncRunId: 'run-1', syncStageIndex: 2 },
        ['SUCCEEDED', 'FAILED'],
      ),
    ).toBe(false)
    expect(shouldWaitForSyncStage({ syncRunId: null, syncStageIndex: null }, ['RUNNING'])).toBe(
      false,
    )
  })

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

describe('Rapid Solve quote jobs', () => {
  const quote = {
    issueState: 'FL',
    firstName: 'Ana',
    lastName: 'Souza',
    dateOfBirth: '03/10/1986',
    gender: 'F',
    rateClass: 'NonTobacco',
    solveType: 'Specify_Amount',
    amount: 250_000,
    deathBenefitOption: 'Level',
    strategy: 'S&P',
    allocation: 100,
    productCode: '956',
  }

  function createService(repository: ReturnType<typeof createInMemoryRepository>) {
    return createBrowserJobService({
      repository,
      connectionTestScopeId: 'scope-1',
      now: () => new Date('2026-07-27T12:02:00.000Z'),
    })
  }

  it('enqueues without a case, because the insured is a prospect', async () => {
    const repository = createInMemoryRepository()

    await expect(
      createService(repository).enqueueRapidSolveQuote({ agentId: 'agent-1', quote }),
    ).resolves.toEqual({ jobId: expect.any(String), duplicate: false })

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        operation: 'GET_RAPID_SOLVE_QUOTE',
        caseId: null,
        input: quote,
      }),
    ])
  })

  it('treats the same question asked twice as one job', async () => {
    const repository = createInMemoryRepository()
    const service = createService(repository)

    const first = await service.enqueueRapidSolveQuote({ agentId: 'agent-1', quote })
    const second = await service.enqueueRapidSolveQuote({ agentId: 'agent-1', quote })

    expect(second).toEqual({ jobId: first.jobId, duplicate: true })
  })

  // The reason the key is a hash of the input and not agent+prospect: raising the
  // face amount and asking again is the normal way an agent works, and returning
  // the first quote's numbers would look like an answer to the second question.
  it('quotes again when the amount changes', async () => {
    const repository = createInMemoryRepository()
    const service = createService(repository)

    const first = await service.enqueueRapidSolveQuote({ agentId: 'agent-1', quote })
    const second = await service.enqueueRapidSolveQuote({
      agentId: 'agent-1',
      quote: { ...quote, amount: 500_000 },
    })

    expect(second.duplicate).toBe(false)
    expect(second.jobId).not.toBe(first.jobId)
  })

  it('quotes again when the solve type changes', async () => {
    const repository = createInMemoryRepository()
    const service = createService(repository)

    await service.enqueueRapidSolveQuote({ agentId: 'agent-1', quote })
    const second = await service.enqueueRapidSolveQuote({
      agentId: 'agent-1',
      quote: { ...quote, solveType: 'Premium-AccumulationFocus' },
    })

    expect(second.duplicate).toBe(false)
  })

  it('does not carry a field the carrier never asked for', async () => {
    const repository = createInMemoryRepository()

    await createService(repository).enqueueRapidSolveQuote({
      agentId: 'agent-1',
      quote: { ...quote, password: 'secret', debugUrl: 'https://carrier.example/debug' },
    } as never)

    await expect(repository.snapshot()).resolves.toEqual([
      expect.objectContaining({ input: quote }),
    ])
  })

  it('rejects a date of birth that is not the carrier format', async () => {
    const service = createService(createInMemoryRepository())

    await expect(
      service.enqueueRapidSolveQuote({
        agentId: 'agent-1',
        quote: { ...quote, dateOfBirth: '1986-03-10' },
      }),
    ).rejects.toThrow('dateOfBirth must be MM/DD/YYYY')
  })

  it('reports a quote still in flight as pending', async () => {
    const repository = createInMemoryRepository()
    const service = createService(repository)
    const { jobId } = await service.enqueueRapidSolveQuote({ agentId: 'agent-1', quote })

    await expect(service.getOwnedQuoteStatus('agent-1', jobId)).resolves.toEqual({
      state: 'PENDING',
    })
  })

  it('hands back the carrier answer once the job succeeded', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-quote',
        agentId: 'agent-1',
        operation: 'GET_RAPID_SOLVE_QUOTE',
        idempotencyKey: 'quote-key',
        state: 'SUCCEEDED',
        input: quote,
        result: { ok: true, faceAmount: 250_000, annualPremium: 3_748.8, monthlyPremium: 312.4, lapseYear: null },
      }),
    ])

    await expect(
      createService(repository).getOwnedQuoteStatus('agent-1', 'job-quote'),
    ).resolves.toMatchObject({
      state: 'ANSWERED',
      quote: { ok: true, monthlyPremium: 312.4 },
    })
  })

  // A refusal reached us, so the screen can print the carrier's sentence. This
  // is the case that must not be reported as UNAVAILABLE.
  it('reports a carrier refusal as an answer', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-quote',
        agentId: 'agent-1',
        operation: 'GET_RAPID_SOLVE_QUOTE',
        idempotencyKey: 'quote-key',
        state: 'SUCCEEDED',
        input: quote,
        result: { ok: false, message: 'Face amount below the product minimum.' },
      }),
    ])

    await expect(
      createService(repository).getOwnedQuoteStatus('agent-1', 'job-quote'),
    ).resolves.toMatchObject({
      state: 'ANSWERED',
      quote: { ok: false, message: 'Face amount below the product minimum.' },
    })
  })

  it('reports a failed job as unavailable rather than as a quote', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-quote',
        agentId: 'agent-1',
        operation: 'GET_RAPID_SOLVE_QUOTE',
        idempotencyKey: 'quote-key',
        state: 'FAILED',
        input: quote,
        safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED',
      }),
    ])

    await expect(
      createService(repository).getOwnedQuoteStatus('agent-1', 'job-quote'),
    ).resolves.toEqual({
      state: 'UNAVAILABLE',
      safeErrorCode: 'NATIONAL_LIFE_RECONNECT_REQUIRED',
    })
  })

  // A quote names an insured and a premium. Another agent's job id must look
  // exactly like one that never existed.
  it('does not reveal a quote belonging to another agent', async () => {
    const repository = createInMemoryRepository([
      buildJob({
        id: 'job-quote',
        agentId: 'agent-2',
        operation: 'GET_RAPID_SOLVE_QUOTE',
        idempotencyKey: 'quote-key',
        state: 'SUCCEEDED',
        input: quote,
        result: { ok: true, faceAmount: 250_000, annualPremium: 1, monthlyPremium: 1, lapseYear: null },
      }),
    ])

    await expect(
      createService(repository).getOwnedQuoteStatus('agent-1', 'job-quote'),
    ).resolves.toBeNull()
  })

  it('rejects an amount that is not a positive number', async () => {
    const service = createService(createInMemoryRepository())

    await expect(
      service.enqueueRapidSolveQuote({ agentId: 'agent-1', quote: { ...quote, amount: 0 } }),
    ).rejects.toThrow('amount must be a positive number')
  })
})

describe('Foresight jobs', () => {
  const now = new Date('2026-08-04T14:30:00.000Z')
  const ownedSnapshot = {
    id: 'snapshot-1',
    agentId: 'agent-1',
    deploymentScope: 'scope-1',
    externalKey: 'RP-Silva-QQ-08032026',
  }

  function createService(options: {
    snapshots?: Array<typeof ownedSnapshot>
    startResult?: { runId: string; jobId: string; duplicate: boolean }
  } = {}) {
    const repository = createInMemoryRepository()
    const starts: Array<{
      agentId: string
      deploymentScope: string
      mode: 'INVENTORY' | 'DETAIL'
      targetCaseId?: string
      now: Date
    }> = []
    const snapshotLookups: Array<{
      agentId: string
      deploymentScope: string
      caseSnapshotId: string
    }> = []
    const snapshots = options.snapshots ?? [ownedSnapshot]
    const service = createBrowserJobService({
      repository,
      now: () => now,
      foresightRunStore: {
        async start(input) {
          starts.push(input)
          return options.startResult ?? {
            runId: 'foresight-run-1',
            jobId: 'foresight-job-1',
            duplicate: false,
          }
        },
      },
      async findForesightCaseSnapshot(input) {
        snapshotLookups.push(input)
        return (
          snapshots.find(
            (snapshot) =>
              snapshot.id === input.caseSnapshotId &&
              snapshot.agentId === input.agentId &&
              snapshot.deploymentScope === input.deploymentScope,
          ) ?? null
        )
      },
    })

    return { repository, service, starts, snapshotLookups }
  }

  function createConcurrentUniquePdfRepository() {
    const repository = createInMemoryRepository()
    let activeLookupCalls = 0
    let releaseActiveLookups!: () => void
    const bothActiveLookupsReached = new Promise<void>((resolve) => {
      releaseActiveLookups = resolve
    })
    let existingLookupCalls = 0
    let releaseExistingLookups!: () => void
    const bothExistingLookupsReached = new Promise<void>((resolve) => {
      releaseExistingLookups = resolve
    })
    const findMostRecent = repository.findMostRecentByRetryKeyFamily.bind(repository)
    repository.findMostRecentByRetryKeyFamily = async (baseKey, states) => {
      if (states?.length) {
        activeLookupCalls += 1
        if (activeLookupCalls === 2) releaseActiveLookups()
        if (activeLookupCalls <= 2) {
          await bothActiveLookupsReached
          return null
        }
      } else {
        existingLookupCalls += 1
        if (existingLookupCalls === 2) releaseExistingLookups()
        if (existingLookupCalls <= 2) {
          await bothExistingLookupsReached
          return null
        }
      }
      return findMostRecent(baseKey, states)
    }
    let createCalls = 0
    const createdIdempotencyKeys = new Set<string>()
    let releaseCreates!: () => void
    const bothCreatesReached = new Promise<void>((resolve) => {
      releaseCreates = resolve
    })
    const create = repository.create.bind(repository)

    repository.create = async (input) => {
      createCalls += 1
      if (createCalls === 2) releaseCreates()
      await bothCreatesReached

      if (createdIdempotencyKeys.has(input.idempotencyKey)) {
        throw new Prisma.PrismaClientKnownRequestError('duplicate idempotency key', {
          code: 'P2002',
          clientVersion: 'test',
        })
      }

      createdIdempotencyKeys.add(input.idempotencyKey)
      return create(input)
    }

    return repository
  }

  it.each([
    [{ agentId: 'https://carrier.example/agent', deploymentScope: 'scope-1', mode: 'INVENTORY' }],
    [{ agentId: 'agent-1', deploymentScope: 'https://carrier.example/scope', mode: 'INVENTORY' }],
    [{ agentId: 'agent-1', deploymentScope: 'scope-1', mode: '' }],
  ])('rejects a URL or empty mode before creating a Foresight run', async (input) => {
    const test = createService()

    await expect(test.service.enqueueForesightRead(input as never)).rejects.toThrow()
    expect(test.starts).toEqual([])
  })

  it('rejects empty identifiers and URLs before creating a Foresight PDF job', async () => {
    const test = createService()
    const validInput = {
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      caseSnapshotId: 'snapshot-1',
      caseKey: ownedSnapshot.externalKey,
    }

    for (const input of [
      { ...validInput, agentId: 'https://carrier.example/agent' },
      { ...validInput, deploymentScope: 'https://carrier.example/scope' },
      { ...validInput, caseSnapshotId: '' },
      { ...validInput, caseKey: '' },
    ]) {
      await expect(test.service.enqueueForesightPdf(input)).rejects.toThrow()
    }

    expect(test.snapshotLookups).toEqual([])
    await expect(test.repository.snapshot()).resolves.toEqual([])
  })

  it('keeps inventory and detail requests separate and requires exactly one detail target', async () => {
    const test = createService()

    await expect(
      test.service.enqueueForesightRead({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        mode: 'DETAIL',
      }),
    ).rejects.toThrow('targetCaseId is required for DETAIL mode')
    await expect(
      test.service.enqueueForesightRead({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        mode: 'INVENTORY',
        targetCaseId: 'snapshot-1',
      }),
    ).rejects.toThrow('targetCaseId is not allowed for INVENTORY mode')
    expect(test.starts).toEqual([])
    expect(test.snapshotLookups).toEqual([])
  })

  it('rejects unknown, cross-agent, and cross-scope detail snapshot ids identically', async () => {
    const test = createService({
      snapshots: [{ ...ownedSnapshot, agentId: 'agent-2' }],
    })
    const input = {
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      mode: 'DETAIL' as const,
      targetCaseId: 'snapshot-1',
    }

    await expect(test.service.enqueueForesightRead(input)).rejects.toThrow(
      'targetCaseId must identify an owned Foresight case snapshot',
    )
    await expect(
      test.service.enqueueForesightRead({ ...input, targetCaseId: 'snapshot-missing' }),
    ).rejects.toThrow('targetCaseId must identify an owned Foresight case snapshot')
    await expect(
      createService().service.enqueueForesightRead({ ...input, deploymentScope: 'scope-2' }),
    ).rejects.toThrow('targetCaseId must identify an owned Foresight case snapshot')
    expect(test.starts).toEqual([])
  })

  it('returns the active same-scope read run as a duplicate', async () => {
    const test = createService({
      startResult: { runId: 'run-active', jobId: 'job-active', duplicate: true },
    })

    await expect(
      test.service.enqueueForesightRead({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        mode: 'DETAIL',
        targetCaseId: 'snapshot-1',
      }),
    ).resolves.toEqual({ runId: 'run-active', jobId: 'job-active', duplicate: true })
    expect(test.starts).toEqual([
      {
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        mode: 'DETAIL',
        targetCaseId: 'snapshot-1',
        now,
      },
    ])
  })

  it('keeps the Foresight read path out of Rapid Solve and illustration PDF operations', async () => {
    const test = createService()

    await test.service.enqueueForesightRead({
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      mode: 'INVENTORY',
    })

    await expect(test.repository.snapshot()).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: expect.stringMatching(/GET_RAPID_SOLVE_QUOTE|GENERATE_ILLUSTRATION_PDF/),
        }),
      ]),
    )
    expect(test.starts).toHaveLength(1)
  })

  it('enqueues an owned snapshot PDF with its validated exact case key', async () => {
    const test = createService()

    await expect(
      test.service.enqueueForesightPdf({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        caseSnapshotId: 'snapshot-1',
        caseKey: 'RP-Silva-QQ-08032026',
      }),
    ).resolves.toEqual({ jobId: 'job-1', duplicate: false })
    await expect(test.repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        operation: 'GENERATE_FORESIGHT_PDF',
        idempotencyKey: 'national-life:foresight-pdf:agent-1:scope-1:snapshot-1',
        input: {
          caseSnapshotId: 'snapshot-1',
          caseKey: 'RP-Silva-QQ-08032026',
        },
      }),
    ])
  })

  it('deduplicates the same Foresight PDF in one agent deployment scope', async () => {
    const test = createService()
    const input = {
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      caseSnapshotId: 'snapshot-1',
      caseKey: ownedSnapshot.externalKey,
    }

    const first = await test.service.enqueueForesightPdf(input)
    await expect(test.service.enqueueForesightPdf(input)).resolves.toEqual({
      jobId: first.jobId,
      duplicate: true,
    })
    await expect(test.repository.snapshot()).resolves.toEqual([
      expect.objectContaining({
        operation: 'GENERATE_FORESIGHT_PDF',
        idempotencyKey: 'national-life:foresight-pdf:agent-1:scope-1:snapshot-1',
      }),
    ])
  })

  it('returns the active PDF when concurrent creation collides on the unique key', async () => {
    const repository = createConcurrentUniquePdfRepository()
    const service = createBrowserJobService({
      repository,
      now: () => now,
      async findForesightCaseSnapshot(input) {
        return input.caseSnapshotId === ownedSnapshot.id &&
          input.agentId === ownedSnapshot.agentId &&
          input.deploymentScope === ownedSnapshot.deploymentScope
          ? ownedSnapshot
          : null
      },
    })
    const input = {
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      caseSnapshotId: 'snapshot-1',
      caseKey: ownedSnapshot.externalKey,
    }

    await expect(Promise.all([
      service.enqueueForesightPdf(input),
      service.enqueueForesightPdf(input),
    ])).resolves.toEqual([
      { jobId: 'job-1', duplicate: false },
      { jobId: 'job-1', duplicate: true },
    ])
    await expect(repository.snapshot()).resolves.toHaveLength(1)
  })

  it('rejects a cross-agent PDF snapshot and a non-exact case key', async () => {
    const test = createService()

    await expect(
      test.service.enqueueForesightPdf({
        agentId: 'agent-2',
        deploymentScope: 'scope-1',
        caseSnapshotId: 'snapshot-1',
        caseKey: ownedSnapshot.externalKey,
      }),
    ).rejects.toThrow('caseSnapshotId must identify an owned Foresight case snapshot')
    await expect(
      test.service.enqueueForesightPdf({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        caseSnapshotId: 'snapshot-1',
        caseKey: 'Silva',
      }),
    ).rejects.toThrow('caseKey must match the owned Foresight case exactly')
    await expect(
      test.service.enqueueForesightPdf({
        agentId: 'agent-1',
        deploymentScope: 'scope-2',
        caseSnapshotId: 'snapshot-1',
        caseKey: ownedSnapshot.externalKey,
      }),
    ).rejects.toThrow('caseSnapshotId must identify an owned Foresight case snapshot')
    await expect(
      test.service.enqueueForesightPdf({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        caseSnapshotId: 'snapshot-1',
        caseKey: ` ${ownedSnapshot.externalKey}`,
      }),
    ).rejects.toThrow('caseKey must match the owned Foresight case exactly')
    await expect(test.repository.snapshot()).resolves.toEqual([])
  })
})

// The drain exists once so that neither connect path can forget it. Both call
// sites run inside a Prisma transaction, which no suite here executes — so the
// query itself is what gets pinned. Widen the filter and a login starts
// reviving jobs it cannot fix; narrow the write and the job wakes still
// carrying the error that parked it.
describe('releaseJobsBlockedOnCarrierLogin', () => {
  const now = new Date('2026-08-03T12:00:00.000Z')

  function recordUpdateMany() {
    const calls: Prisma.BrowserAutomationJobUpdateManyArgs[] = []
    const transaction = {
      browserAutomationJob: {
        async updateMany(args: Prisma.BrowserAutomationJobUpdateManyArgs) {
          calls.push(args)
          return { count: 0 }
        },
      },
    } as unknown as Prisma.TransactionClient

    return { transaction, calls }
  }

  it('revives only this scope and legacy jobs, never a second scope', async () => {
    const { transaction, calls } = recordUpdateMany()

    await releaseJobsBlockedOnCarrierLogin(transaction, {
      agentId: 'agent-1',
      deploymentScope: 'scope-a',
      now,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].where).toEqual({
      agentId: 'agent-1',
      provider: 'NATIONAL_LIFE',
      state: 'ACTION_REQUIRED',
      safeErrorCode: {
        in: ['FORESIGHT_SSO_EXPIRED', 'NATIONAL_LIFE_RECONNECT_REQUIRED'],
      },
      OR: [
        { deploymentScope: 'scope-a' },
        { deploymentScope: null },
      ],
    })
  })

  // availableAt is what claimNextJob filters on (lte now), so the revived job
  // is claimable on the very next poll rather than a cycle late.
  it('queues the job for immediate pickup and clears what parked it', async () => {
    const { transaction, calls } = recordUpdateMany()

    await releaseJobsBlockedOnCarrierLogin(transaction, {
      agentId: 'agent-1',
      deploymentScope: 'scope-a',
      now,
    })

    expect(calls[0].data).toEqual({
      state: 'QUEUED',
      availableAt: now,
      safeErrorCode: null,
    })
  })
})

// The invariant the whole park-and-drain design rests on: a carrier session
// can flip to CONNECTED only alongside releaseJobsBlockedOnCarrierLogin
// running in the *same* transaction. Break that pairing and a job parked on
// a login-required code can end up connected on one side and still parked on
// the other, with nothing left to requeue it until some unrelated code path
// happens to touch it. Today there are exactly two call sites — this file's
// own doc comments on releaseJobsBlockedOnCarrierLogin name them — and both
// hold up. But nothing in the type system stops a third: a new upsert that
// sets status: 'CONNECTED' without the drain call would compile, typecheck,
// and pass every other test in this suite.
//
// So, the same way quote-disclaimer.test.ts guards its own invariant, this
// reads the source directly: find every `agentIntegrationSession.upsert` that
// writes CONNECTED under lib/ and workers/, and require
// releaseJobsBlockedOnCarrierLogin inside the same `$transaction` block.
// Plain brace/paren matching over source text, not an AST — the two real call
// sites are simple enough that it holds, and staying source-level means this
// test needs no database and no Prisma mock to catch the mistake.
describe('the CONNECTED-drain invariant', () => {
  const ROOT = fileURLToPath(new URL('../..', import.meta.url))
  const SCAN_DIRS = ['lib', 'workers']
  const UPSERT_MARKER = 'agentIntegrationSession.upsert('
  const CONNECTED_MARKER = "status: 'CONNECTED'"
  const DRAIN_CALL = 'releaseJobsBlockedOnCarrierLogin('
  const TRANSACTION_MARKER = '.$transaction('

  function sourceFiles(dir: string): string[] {
    const files: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...sourceFiles(full))
      } else if (
        entry.isFile() &&
        extname(entry.name) === '.ts' &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(full)
      }
    }
    return files
  }

  function indicesOf(source: string, marker: string): number[] {
    const indices: number[] = []
    let from = 0
    let at = source.indexOf(marker, from)
    while (at !== -1) {
      indices.push(at)
      from = at + marker.length
      at = source.indexOf(marker, from)
    }
    return indices
  }

  // Depth-counts from an opening delimiter to its match. Works for both `()`
  // and `{}` — the callers just pass the pair they mean.
  function matchingDelimiter(source: string, openIndex: number, open: string, close: string): number {
    let depth = 0
    for (let i = openIndex; i < source.length; i++) {
      if (source[i] === open) depth++
      else if (source[i] === close) {
        depth--
        if (depth === 0) return i
      }
    }
    return -1
  }

  function lineOf(source: string, index: number): number {
    let line = 1
    for (let i = 0; i < index; i++) {
      if (source[i] === '\n') line++
    }
    return line
  }

  /// The body span of every `something.$transaction(async (x) => { ... })` in
  /// the file. Filters out the array-of-writes form of `$transaction` (used
  /// elsewhere in this codebase for batched upserts with no callback body) by
  /// requiring the text between the marker and the next `{` to end in `=>` —
  /// true for a block-bodied arrow immediately opening that brace, and
  /// essentially never true of unrelated code the brace search might otherwise
  /// wander into.
  function transactionBodySpans(source: string): Array<{ start: number; end: number }> {
    return indicesOf(source, TRANSACTION_MARKER).flatMap((at) => {
      const bodyOpen = source.indexOf('{', at + TRANSACTION_MARKER.length)
      if (bodyOpen === -1) return []
      const signature = source.slice(at + TRANSACTION_MARKER.length, bodyOpen)
      if (!signature.trim().endsWith('=>')) return []
      const bodyEnd = matchingDelimiter(source, bodyOpen, '{', '}')
      if (bodyEnd === -1) return []
      return [{ start: bodyOpen, end: bodyEnd }]
    })
  }

  function findConnectedDrainViolations(): string[] {
    const violations: string[] = []
    const files = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const relativePath = relative(ROOT, file)
      const transactionSpans = transactionBodySpans(source)

      for (const upsertAt of indicesOf(source, UPSERT_MARKER)) {
        const argsOpen = upsertAt + UPSERT_MARKER.length - 1
        const argsClose = matchingDelimiter(source, argsOpen, '(', ')')
        if (argsClose === -1) continue

        const args = source.slice(argsOpen, argsClose + 1)
        if (!args.includes(CONNECTED_MARKER)) continue

        const line = lineOf(source, upsertAt)
        const enclosing = transactionSpans.find(
          (span) => span.start <= upsertAt && upsertAt <= span.end,
        )

        if (!enclosing) {
          violations.push(
            `${relativePath}:${line} — sets status: 'CONNECTED' outside any $transaction block, so ` +
              'releaseJobsBlockedOnCarrierLogin cannot run atomically with it. A job parked on ' +
              'a login-required job for this agent has no guaranteed moment it gets requeued.',
          )
          continue
        }

        const body = source.slice(enclosing.start, enclosing.end + 1)
        if (!body.includes(DRAIN_CALL)) {
          violations.push(
            `${relativePath}:${line} — sets status: 'CONNECTED' without calling ` +
              'releaseJobsBlockedOnCarrierLogin in the same transaction. A job parked on ' +
              'a login-required job for this agent can end up connected while still parked, ' +
              'with nothing left to drain it.',
          )
        }
      }
    }

    return violations
  }

  it('pairs every CONNECTED upsert with the drain, in the same transaction', () => {
    expect(findConnectedDrainViolations()).toEqual([])
  })

  // A scan that silently finds nothing would make the assertion above pass
  // for the wrong reason. This pins the scan to the two files this branch
  // actually has a connect site in, so a change to ROOT, the markers, or the
  // directory walk that quietly stops finding real code fails here instead of
  // passing everywhere by accident. Naming the files (rather than asserting a
  // bare count) is what keeps *this* test's own failure useful: a legitimate
  // third connect site is expected to change this list, and the diff says
  // which path showed up or went missing instead of just "3 not 2". Line
  // numbers are deliberately not part of the expectation — those move for
  // reasons that have nothing to do with this invariant.
  it('actually scans both existing call sites', () => {
    const files = SCAN_DIRS.flatMap((dir) => sourceFiles(join(ROOT, dir)))
    const connectedUpsertFiles = files
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return indicesOf(source, UPSERT_MARKER).some((upsertAt) => {
          const argsOpen = upsertAt + UPSERT_MARKER.length - 1
          const argsClose = matchingDelimiter(source, argsOpen, '(', ')')
          return argsClose !== -1 && source.slice(argsOpen, argsClose + 1).includes(CONNECTED_MARKER)
        })
      })
      .map((file) => relative(ROOT, file))
      .sort()

    expect(connectedUpsertFiles).toEqual([
      join('lib', 'national-life', 'interactive-connection-service.ts'),
      join('workers', 'national-life', 'runtime.ts'),
    ])
  })
})
