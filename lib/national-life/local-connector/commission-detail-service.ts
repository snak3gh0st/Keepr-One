import type { PrismaClient } from '@prisma/client'
import { NATIONAL_LIFE_PROVIDER } from '../constants'
import { extractNationalLifeCommissionEarningLinks } from '../commission-detail'
import { LOCAL_CONNECTOR_DEPLOYMENT_SCOPE } from './config'
import { LocalConnectorRunError } from './run-service'

type CommissionDetailDb = Pick<
  PrismaClient,
  'nationalLifeSyncRun' | 'nationalLifeRawGridPage'
>

export async function listNationalLifeCommissionEarningLinks(
  db: CommissionDetailDb,
  input: {
    agentId: string
    deviceId: string
    runId: string
  },
) {
  const run = await db.nationalLifeSyncRun.findFirst({
    where: {
      id: input.runId,
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      connectorDeviceId: input.deviceId,
      executionSource: 'LOCAL',
      provider: NATIONAL_LIFE_PROVIDER,
      state: 'RUNNING',
    },
    select: {
      plannedGridKeys: true,
      currentGridKey: true,
      stageCompletions: {
        where: { gridKey: 'PAID_COMMISSIONS' },
        select: { gridKey: true },
      },
    },
  })
  if (!run) throw new LocalConnectorRunError('RUN_NOT_FOUND')
  if (
    !run.plannedGridKeys.includes('COMMISSIONS_EARNING_REPORT') ||
    run.currentGridKey !== 'COMMISSIONS_EARNING_REPORT' ||
    run.stageCompletions.length === 0
  ) {
    throw new LocalConnectorRunError('GRID_NOT_PLANNED')
  }

  const pages = await db.nationalLifeRawGridPage.findMany({
    where: {
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      runId: input.runId,
      gridKey: 'PAID_COMMISSIONS',
    },
    orderBy: { sequence: 'asc' },
    select: { records: true },
  })
  const statements = pages.flatMap((page) => (
    Array.isArray(page.records)
      ? page.records
        .filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
        .map((row) => row as Record<string, unknown>)
      : []
  ))
  const links = extractNationalLifeCommissionEarningLinks(
    statements,
  )

  // Chrome storage is a convenience cursor, not durable truth. A worker can be
  // evicted between finishing one statement and persisting the next child-page
  // index. Rebuild that child cursor from the raw pages the server already
  // acknowledged, so a retry cannot replay a whole statement under new global
  // sequence numbers and inflate the carrier-received count.
  const detailPages = await db.nationalLifeRawGridPage.findMany({
    where: {
      agentId: input.agentId,
      deploymentScope: LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
      runId: input.runId,
      gridKey: 'COMMISSIONS_EARNING_REPORT',
    },
    orderBy: { sequence: 'asc' },
    select: { sequence: true, records: true },
  })
  const accepted = detailPages.flatMap((page) => (
    Array.isArray(page.records)
      ? page.records
        .filter((row) => typeof row === 'object' && row !== null && !Array.isArray(row))
        .map((row) => row as Record<string, unknown>)
      : []
  ))
  const lastStatementId = [...accepted].reverse().find((row) =>
    typeof row.CommissionStatementId === 'string' && row.CommissionStatementId.length > 0,
  )?.CommissionStatementId
  const lastSequence = detailPages.reduce((greatest, page) =>
    Number.isInteger(page.sequence) ? Math.max(greatest, page.sequence) : greatest,
  -1)
  const statementOffset = typeof lastStatementId === 'string'
    ? accepted.filter((row) => row.CommissionStatementId === lastStatementId).length
    : 0
  const resume = typeof lastStatementId === 'string' &&
    links.some((target) => target.statementId === lastStatementId) &&
    lastSequence >= 0
    ? {
        statementId: lastStatementId,
        statementOffset,
        baseOffset: accepted.length - statementOffset,
        sequence: lastSequence + 1,
        receivedRecordCount: accepted.length,
      }
    : undefined

  return {
    parentRows: statements.length,
    links,
    ...(resume ? { resume } : {}),
  }
}
