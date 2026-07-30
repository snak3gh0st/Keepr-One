// Pulls the National Life agent-portal grids into NationalLifeCaseSnapshot using
// the stored authenticated session. Read-only against the carrier.
//
//   tsx scripts/national-life-sync-snapshots.ts [GRID_KEY ...]
//
// Defaults to every known grid. Prints counts only, never row values.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import {
  persistCaseSnapshots,
  toCaseSnapshots,
} from '../lib/national-life/case-snapshot-service'
import {
  NATIONAL_LIFE_GRIDS,
  fetchNationalLifeGrid,
  type GridPage,
  type NationalLifeGridKey,
} from '../lib/national-life/portal-grid-client'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

function resolveGridKeys(): NationalLifeGridKey[] {
  const requested = process.argv.slice(2)
  const known = Object.keys(NATIONAL_LIFE_GRIDS) as NationalLifeGridKey[]
  if (requested.length === 0) {
    return known
  }
  const unknown = requested.filter((key) => !known.includes(key as NationalLifeGridKey))
  if (unknown.length > 0) {
    throw new Error(`unknown grid keys: ${unknown.join(', ')} (known: ${known.join(', ')})`)
  }
  return requested as NationalLifeGridKey[]
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
      const gridPath = NATIONAL_LIFE_GRIDS[gridKey]
      try {
        const { rows, recordsTotal } = await fetchNationalLifeGrid(
          session.page as unknown as GridPage,
          gridPath,
          env.portalLoginUrl,
        )
        const snapshots = toCaseSnapshots(rows)
        const { written } = await persistCaseSnapshots({
          agentId: stored.agentId,
          deploymentScope: env.sessionScopeId,
          gridKey,
          snapshots,
          fetchedAt,
        })
        console.log(
          JSON.stringify({
            gridKey,
            recordsTotal,
            rowsFetched: rows.length,
            snapshots: snapshots.length,
            written,
          }),
        )
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
