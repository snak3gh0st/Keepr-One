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

  // Both the statements and the chargeback rows carry drill-downs: the statement
  // links to the earning report, and each chargeback row links on to the debt
  // behind it.
  const statements = await prisma.nationalLifeReportRow.findMany({
    where: {
      agentId: stored.agentId,
      deploymentScope: env.sessionScopeId,
      gridKey: { in: ['PAID_COMMISSIONS', 'COMMISSION_DETAIL_CHARGEBACK'] },
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
  // Per grid, so a grid that came back empty can be excluded from the prune while
  // a grid that genuinely returned rows is still cleaned up.
  const writtenByGridKey = new Map<string, number>()
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
        writtenByGridKey.set(gridKey, (writtenByGridKey.get(gridKey) ?? 0) + written)
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

    // Prune only grids that actually produced rows this run.
    //
    // An empty-but-successful fetch is indistinguishable from "the carrier
    // deleted everything", and treating it as the latter destroyed all 5416
    // commission detail rows once: the drill-down `?id=` tokens expire, so every
    // request returned zero records without erroring. Writing nothing is never a
    // licence to delete.
    const prunableGridKeys = [...writtenByGridKey.entries()]
      .filter(([, written]) => written > 0)
      .map(([gridKey]) => gridKey)
    const emptyGridKeys = [...writtenByGridKey.entries()]
      .filter(([, written]) => written === 0)
      .map(([gridKey]) => gridKey)

    if (!anyFailedOrTruncated && prunableGridKeys.length > 0) {
      const { deleted } = await pruneStaleReportRows({
        agentId: stored.agentId,
        deploymentScope: env.sessionScopeId,
        gridKeys: prunableGridKeys,
        fetchedAt,
      })
      console.log(JSON.stringify({ prunedStaleRows: deleted, prunedGridKeys: prunableGridKeys }))
    }

    if (anyFailedOrTruncated || emptyGridKeys.length > 0) {
      console.error(
        JSON.stringify({
          skippedPrune: 'a fetch failed, was truncated, or returned nothing; stale rows kept',
          emptyGridKeys,
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
