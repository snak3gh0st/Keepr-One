// Extracts portal reports that are server-rendered rather than served through
// GetJsonResult — the premium report and the commission overview both are.
//
//   tsx scripts/national-life-sync-rendered-report.ts PREMIUM_REPORT_AGENCY
//
// Read-only against the carrier. Prints counts only, never cell values.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { NATIONAL_LIFE_GRIDS, type NationalLifeGridKey } from '../lib/national-life/portal-grid-client'
import { monetaryCells, parseRenderedTable } from '../lib/national-life/rendered-table'
import { persistReportRows, pruneStaleReportRows } from '../lib/national-life/report-row-service'
import { tryAcquireBrowserLock, releaseBrowserLock } from '../lib/national-life/browser-lock'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

async function main() {
  const env = getNationalLifeEnv()
  const requested = process.argv.slice(2) as NationalLifeGridKey[]
  const gridKeys = requested.length > 0 ? requested : (['PREMIUM_REPORT_AGENCY'] as NationalLifeGridKey[])

  const stored = await prisma.agentIntegrationSession.findFirst({
    where: {
      provider: 'NATIONAL_LIFE',
      purpose: 'CARRIER_SESSION',
      status: 'CONNECTED',
      deploymentScope: env.sessionScopeId,
    },
    orderBy: { lastConnectedAt: 'desc' },
  })
  if (!stored?.keyVersion || !stored.iv || !stored.ciphertext || !stored.authTag) {
    throw new Error('no usable CONNECTED National Life session stored')
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

  if (!(await tryAcquireBrowserLock(prisma))) {
    console.error(JSON.stringify({ failed: 'another carrier browser job is running' }))
    await prisma.$disconnect()
    return
  }

  const session = await createSteelBrowserSession(env, { sessionContext })
  const fetchedAt = new Date()

  try {
    for (const gridKey of gridKeys) {
      const path = NATIONAL_LIFE_GRIDS[gridKey]
      if (!path) {
        console.error(JSON.stringify({ gridKey, failed: 'unknown grid key' }))
        continue
      }
      try {
        await session.page.goto(new URL(path, env.portalLoginUrl).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 45_000,
        })
        await session.page.waitForTimeout(7_000)

        const table = parseRenderedTable(await session.page.content())
        if (!table || table.rows.length === 0) {
          console.error(JSON.stringify({ gridKey, failed: 'no rendered table found' }))
          continue
        }

        const rows = table.rows.map((row, index) => ({
          // Positional: these reports have no identifier column, and the row's
          // meaning is its position (year, period) which is stable across runs.
          rowKey: `row-${index}`,
          primaryDate: row.YTD ?? row.Year ?? null,
          label: Object.values(row)[0] ?? null,
          amounts: monetaryCells(row),
          raw: row,
        }))

        const { written } = await persistReportRows({
          agentId: stored.agentId,
          deploymentScope: env.sessionScopeId,
          gridKey,
          rows,
          fetchedAt,
        })
        const { deleted } = await pruneStaleReportRows({
          agentId: stored.agentId,
          deploymentScope: env.sessionScopeId,
          gridKeys: [gridKey],
          fetchedAt,
        })

        console.log(
          JSON.stringify({
            gridKey,
            headers: table.headers.length,
            rows: rows.length,
            withAmounts: rows.filter((row) => Object.keys(row.amounts).length > 0).length,
            written,
            prunedStaleRows: deleted,
          }),
        )
      } catch (error) {
        console.error(
          JSON.stringify({
            gridKey,
            failed: error instanceof Error ? error.message.split('\n')[0] : String(error),
          }),
        )
      }
    }
  } finally {
    await session.close()
    await releaseBrowserLock(prisma)
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
  process.exit(1)
})
