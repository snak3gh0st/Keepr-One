import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  nationalLifeSyncGridLabel,
  localStageCoverage,
  reconcileNationalLifeSync,
  getNationalLifeSyncStatus,
  startNationalLifeSync,
  summarizeStageReceipts,
} from './sync-run-service'

const now = new Date('2026-08-03T17:00:00.000Z')

describe('startNationalLifeSync', () => {
  it('hard-fails stale callers instead of creating a remote run', async () => {
    await expect(
      startNationalLifeSync({} as never, {
        agentId: 'agent-1',
        deploymentScope: 'scope-1',
        now,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_CONNECTOR_REQUIRED' })
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

  it('does not enqueue the retired remote sync from login completion', () => {
    const runtime = readFileSync(
      resolve(process.cwd(), 'workers/national-life/runtime.ts'),
      'utf8',
    )
    const interactive = readFileSync(
      resolve(process.cwd(), 'lib/national-life/interactive-connection-service.ts'),
      'utf8',
    )

    expect(runtime).not.toContain('startNationalLifeSync(transaction')
    expect(interactive).not.toContain('startNationalLifeSync(transaction')
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

describe('getNationalLifeSyncStatus', () => {
  it('does not expose a remote deployment scope as book-sync status', async () => {
    await expect(getNationalLifeSyncStatus('agent-1', 'SINGLE_DEPLOYMENT')).resolves.toBeNull()
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
      failedGridKeys: [],
      resumedAt: null,
      completions: [{ gridKey: 'NEW_BUSINESS', expectedRecordCount: 715, completedAt: now }],
    })).toEqual([
      expect.objectContaining({ gridKey: 'NEW_BUSINESS', state: 'VERIFIED', verifiedRecords: 715 }),
      expect.objectContaining({ gridKey: 'INFORCE_CLIENTS', state: 'READING', verifiedRecords: null }),
    ])
  })

  it('marks a discovery page captured without claiming it was reconciled', () => {
    expect(localStageCoverage({
      plannedGridKeys: ['AGENT_DASHBOARD'],
      totalStages: 1,
      currentGridKey: null,
      failedGridKeys: [],
      resumedAt: null,
      completions: [{ gridKey: 'AGENT_DASHBOARD', expectedRecordCount: 12, completedAt: now }],
    })).toEqual([
      expect.objectContaining({
        gridKey: 'AGENT_DASHBOARD',
        state: 'CAPTURED',
        verifiedRecords: 12,
      }),
    ])
  })

  it('marks only the exact isolated source as failed', () => {
    expect(localStageCoverage({
      plannedGridKeys: ['NEW_BUSINESS', 'PROJECTED_COMMISSIONS', 'INFORCE_CLIENTS'],
      totalStages: 3,
      currentGridKey: null,
      failedGridKeys: ['PROJECTED_COMMISSIONS'],
      resumedAt: null,
      completions: [
        { gridKey: 'NEW_BUSINESS', expectedRecordCount: 10, completedAt: now },
        { gridKey: 'INFORCE_CLIENTS', expectedRecordCount: 20, completedAt: now },
      ],
    }).map((stage) => [stage.gridKey, stage.state])).toEqual([
      ['NEW_BUSINESS', 'VERIFIED'],
      ['PROJECTED_COMMISSIONS', 'FAILED'],
      ['INFORCE_CLIENTS', 'VERIFIED'],
    ])
  })

  it('distinguishes verified areas reused after a resumed attempt', () => {
    const resumedAt = new Date('2026-08-04T19:00:00.000Z')
    expect(localStageCoverage({
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
      totalStages: 2,
      currentGridKey: 'INFORCE_CLIENTS',
      failedGridKeys: [],
      resumedAt,
      completions: [{
        gridKey: 'NEW_BUSINESS',
        expectedRecordCount: 859,
        completedAt: new Date('2026-08-04T18:00:00.000Z'),
      }],
    })).toEqual([
      expect.objectContaining({ gridKey: 'NEW_BUSINESS', state: 'REUSED', verifiedRecords: 859 }),
      expect.objectContaining({ gridKey: 'INFORCE_CLIENTS', state: 'READING' }),
    ])
  })

  /// A run reopened onto a stage that already failed is both the current stage
  /// and a failed one. READING won that tie, so the screen showed a source
  /// quietly being read while its recorded failure went unmentioned — the state
  /// most likely to need the agent's attention was the one it hid.
  it('reports a failed stage as failed even while it is the current one', () => {
    expect(localStageCoverage({
      plannedGridKeys: ['NEW_BUSINESS', 'INFORCE_CLIENTS'],
      totalStages: 2,
      currentGridKey: 'INFORCE_CLIENTS',
      failedGridKeys: ['INFORCE_CLIENTS'],
      resumedAt: null,
      completions: [],
    })).toEqual([
      expect.objectContaining({ gridKey: 'NEW_BUSINESS', state: 'PENDING' }),
      expect.objectContaining({ gridKey: 'INFORCE_CLIENTS', state: 'FAILED' }),
    ])
  })

})
