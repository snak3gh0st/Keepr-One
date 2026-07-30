// Pulls National Life agent-portal grids into the case-snapshot / inforce-policy
// staging tables using the stored authenticated session. Read-only against the
// carrier.
//
//   tsx scripts/national-life-sync-snapshots.ts [GRID_KEY ...]
//
// Defaults to every grid confirmed to expose its data via GetJsonResult. Several
// registered paths (placement report, transfers/exchanges, payment history,
// every compensation page) do not fire that request today — see
// docs/operations/national-life-portal-contract.md — so they are opt-in only
// until that is understood. Prints counts only, never row values.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import {
  persistCaseSnapshots,
  toCaseSnapshots,
} from '../lib/national-life/case-snapshot-service'
import {
  persistInforcePolicies,
  toInforcePolicySnapshots,
} from '../lib/national-life/inforce-policy-service'
import {
  persistReportRows,
  toReportRows,
} from '../lib/national-life/report-row-service'
import {
  NATIONAL_LIFE_GRIDS,
  fetchNationalLifeGrid,
  type GridPage,
  type NationalLifeGridKey,
} from '../lib/national-life/portal-grid-client'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

const CASE_SNAPSHOT_GRIDS: readonly NationalLifeGridKey[] = ['NEW_BUSINESS', 'RECENTLY_CLOSED']
const INFORCE_POLICY_GRIDS: readonly NationalLifeGridKey[] = ['INFORCE_CLIENTS']
const REPORT_ROW_GRIDS: readonly NationalLifeGridKey[] = [
  'PAID_COMMISSIONS',
  'PROJECTED_COMMISSIONS',
]
const DEFAULT_GRIDS: readonly NationalLifeGridKey[] = [
  ...CASE_SNAPSHOT_GRIDS,
  ...INFORCE_POLICY_GRIDS,
  ...REPORT_ROW_GRIDS,
]

function resolveGridKeys(): NationalLifeGridKey[] {
  const requested = process.argv.slice(2)
  const known = Object.keys(NATIONAL_LIFE_GRIDS) as NationalLifeGridKey[]
  if (requested.length === 0) {
    return [...DEFAULT_GRIDS]
  }
  const unknown = requested.filter((key) => !known.includes(key as NationalLifeGridKey))
  if (unknown.length > 0) {
    throw new Error(`unknown grid keys: ${unknown.join(', ')} (known: ${known.join(', ')})`)
  }
  return requested as NationalLifeGridKey[]
}

async function syncGrid(
  gridKey: NationalLifeGridKey,
  page: GridPage,
  env: ReturnType<typeof getNationalLifeEnv>,
  agentId: string,
  fetchedAt: Date,
) {
  const gridPath = NATIONAL_LIFE_GRIDS[gridKey]
  const { rows, recordsTotal, truncated } = await fetchNationalLifeGrid(
    page,
    gridPath,
    env.portalLoginUrl,
  )
  const counts = { recordsTotal, rowsFetched: rows.length, truncated }

  if (REPORT_ROW_GRIDS.includes(gridKey)) {
    const reportRows = toReportRows(gridKey, rows)
    const { written } = await persistReportRows({
      agentId,
      deploymentScope: env.sessionScopeId,
      gridKey,
      rows: reportRows,
      fetchedAt,
    })
    return { ...counts, snapshots: reportRows.length, written }
  }

  if (INFORCE_POLICY_GRIDS.includes(gridKey)) {
    const snapshots = toInforcePolicySnapshots(rows)
    const { written } = await persistInforcePolicies({
      agentId,
      deploymentScope: env.sessionScopeId,
      snapshots,
      fetchedAt,
    })
    return { ...counts, snapshots: snapshots.length, written }
  }

  const snapshots = toCaseSnapshots(rows)
  const { written } = await persistCaseSnapshots({
    agentId,
    deploymentScope: env.sessionScopeId,
    gridKey,
    snapshots,
    fetchedAt,
  })
  return { ...counts, snapshots: snapshots.length, written }
}

async function main() {
  const env = getNationalLifeEnv()
  const gridKeys = resolveGridKeys()

  const stored = await prisma.agentIntegrationSession.findFirst({
    where: {
      provider: 'NATIONAL_LIFE',
      purpose: 'CARRIER_SESSION',
      status: 'CONNECTED',
      deploymentScope: env.sessionScopeId,
    },
    orderBy: { lastConnectedAt: 'desc' },
  })
  if (!stored) {
    throw new Error('no CONNECTED National Life session stored — connect in the app first')
  }
  if (!stored.keyVersion || !stored.iv || !stored.ciphertext || !stored.authTag) {
    throw new Error('stored National Life session is incomplete')
  }

  const sessionContext = decryptBrowserContext(
    {
      algorithm: 'aes-256-gcm',
      keyVersion: stored.keyVersion,
      iv: stored.iv,
      ciphertext: stored.ciphertext,
      authTag: stored.authTag,
    },
    {
      agentId: stored.agentId,
      scopeId: env.sessionScopeId,
      provider: 'NATIONAL_LIFE',
      purpose: 'AUTHENTICATED_BROWSER_CONTEXT',
      formatVersion: 1,
    },
    env.sessionKeys,
  )

  const session = await createSteelBrowserSession(env, { sessionContext })
  const fetchedAt = new Date()

  try {
    for (const gridKey of gridKeys) {
      try {
        const result = await syncGrid(
          gridKey,
          session.page as unknown as GridPage,
          env,
          stored.agentId,
          fetchedAt,
        )
        console.log(JSON.stringify({ gridKey, ...result }))
      } catch (error) {
        console.error(
          JSON.stringify({
            gridKey,
            failed: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }
  } finally {
    await session.close()
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
