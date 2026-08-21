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

  return {
    parentRows: statements.length,
    links,
  }
}
