import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { NATIONAL_LIFE_PROVIDER } from './constants'
import {
  NATIONAL_LIFE_SYNC_STAGES,
  syncProgressFromJobs,
  syncRunStateFromJobs,
  type NationalLifeSyncRunState,
} from './sync-progress'
import { expireStaleLocalConnectorRuns } from './local-connector/run-service'
import { NATIONAL_LIFE_DISCOVERY_PAGE_KEYS } from './read-coverage'
import { CANONICAL_NATIONAL_LIFE_SYNC } from './sync-engine'
import { addNationalLifeSyncInsights } from './sync-insights-prisma'
import type { NationalLifeSyncDelta, NationalLifeSyncEstimate } from './sync-insights'

export type StartNationalLifeSyncInput = {
  agentId: string
  deploymentScope: string
  now: Date
}

export type NationalLifeSyncRunTransaction = Pick<
  Prisma.TransactionClient,
  'nationalLifeSyncRun' | 'browserAutomationJob'
>

export type NationalLifeSyncStatus = {
  runId: string
  state: NationalLifeSyncRunState
  completed: number
  total: number
  percent: number
  failed: number
  currentGridKey: string | null
  currentGridLabel: string | null
  safeErrorCode: string | null
  shouldPoll: boolean
  startedAt?: Date | null
  completedAt: Date | null
  /// Linhas que o dispositivo entregou e linhas que sobreviveram à normalização.
  /// Nulo quando não há recibo nenhum para consultar — um run REMOTE não gera
  /// recibos, e dizer "0 gravadas" ali seria acusar de vazio um sync que deu
  /// certo. Com número, o par expõe o caso que motivou a coluna: recebi 200,
  /// escrevi 0.
  receivedRecords: number | null
  writtenRecords: number | null
  /// Why received and written disagree, split by what the difference means. A
  /// duplicate is the source listing one policy once per coverage, merged at no
  /// cost; a rejected row had no policy number to key on and is gone. Reporting
  /// only the gap would leave the agent unable to tell the two apart.
  duplicateRecords: number | null
  rejectedRecords: number | null
  /// The per-area truth behind the headline counter. A local run only becomes
  /// VERIFIED after the connector reconciles all its pages with recordsTotal.
  stageCoverage?: NationalLifeStageCoverage[]
  estimate?: NationalLifeSyncEstimate | null
  delta?: NationalLifeSyncDelta | null
}

export type NationalLifeStageCoverage = {
  gridKey: string
  label: string | null
  state: 'PENDING' | 'READING' | 'CAPTURED' | 'VERIFIED' | 'REUSED' | 'FAILED'
  verifiedRecords: number | null
  verifiedAt?: Date | null
}

/// Rótulos em inglês: quem lê é um agente americano.
const GRID_LABELS: Record<string, string> = {
  NEW_BUSINESS: 'new business',
  RECENTLY_CLOSED: 'recently closed cases',
  INFORCE_CLIENTS: 'in-force policies',
  PAID_COMMISSIONS: 'paid commissions',
  PROJECTED_COMMISSIONS: 'projected commissions',
  CLIENT_INTELLIGENCE: 'client intelligence',
  CORRESPONDENCE: 'correspondence',
  COMMISSIONS_PAYMENT_PORTAL: 'commission payments',
  PIP_PENDING: 'pending increases',
  TRANSFERS_EXCHANGES: 'transfers and exchanges',
  LIFE_PENDING_LAPSE: 'pending lapse policies',
  COMMISSIONS_EARNING_REPORT: 'commission earning detail',
  PAYABLE_GROSS_COMMISSIONS: 'payable gross commissions',
  AGENT_DASHBOARD: 'agent dashboard',
  PREMIUM_REPORT_AGENCY: 'premium report',
  POLICY_PAYMENT_HISTORY: 'policy payment history',
  LIFE_PERSISTENCY: 'life persistency',
  PENDING_GROSS_COMMISSIONS: 'pending gross commissions',
  COMMISSIONS_OVERVIEW: 'commission overview',
  COMMISSIONS_POLICY_HISTORY: 'policy commission history',
  PLACEMENT_REPORT: 'placement report',
  DAILY_UNIT_VALUES: 'daily unit values',
  PIP_CONTRIBUTION_INCREASE: 'PIP contribution increases',
  ANNUITY_PAST_DUE_CONTRIBUTIONS: 'past-due annuity contributions',
  ANNUITY_PAYROLL_FLOW_CHANGES: 'annuity payroll flow changes',
  INFORMAL_REQUESTS: 'informal requests',
  TRANSFER_COMPANY_INFORMATION: 'transfer company information',
}

