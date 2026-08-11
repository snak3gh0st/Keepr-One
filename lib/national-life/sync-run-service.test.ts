import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  nationalLifeSyncGridLabel,
  localStageCoverage,
  reconcileNationalLifeSync,
  startNationalLifeSync,
  summarizeStageReceipts,
} from './sync-run-service'

const now = new Date('2026-08-03T17:00:00.000Z')

function createFakeTransaction() {
  const fake = {
    activeRun: null as { id: string; state: string } | null,
    createdRun: null as Record<string, unknown> | null,
    jobs: [] as Array<Record<string, unknown>>,
    nationalLifeSyncRun: {
      findFirst: async () => fake.activeRun,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        fake.createdRun = { id: 'run-1', ...data }
        return { id: 'run-1' }
      },
    },
    browserAutomationJob: {
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
        fake.jobs.push(...data)
        return { count: data.length }
      },
    },
  }
  return fake
}

describe('startNationalLifeSync', () => {
  it('creates one run and one ordered job for each fixed grid', async () => {
    const tx = createFakeTransaction()

    const result = await startNationalLifeSync(tx as never, {
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      now,
    })

    expect(result).toEqual({ runId: 'run-1', duplicate: false })
    expect(tx.jobs.map((job) => [job.syncStageIndex, job.syncGridKey])).toEqual([
      [0, 'NEW_BUSINESS'],
      [1, 'RECENTLY_CLOSED'],
      [2, 'INFORCE_CLIENTS'],
      [3, 'PAID_COMMISSIONS'],
      [4, 'PROJECTED_COMMISSIONS'],
      [5, 'CLIENT_INTELLIGENCE'],
      [6, 'CORRESPONDENCE'],
      [7, 'COMMISSIONS_PAYMENT_PORTAL'],
      [8, 'PIP_PENDING'],
      [9, 'TRANSFERS_EXCHANGES'],
      [10, 'LIFE_PENDING_LAPSE'],
      [11, 'COMMISSIONS_EARNING_REPORT'],
      [12, 'PAYABLE_GROSS_COMMISSIONS'],
    ])
    expect(tx.jobs.every((job) => job.operation === 'SYNC_NATIONAL_LIFE_GRID')).toBe(true)
  })

  it('does not create a second active run for the same agent and scope', async () => {
    const tx = createFakeTransaction()
    tx.activeRun = { id: 'run-existing', state: 'RUNNING' }

    await expect(
      startNationalLifeSync(tx as never, {
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        now,
      }),
    ).resolves.toEqual({ runId: 'run-existing', duplicate: true })
    expect(tx.jobs).toHaveLength(0)
  })

  it('reconciles child jobs into a partial run without exposing row data', async () => {
    let update: Record<string, unknown> | null = null
    const tx = {
      nationalLifeSyncRun: {
        findFirst: async () => ({
          startedAt: null,
          completedAt: null,
          jobs: [
            { state: 'SUCCEEDED', syncStageIndex: 0, syncGridKey: 'NEW_BUSINESS' },
            { state: 'FAILED', syncStageIndex: 1, syncGridKey: 'RECENTLY_CLOSED' },
          ],
        }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          update = data
          return { count: 1 }
        },
      },
      browserAutomationJob: {},
    }

    await reconcileNationalLifeSync(tx as never, {
      runId: 'run-1',
      agentId: 'agent-1',
      deploymentScope: 'scope-1',
      now,
    })

    expect(update).toMatchObject({
      state: 'PARTIAL',
      completedStages: 1,
      failedStages: 1,
      currentGridKey: null,
    })
    expect(nationalLifeSyncGridLabel('INFORCE_CLIENTS')).toBe('in-force policies')
  })

  it('is wired into both login completion transactions', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/national-life/runtime.ts'),
      'utf8',
    )
    const interactive = readFileSync(
      resolve(process.cwd(), 'lib/national-life/interactive-connection-service.ts'),
      'utf8',
    )

    expect(runtime).toContain('startNationalLifeSync(transaction')
    expect(interactive).toContain('startNationalLifeSync(transaction')
  })
})

describe('summarizeStageReceipts', () => {
  it('reports nothing when there is no receipt to read', () => {
    // Um run REMOTE não gera recibo. Dizer "0 gravadas" ali acusaria de vazio um
    // sync que funcionou.
    expect(summarizeStageReceipts([])).toEqual({
      receivedRecords: null,
      writtenRecords: null,
    })
  })

  it('exposes received-but-not-written instead of hiding it behind a success', () => {
    expect(
      summarizeStageReceipts([
        { recordCount: 200, writtenCount: 0 },
        { recordCount: 0, writtenCount: 0 },
      ]),
    ).toEqual({ receivedRecords: 200, writtenRecords: 0 })
  })

  it('adds up what was received and what survived normalization', () => {
    expect(
      summarizeStageReceipts([
        { recordCount: 120, writtenCount: 118 },
        { recordCount: 80, writtenCount: 80 },
      ]),
    ).toEqual({ receivedRecords: 200, writtenRecords: 198 })
  })

  it('keeps written unknown when every receipt predates the column', () => {
    expect(
      summarizeStageReceipts([
        { recordCount: 10, writtenCount: null },
        { recordCount: 5, writtenCount: null },
      ]),
    ).toEqual({ receivedRecords: 15, writtenRecords: null })
  })
})

describe('grid labels', () => {
  it('reads in English, because the agents are American', () => {
    for (const gridKey of [
      'NEW_BUSINESS',
      'RECENTLY_CLOSED',
      'INFORCE_CLIENTS',
      'PAID_COMMISSIONS',
      'PROJECTED_COMMISSIONS',
      'CLIENT_INTELLIGENCE',
      'CORRESPONDENCE',
      'COMMISSIONS_PAYMENT_PORTAL',
      'PIP_PENDING',
    ]) {
      const label = nationalLifeSyncGridLabel(gridKey)
      expect(label).toBeTruthy()
      expect(label).not.toMatch(/[áàâãéêíóôõúç]/i)
    }
  })
})

describe('local stage coverage', () => {
  it('only marks a portal area verified after its completion record exists', () => {
    expect(localStageCoverage({
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
      totalStages: 2,
      currentGridKey: 'INFORCE_CLIENTS',
      failedStages: 0,
      completions: [{ gridKey: 'NEW_BUSINESS', expectedRecordCount: 715 }],
    })).toEqual([
      expect.objectContaining({ gridKey: 'NEW_BUSINESS', state: 'VERIFIED', verifiedRecords: 715 }),
      expect.objectContaining({ gridKey: 'INFORCE_CLIENTS', state: 'READING', verifiedRecords: null }),
    ])
  })
})
