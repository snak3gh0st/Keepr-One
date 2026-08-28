import 'server-only'

import { prisma } from '@/lib/prisma'
import { planRawIngest } from './local-connector/raw-ingest'
import type { NationalLifeGridKey } from './portal-grid-client'
import type { NationalLifeSyncStatus } from './sync-run-service'
import {
  estimateSyncWindow,
  summarizeSyncDelta,
  type NationalLifeSyncDelta,
  type StageTimingHistory,
} from './sync-insights'

const TERMINAL_STATES = new Set(['COMPLETED', 'PARTIAL', 'FAILED'])
const timingCache = new Map<string, { expiresAt: number; history: StageTimingHistory[] }>()
const deltaCache = new Map<string, NationalLifeSyncDelta>()
const TIMING_CACHE_MS = 5 * 60_000

function samePlan(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function timingHistory(input: {
  agentId: string
  deploymentScope: string
  runId: string
  plannedGridKeys: readonly string[]
}): Promise<StageTimingHistory[]> {
  const key = `${input.agentId}:${input.deploymentScope}:${input.plannedGridKeys.join(',')}`
  const cached = timingCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.history

  const runs = await prisma.nationalLifeSyncRun.findMany({
    where: {
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      executionSource: 'LOCAL',
      state: 'COMPLETED',
      id: { not: input.runId },
      startedAt: { not: null },
    },
    orderBy: { completedAt: 'desc' },
    take: 8,
    select: {
      startedAt: true,
      plannedGridKeys: true,
      stageCompletions: {
        orderBy: { completedAt: 'asc' },
        select: { gridKey: true, completedAt: true },
      },
    },
  })
  const history = runs.flatMap((run) =>
    run.startedAt && samePlan(run.plannedGridKeys, input.plannedGridKeys)
      ? [{ startedAt: run.startedAt, completions: run.stageCompletions }]
      : [],
  ).slice(0, 3)
  timingCache.set(key, { expiresAt: Date.now() + TIMING_CACHE_MS, history })
  if (timingCache.size > 500) timingCache.delete(timingCache.keys().next().value!)
  return history
}

function groupedCounts(rows: readonly { gridKey: string; _count: { _all: number } }[]) {
  return Object.fromEntries(rows.map((row) => [row.gridKey, row._count._all]))
}

async function runDelta(input: {
  agentId: string
  deploymentScope: string
  runId: string
  startedAt: Date
  plannedGridKeys: readonly string[]
}): Promise<NationalLifeSyncDelta> {
  const cached = deltaCache.get(input.runId)
  if (cached) return cached

  const caseKeys: NationalLifeGridKey[] = []
  const reportKeys: NationalLifeGridKey[] = []
  let includesInforce = false
  for (const value of input.plannedGridKeys) {
    const gridKey = value as NationalLifeGridKey
    try {
      const target = planRawIngest(gridKey, []).target
      if (target === 'CASE_SNAPSHOT') caseKeys.push(gridKey)
      if (target === 'REPORT_ROW') reportKeys.push(gridKey)
      if (target === 'INFORCE_POLICY') includesInforce = true
    } catch {
      // Snapshot-only and newly discovered sources have no operational row delta.
    }
  }

  const emptyGroups: Array<{ gridKey: string; _count: { _all: number } }> = []
  const [newCases, refreshedCases, newReports, refreshedReports, newInforce, refreshedInforce, commissionRows] =
    await Promise.all([
      caseKeys.length > 0 ? prisma.nationalLifeCaseSnapshot.groupBy({
        by: ['gridKey'],
        where: {
          agentId: input.agentId, deploymentScope: input.deploymentScope,
          gridKey: { in: caseKeys }, fetchedAt: { gte: input.startedAt }, createdAt: { gte: input.startedAt },
        },
        _count: { _all: true },
      }) : emptyGroups,
      caseKeys.length > 0 ? prisma.nationalLifeCaseSnapshot.groupBy({
        by: ['gridKey'],
        where: {
          agentId: input.agentId, deploymentScope: input.deploymentScope,
          gridKey: { in: caseKeys }, fetchedAt: { gte: input.startedAt }, createdAt: { lt: input.startedAt },
        },
        _count: { _all: true },
      }) : emptyGroups,
      reportKeys.length > 0 ? prisma.nationalLifeReportRow.groupBy({
        by: ['gridKey'],
        where: {
          agentId: input.agentId, deploymentScope: input.deploymentScope,
          gridKey: { in: reportKeys }, fetchedAt: { gte: input.startedAt }, createdAt: { gte: input.startedAt },
        },
        _count: { _all: true },
      }) : emptyGroups,
      reportKeys.length > 0 ? prisma.nationalLifeReportRow.groupBy({
        by: ['gridKey'],
        where: {
          agentId: input.agentId, deploymentScope: input.deploymentScope,
          gridKey: { in: reportKeys }, fetchedAt: { gte: input.startedAt }, createdAt: { lt: input.startedAt },
        },
        _count: { _all: true },
      }) : emptyGroups,
      includesInforce ? prisma.nationalLifeInforcePolicy.count({
        where: {
          agentId: input.agentId, deploymentScope: input.deploymentScope,
          fetchedAt: { gte: input.startedAt }, createdAt: { gte: input.startedAt },
        },
      }) : 0,
      includesInforce ? prisma.nationalLifeInforcePolicy.count({
        where: {
          agentId: input.agentId, deploymentScope: input.deploymentScope,
          fetchedAt: { gte: input.startedAt }, createdAt: { lt: input.startedAt },
        },
      }) : 0,
      reportKeys.includes('COMMISSIONS_EARNING_REPORT')
        ? prisma.nationalLifeReportRow.findMany({
            where: {
              agentId: input.agentId,
              deploymentScope: input.deploymentScope,
              gridKey: 'COMMISSIONS_EARNING_REPORT',
              fetchedAt: { gte: input.startedAt },
              createdAt: { gte: input.startedAt },
            },
            select: { amounts: true },
          })
        : [],
    ])

  const addedBySource = {
    ...groupedCounts(newCases),
    ...groupedCounts(newReports),
    ...(includesInforce ? { INFORCE_CLIENTS: newInforce } : {}),
  }
  const refreshedBySource = {
    ...groupedCounts(refreshedCases),
    ...groupedCounts(refreshedReports),
    ...(includesInforce ? { INFORCE_CLIENTS: refreshedInforce } : {}),
  }
  const delta = summarizeSyncDelta({
    addedBySource,
    refreshedBySource,
    newCommissionAmounts: commissionRows.map((row) => {
      const amounts = row.amounts && typeof row.amounts === 'object' && !Array.isArray(row.amounts)
        ? row.amounts as Record<string, unknown>
        : {}
      return amounts.GrossCommEarned
    }),
  })
  deltaCache.set(input.runId, delta)
  if (deltaCache.size > 500) deltaCache.delete(deltaCache.keys().next().value!)
  return delta
}

export async function addNationalLifeSyncInsights(
  agentId: string,
  deploymentScope: string,
  status: NationalLifeSyncStatus,
): Promise<NationalLifeSyncStatus> {
  const plannedGridKeys = status.stageCoverage?.map((stage) => stage.gridKey) ?? []
  const completedGridKeys = status.stageCoverage
    ?.filter((stage) => ['VERIFIED', 'CAPTURED', 'REUSED'].includes(stage.state))
    .map((stage) => stage.gridKey) ?? []

  if (status.shouldPoll && plannedGridKeys.length > 0) {
    const history = await timingHistory({
      agentId, deploymentScope, runId: status.runId, plannedGridKeys,
    })
    return {
      ...status,
      estimate: estimateSyncWindow({ plannedGridKeys, completedGridKeys, history }),
    }
  }
  if (TERMINAL_STATES.has(status.state) && status.startedAt && plannedGridKeys.length > 0) {
    return {
      ...status,
      delta: await runDelta({
        agentId, deploymentScope, runId: status.runId,
        startedAt: status.startedAt, plannedGridKeys,
      }),
    }
  }
  return status
}