const DISCOVERY_PAGE_KEYS = new Set<string>(NATIONAL_LIFE_DISCOVERY_PAGE_KEYS)

export function nationalLifeSyncGridLabel(gridKey: string | null): string | null {
  return gridKey ? GRID_LABELS[gridKey] ?? null : null
}

export function localStageCoverage(input: {
  plannedGridKeys: readonly string[]
  totalStages: number
  currentGridKey: string | null
  failedGridKeys: readonly string[]
  resumedAt: Date | null
  completions: ReadonlyArray<{
    gridKey: string
    expectedRecordCount: number
    completedAt: Date
  }>
}): NationalLifeStageCoverage[] {
  const planned = input.plannedGridKeys.length > 0
    ? input.plannedGridKeys
    : NATIONAL_LIFE_SYNC_STAGES.slice(0, input.totalStages)
  const completed = new Map(input.completions.map((row) => [row.gridKey, row]))
  return planned.map((gridKey) => ({
    gridKey,
    label: nationalLifeSyncGridLabel(gridKey),
    state: completed.has(gridKey)
      ? input.resumedAt &&
          completed.get(gridKey)!.completedAt.getTime() < input.resumedAt.getTime()
        ? 'REUSED'
        : DISCOVERY_PAGE_KEYS.has(gridKey) ? 'CAPTURED' : 'VERIFIED'
      // Failure outranks currency. A run reopened onto a stage that already
      // failed is both, and letting READING win hid the recorded failure behind
      // a source that looked like it was simply being read.
      : input.failedGridKeys.includes(gridKey)
        ? 'FAILED'
        : gridKey === input.currentGridKey
          ? 'READING'
          : 'PENDING',
    verifiedRecords: completed.get(gridKey)?.expectedRecordCount ?? null,
    verifiedAt: completed.get(gridKey)?.completedAt ?? null,
  }))
}

export type StageReceiptTotals = {
  receivedRecords: number | null
  writtenRecords: number | null
  duplicateRecords: number | null
  rejectedRecords: number | null
}

/// `writtenCount` é opcional no schema: recibos anteriores à coluna são nulos.
/// Somá-los como zero transformaria "não sei" em "não escrevi nada", que é a
/// mentira oposta à que a coluna existe para evitar.
/// The gap between received and written has two causes that mean opposite
/// things, and reporting only the gap forces the reader to guess which. A
/// duplicate is a row the source repeated — new business lists a policy once per
/// coverage — and collapsing it costs nothing. A rejected row had no policy
/// number to key on and is simply gone. Both are counted per receipt already;
/// summing them here is what carries that distinction to the screen.
///
/// Unlike `writtenCount`, both columns are non-null with a zero default, so a
/// sum of zero means zero rather than "no receipt knew".
export function summarizeStageReceipts(
  receipts: ReadonlyArray<{
    recordCount: number
    writtenCount: number | null
    duplicateCount: number
    rejectedCount: number
  }>,
): StageReceiptTotals {
  if (receipts.length === 0) {
    return {
      receivedRecords: null,
      writtenRecords: null,
      duplicateRecords: null,
      rejectedRecords: null,
    }
  }
  const known = receipts.filter((receipt) => typeof receipt.writtenCount === 'number')
  return {
    receivedRecords: receipts.reduce((total, receipt) => total + receipt.recordCount, 0),
    writtenRecords:
      known.length === 0
        ? null
        : known.reduce((total, receipt) => total + (receipt.writtenCount ?? 0), 0),
    duplicateRecords: receipts.reduce((total, receipt) => total + receipt.duplicateCount, 0),
    rejectedRecords: receipts.reduce((total, receipt) => total + receipt.rejectedCount, 0),
  }
}

/**
 * @deprecated The remote grid engine is retired. National Life book syncs are
 * started by the local connector run service, after KeeproneConnect is paired.
 * Keep this symbol as a hard failure for stale callers instead of allowing a
 * login flow or an operator script to enqueue a second source of truth.
 */
export async function startNationalLifeSync(
  tx: NationalLifeSyncRunTransaction,
  input: StartNationalLifeSyncInput,
): Promise<never> {
  void tx
  void input
  throw Object.assign(new Error('National Life book sync requires KeeproneConnect'), {
    code: 'LOCAL_CONNECTOR_REQUIRED',
  })
}

type ReconcileInput = StartNationalLifeSyncInput & { runId: string }

