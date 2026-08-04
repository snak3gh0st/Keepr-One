import { describe, expect, it } from 'vitest'
import { createForesightRunStore } from './foresight-run-service'

const now = new Date('2026-08-03T17:00:00.000Z')

function createRepository() {
  let transactionTail = Promise.resolve()
  const repository = {
    active: null as Record<string, unknown> | null,
    run: null as Record<string, unknown> | null,
    jobs: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
    findFirstCalls: [] as Array<Record<string, unknown>>,
    transactionCalls: 0,
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      repository.transactionCalls += 1
      const result = transactionTail.then(() => callback(repository))
      transactionTail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
    nationalLifeForesightReadRun: {
      findFirst: async (args: Record<string, unknown>) => {
        repository.findFirstCalls.push(args)
        return repository.active
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        repository.run = { id: 'run-1', ...data }
        return { id: 'run-1' }
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        repository.updates.push(data)
        return { count: 1 }
      },
    },
    browserAutomationJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        repository.jobs.push({ id: 'job-1', ...data })
        return { id: 'job-1' }
      },
    },
  }
  return repository
}

describe('Foresight read run store', () => {
  it('returns the active inventory run and job as a duplicate', async () => {
    const repository = createRepository()
    repository.active = { id: 'run-existing', jobs: [{ id: 'job-existing' }] }

    await expect(
      createForesightRunStore(repository as never).start({
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        mode: 'INVENTORY',
        now,
      }),
    ).resolves.toEqual({ runId: 'run-existing', jobId: 'job-existing', duplicate: true })
    expect(repository.jobs).toHaveLength(0)
  })

  it('creates a new job after a completed run and scopes the active lookup', async () => {
    const repository = createRepository()

    const result = await createForesightRunStore(repository as never).start({
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      mode: 'DETAIL',
      targetCaseId: 'case-1',
      now,
    })

    expect(result).toEqual({ runId: 'run-1', jobId: 'job-1', duplicate: false })
    expect(repository.jobs[0]).toMatchObject({
      operation: 'SYNC_FORESIGHT_READ',
      foresightRunId: 'run-1',
      deploymentScope: 'scope-1',
      input: {
        foresightRunId: 'run-1', mode: 'DETAIL', targetCaseId: 'case-1', deploymentScope: 'scope-1',
      },
      idempotencyKey: 'national-life:foresight:agent-1:scope-1:DETAIL:case-1',
    })
    expect(repository.findFirstCalls[0]).toMatchObject({
      where: expect.objectContaining({ agentId: 'agent-1', deploymentScope: 'scope-1' }),
    })
  })

  it('creates the run and job in one transaction when concurrent starts race', async () => {
    const repository = createRepository()
    let created = false
    repository.nationalLifeForesightReadRun.findFirst = async () =>
      created ? { id: 'run-1', jobs: [{ id: 'job-1' }] } : null
    repository.nationalLifeForesightReadRun.create = async ({ data }: { data: Record<string, unknown> }) => {
      created = true
      repository.run = { id: 'run-1', ...data }
      return { id: 'run-1' }
    }
    const store = createForesightRunStore(repository as never)

    await expect(
      Promise.all([
        store.start({ agentId: 'agent-1', deploymentScope: 'scope-1', mode: 'INVENTORY', now }),
        store.start({ agentId: 'agent-1', deploymentScope: 'scope-1', mode: 'INVENTORY', now }),
      ]),
    ).resolves.toEqual([
      { runId: 'run-1', jobId: 'job-1', duplicate: false },
      { runId: 'run-1', jobId: 'job-1', duplicate: true },
    ])
    expect(repository.transactionCalls).toBe(2)
    expect(repository.jobs).toHaveLength(1)
  })

  it('keeps inventory, detail, and different detail targets in separate active-run keys', async () => {
    const repository = createRepository()
    const store = createForesightRunStore(repository as never)

    await store.start({ agentId: 'agent-1', deploymentScope: 'scope-1', mode: 'INVENTORY', now })
    await store.start({
      agentId: 'agent-1', deploymentScope: 'scope-1', mode: 'DETAIL', targetCaseId: 'case-1', now,
    })
    await store.start({
      agentId: 'agent-1', deploymentScope: 'scope-1', mode: 'DETAIL', targetCaseId: 'case-2', now,
    })

    expect(repository.findFirstCalls.map((call) => call.where)).toEqual([
      expect.objectContaining({ mode: 'INVENTORY', targetCaseId: null }),
      expect.objectContaining({ mode: 'DETAIL', targetCaseId: 'case-1' }),
      expect.objectContaining({ mode: 'DETAIL', targetCaseId: 'case-2' }),
    ])
  })

  it('calculates progress using inventory and detail work with a zero-safe denominator', async () => {
    const repository = createRepository()
    const store = createForesightRunStore(repository as never)

    await store.updateProgress({
      runId: 'run-1',
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      patch: { totalCases: 2, inventoriedCases: 1, totalServices: 2, completedServices: 1 },
    })
    expect(repository.updates[0]).toMatchObject({
      totalCases: 2,
      inventoriedCases: 1,
      totalServices: 2,
      completedServices: 1,
    })

    const getStatus = createForesightRunStore({
      ...repository,
      nationalLifeForesightReadRun: {
        ...repository.nationalLifeForesightReadRun,
        findFirst: async () => ({
          id: 'run-1', state: 'RUNNING', totalCases: 2, inventoriedCases: 1,
          totalServices: 2, completedServices: 1, currentCaseName: null,
          currentService: null, completedAt: null,
        }),
      },
    } as never).getStatus

    await expect(getStatus('agent-1', 'scope-1')).resolves.toMatchObject({ percent: 50, shouldPoll: true })

    const zeroStatus = createForesightRunStore({
      ...repository,
      nationalLifeForesightReadRun: {
        ...repository.nationalLifeForesightReadRun,
        findFirst: async () => ({
          id: 'run-2', state: 'QUEUED', totalCases: 0, inventoriedCases: 0,
          totalServices: 0, completedServices: 0, currentCaseName: null,
          currentService: null, completedAt: null,
        }),
      },
    } as never).getStatus
    await expect(zeroStatus('agent-1', 'scope-1')).resolves.toMatchObject({ percent: 0 })
  })

  it('stops polling for paused and terminal runs', async () => {
    const repository = createRepository()
    const store = createForesightRunStore({
      ...repository,
      nationalLifeForesightReadRun: {
        ...repository.nationalLifeForesightReadRun,
        findFirst: async () => ({
          id: 'run-1', state: 'PAUSED', totalCases: 1, inventoriedCases: 0,
          totalServices: 0, completedServices: 0, currentCaseName: null,
          currentService: null, completedAt: null,
        }),
      },
    } as never)
    await expect(store.getStatus('agent-1', 'scope-1')).resolves.toMatchObject({ shouldPoll: false })
  })

  it('reconciles action-required and expired Foresight jobs to a paused run', async () => {
    const repository = createRepository()
    repository.active = {
      id: 'run-1',
      completedAt: null,
      jobs: [{
        state: 'ACTION_REQUIRED', safeErrorCode: 'FORESIGHT_SSO_EXPIRED', finishedAt: null,
        deploymentScope: 'scope-1',
      }],
    }

    await createForesightRunStore(repository as never).reconcile({
      runId: 'run-1', agentId: 'agent-1', deploymentScope: 'scope-1',
    })

    expect(repository.updates[0]).toMatchObject({ state: 'PAUSED', completedAt: null })
    expect(repository.findFirstCalls[0]).toMatchObject({
      where: expect.objectContaining({ id: 'run-1', agentId: 'agent-1', deploymentScope: 'scope-1' }),
    })
  })

  it('does not reconcile a job whose persisted scope differs from its run scope', async () => {
    const repository = createRepository()
    repository.active = {
      id: 'run-1',
      completedAt: null,
      jobs: [{ state: 'SUCCEEDED', safeErrorCode: null, finishedAt: now, deploymentScope: 'scope-other' }],
    }

    await createForesightRunStore(repository as never).reconcile({
      runId: 'run-1', agentId: 'agent-1', deploymentScope: 'scope-1',
    })

    expect(repository.updates).toEqual([])
  })

  it.each([
    ['FORESIGHT_SSO_EXPIRED', 'FAILED'],
    ['NATIONAL_LIFE_RECONNECT_REQUIRED', 'FAILED'],
    [null, 'WAITING_FOR_MFA'],
    [null, 'CREDENTIALS_EXPIRED'],
  ] as const)('pauses login-required job state %s / %s', async (safeErrorCode, state) => {
    const repository = createRepository()
    repository.active = {
      id: 'run-1',
      completedAt: null,
      jobs: [{ state, safeErrorCode, finishedAt: null, deploymentScope: 'scope-1' }],
    }

    await createForesightRunStore(repository as never).reconcile({
      runId: 'run-1', agentId: 'agent-1', deploymentScope: 'scope-1',
    })

    expect(repository.updates[0]).toMatchObject({ state: 'PAUSED', completedAt: null })
  })
})
