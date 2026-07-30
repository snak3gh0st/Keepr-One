// Pulls the per-statement commission detail: the actual earning breakdown and
// chargebacks behind each paid-commission row.
//
//   tsx scripts/national-life-sync-commission-detail.ts
//
// Drill-down links live inside the already-stored PAID_COMMISSIONS rows, so no
// re-fetch of the parent grid is needed. Read-only against the carrier; prints
// counts only, never row values.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { extractCommissionDetailLinks } from '../lib/national-life/commission-detail'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { fetchNationalLifeGrid, type GridPage } from '../lib/national-life/portal-grid-client'
import {
  persistReportRows,
  pruneStaleReportRows,
  toReportRows,
} from '../lib/national-life/report-row-service'
import { tryAcquireBrowserLock, releaseBrowserLock } from '../lib/national-life/browser-lock'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

async function main() {
  const env = getNationalLifeEnv()

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

  const statements = await prisma.nationalLifeReportRow.findMany({
    where: {
      agentId: stored.agentId,
      deploymentScope: env.sessionScopeId,
      gridKey: 'PAID_COMMISSIONS',
    },
    select: { rowKey: true, raw: true },
  })

  const links = statements.flatMap((statement) =>
    extractCommissionDetailLinks(statement.raw as Record<string, unknown>).map((link) => ({
      ...link,
      parentRowKey: statement.rowKey,
    })),
  )

  console.log(JSON.stringify({ statements: statements.length, detailLinks: links.length }))
  if (links.length === 0) {
    console.error(
      JSON.stringify({
        failed: 'no drill-down links found — run the PAID_COMMISSIONS sync first',
      }),
    )
    await prisma.$disconnect()
    return
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
  const touchedGridKeys = new Set<string>()
  let anyFailedOrTruncated = false

  try {
    for (const link of links) {
      // gridKey carries the statement id so each drill-down upserts separately
      // instead of overwriting the previous statement's detail.
      const gridKey = `COMMISSION_DETAIL_${link.kind}` as never
      try {
        const { rows, recordsTotal, truncated } = await fetchNationalLifeGrid(
          session.page as unknown as GridPage,
          link.path,
          env.portalLoginUrl,
        )
        const reportRows = toReportRows(gridKey, rows).map((row) => ({
          ...row,
          // Namespaced so two statements cannot collide on the same row key.
          rowKey: `${link.statementId}|${row.rowKey}`,
        }))
        const { written } = await persistReportRows({
          agentId: stored.agentId,
          deploymentScope: env.sessionScopeId,
          gridKey,
          rows: reportRows,
          fetchedAt,
        })
        touchedGridKeys.add(gridKey)
        if (truncated) {
          anyFailedOrTruncated = true
        }
        console.log(
          JSON.stringify({
            kind: link.kind,
            statementId: link.statementId.slice(0, 8),
            recordsTotal,
            rowsFetched: rows.length,
            truncated,
            written,
          }),
        )
      } catch (error) {
        anyFailedOrTruncated = true
        console.error(
          JSON.stringify({
            kind: link.kind,
            statementId: link.statementId.slice(0, 8),
            failed: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }

    // Only prune once every statement came back whole: otherwise rows that were
    // simply not fetched are indistinguishable from rows the carrier removed.
    if (!anyFailedOrTruncated && touchedGridKeys.size > 0) {
      const { deleted } = await pruneStaleReportRows({
        agentId: stored.agentId,
        deploymentScope: env.sessionScopeId,
        gridKeys: [...touchedGridKeys],
        fetchedAt,
      })
      console.log(JSON.stringify({ prunedStaleRows: deleted }))
    } else {
      console.error(
        JSON.stringify({
          skippedPrune: 'a statement failed or was truncated; stale rows kept',
        }),
      )
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