export async function reconcileNationalLifeSync(
  tx: NationalLifeSyncRunTransaction,
  input: ReconcileInput,
): Promise<void> {
  const run = await tx.nationalLifeSyncRun.findFirst({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'REMOTE',
    },
    select: {
      startedAt: true,
      completedAt: true,
      plannedGridKeys: true,
      jobs: {
        select: { state: true, syncStageIndex: true, syncGridKey: true },
        orderBy: { syncStageIndex: 'asc' },
      },
    },
  })
  if (!run) {
    return
  }

  const progress = syncProgressFromJobs(run.jobs)
  const state = syncRunStateFromJobs(run.jobs)
  const terminal = state === 'COMPLETED' || state === 'PARTIAL' || state === 'FAILED'
  await tx.nationalLifeSyncRun.updateMany({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: input.deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: 'REMOTE',
    },
    data: {
      state,
      completedStages: progress.completed,
      failedStages: progress.failed,
      currentGridKey: progress.currentGridKey,
      startedAt:
        run.startedAt ?? (state === 'RUNNING' || terminal ? input.now : undefined),
      completedAt: terminal ? run.completedAt ?? input.now : null,
      updatedAt: input.now,
    },
  })
}

export async function getNationalLifeSyncStatus(
  agentId: string,
  deploymentScope: string,
): Promise<NationalLifeSyncStatus | null> {
  if (deploymentScope !== CANONICAL_NATIONAL_LIFE_SYNC.deploymentScope) {
    return null
  }
  await expireStaleLocalConnectorRuns(prisma, { agentId })
  const run = await prisma.nationalLifeSyncRun.findFirst({
    where: {
      agentId,
      deploymentScope,
      provider: NATIONAL_LIFE_PROVIDER,
      executionSource: CANONICAL_NATIONAL_LIFE_SYNC.executionSource,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      state: true,
      executionSource: true,
      completedStages: true,
      totalStages: true,
      failedStages: true,
      currentGridKey: true,
      plannedGridKeys: true,
      safeErrorCode: true,
      startedAt: true,
      completedAt: true,
      jobs: {
        select: { state: true, syncStageIndex: true, syncGridKey: true },
        orderBy: { syncStageIndex: 'asc' },
      },
      stageReceipts: {
        select: {
          recordCount: true,
          writtenCount: true,
          duplicateCount: true,
          rejectedCount: true,
        },
      },
      stageCompletions: {
        select: { gridKey: true, expectedRecordCount: true, completedAt: true },
      },
      stageFailures: {
        where: { resolvedAt: null },
        select: { gridKey: true },
      },
    },
  })
  if (!run) {
    return null
  }

  const totals = summarizeStageReceipts(run.stageReceipts)

  if (run.executionSource === 'LOCAL') {
    const completed = run.completedStages
    const total = run.totalStages
    const status: NationalLifeSyncStatus = {
      runId: run.id,
      state: run.state as NationalLifeSyncRunState,
      completed,
      total,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100),
      failed: run.failedStages,
      currentGridKey: run.currentGridKey,
      currentGridLabel: nationalLifeSyncGridLabel(run.currentGridKey),
      safeErrorCode: run.safeErrorCode,
      shouldPoll: run.state === 'QUEUED' || run.state === 'RUNNING' || run.state === 'PAUSED',
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      ...totals,
      stageCoverage: localStageCoverage({
        plannedGridKeys: run.plannedGridKeys,
        totalStages: total,
        currentGridKey: run.currentGridKey,
        failedGridKeys: run.stageFailures.map((failure) => failure.gridKey),
        resumedAt: run.startedAt,
        completions: run.stageCompletions,
      }),
    }
    return addNationalLifeSyncInsights(agentId, deploymentScope, status)
  }

  const progress = syncProgressFromJobs(run.jobs)
  const state = run.state as NationalLifeSyncRunState
  const status: NationalLifeSyncStatus = {
    runId: run.id,
    state,
    ...progress,
    currentGridLabel: nationalLifeSyncGridLabel(progress.currentGridKey),
    safeErrorCode: run.safeErrorCode,
    shouldPoll: state === 'QUEUED' || state === 'RUNNING' || state === 'PAUSED',
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    ...totals,
    stageCoverage: run.jobs.map((job) => ({
      gridKey: job.syncGridKey ?? 'UNKNOWN',
      label: nationalLifeSyncGridLabel(job.syncGridKey ?? null),
      state: job.state === 'SUCCEEDED' ? 'VERIFIED' : job.state === 'FAILED' ? 'FAILED' : job.syncGridKey === progress.currentGridKey ? 'READING' : 'PENDING',
      verifiedRecords: null,
      verifiedAt: job.state === 'SUCCEEDED' ? run.completedAt : null,
    })),
  }
  return addNationalLifeSyncInsights(agentId, deploymentScope, status)
}
