// What the stored carrier context actually carries — shape only, never values.
//
//   tsx scripts/national-life-describe-session-context.ts
//
// The question it answers: when a human keeps the carrier logged in all day in
// their own Chrome, nothing expires. Our automation re-seeds a brand-new browser
// from a stored context on every job, and the illustration tool's Auth0 session
// dies within the hour. If what we carry across is *only cookies*, then every
// job presents a cookie without the browser state the identity provider expects
// — which is a much better explanation than either hypothesis recorded so far.
//
// Prints names, counts and hosts. Never a cookie value, never a storage value:
// this is session material for a real agent account.
import { decryptBrowserContext } from '../lib/national-life/browser-context-crypto'
import { getNationalLifeEnv } from '../lib/national-life/env'
import { prisma } from '../lib/prisma'

type Storage = Record<string, Record<string, string>> | undefined

/// Origins and key *names* per storage bucket. Values are deliberately dropped
/// before anything is returned, so a caller cannot print them by accident.
export function describeStorage(bucket: Storage): {
  origins: number
  keys: number
  sample: Record<string, string[]>
} {
  if (!bucket) return { origins: 0, keys: 0, sample: {} }
  const sample: Record<string, string[]> = {}
  let keys = 0
  for (const [origin, entries] of Object.entries(bucket)) {
    const names = Object.keys(entries ?? {})
    keys += names.length
    sample[origin] = names.slice(0, 12)
  }
  return { origins: Object.keys(bucket).length, keys, sample }
}

/// How many cookies sit on each host, so it is visible whether the identity
/// provider's own domain is represented at all.
export function describeCookies(
  cookies: ReadonlyArray<{ domain?: string; name?: string }> | undefined,
): Record<string, number> {
  const byDomain: Record<string, number> = {}
  for (const cookie of cookies ?? []) {
    const domain = cookie.domain ?? '(none)'
    byDomain[domain] = (byDomain[domain] ?? 0) + 1
  }
  return byDomain
}

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

  const context = decryptBrowserContext(
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
  ) as {
    cookies?: Array<{ domain?: string; name?: string }>
    localStorage?: Storage
    sessionStorage?: Storage
    indexedDB?: Record<string, unknown[]>
  }

  console.log(
    JSON.stringify(
      {
        topLevelKeys: Object.keys(context).sort(),
        cookiesByDomain: describeCookies(context.cookies),
        localStorage: describeStorage(context.localStorage),
        sessionStorage: describeStorage(context.sessionStorage),
        indexedDbOrigins: Object.keys(context.indexedDB ?? {}),
        connectedAt: stored.lastConnectedAt,
      },
      null,
      2,
    ),
  )

  await prisma.$disconnect()
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '\0')) {
  main().catch((error) => {
    console.error(JSON.stringify({ failed: String(error).slice(0, 400) }))
    process.exit(1)
  })
}
