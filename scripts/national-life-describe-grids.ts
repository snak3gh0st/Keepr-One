// Read-only discovery. Fetches ONE page of every known portal grid and prints the
// JSON key names plus recordsTotal, so mappings can be written against the real
// field names instead of guessed. Values are never printed: the grids hold real
// client and commission data.
//
//   tsx scripts/national-life-describe-grids.ts [GRID_KEY ...]
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import {
  NATIONAL_LIFE_GRIDS,
  fetchNationalLifeGrid,
  type GridPage,
  type NationalLifeGridKey,
} from '../lib/national-life/portal-grid-client'
import { prisma } from '../lib/prisma'
import { createSteelBrowserSession } from '../workers/national-life/steel-session'

/// Reports the type of a value without ever echoing it.
function typeOf(value: unknown) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'string') {
    if (/^\s*<[a-z]/i.test(value)) return 'html'
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(value)) return 'date-string'
    if (/^-?\$?[\d,]+\.?\d*$/.test(value.trim())) return 'numeric-string'
    return 'string'
  }
  return typeof value
}

async function main() {
  const env = getNationalLifeEnv()
  const known = Object.keys(NATIONAL_LIFE_GRIDS) as NationalLifeGridKey[]
  const requested = process.argv.slice(2)
  const gridKeys = requested.length > 0 ? (requested as NationalLifeGridKey[]) : known

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

  const session = await createSteelBrowserSession(env, { sessionContext })
  try {
    for (const gridKey of gridKeys) {
      const gridPath = NATIONAL_LIFE_GRIDS[gridKey]
      if (!gridPath) {
        console.error(JSON.stringify({ gridKey, failed: 'unknown grid key' }))
        continue
      }
      try {
        // One short page is enough to learn the shape.
        const { rows, recordsTotal } = await fetchNationalLifeGrid(
          session.page as unknown as GridPage,
          gridPath,
          env.portalLoginUrl,
          { pageSize: 1, maxRows: 1 },
        )
        const first = rows[0]
        console.log(
          JSON.stringify({
            gridKey,
            recordsTotal,
            fields: first
              ? Object.fromEntries(
                  Object.entries(first).map(([key, value]) => [key, typeOf(value)]),
                )
              : null,
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
