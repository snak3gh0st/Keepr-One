import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import {
  NATIONAL_LIFE_LOGIN_REQUIRED_CODES,
  NATIONAL_LIFE_PROVIDER,
} from '@/lib/national-life/constants'
import { carrierSyncState } from '@/lib/national-life/carrier-sync-state'
import {
  getNationalLifeLocalConnectorConfig,
  LOCAL_CONNECTOR_DEPLOYMENT_SCOPE,
} from '@/lib/national-life/local-connector/config'
import { getNationalLifeSyncStatus } from '@/lib/national-life/sync-run-service'
import { sanitizeNationalLifeSyncStatusForAgent } from '@/lib/national-life/plan-access'

/// What the top bar asks once, on mount. Deliberately not a poll: the badge is
/// a reassurance, not a live monitor, and a request per agent per few seconds
/// buys nothing an agent would notice.
export async function GET() {
  if (!getNationalLifeLocalConnectorConfig().enabled) {
    // No integration, no badge. Not every agent connects one.
    return NextResponse.json({ state: null })
  }
  try {
    const agent = await getCurrentAgent()
    const [working, blocked, rawSync] = await Promise.all([
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          state: { in: ['QUEUED', 'RUNNING', 'RETRYABLE'] },
        },
      }),
      prisma.browserAutomationJob.count({
        where: {
          agentId: agent.id,
          provider: NATIONAL_LIFE_PROVIDER,
          state: 'ACTION_REQUIRED',
          // Keep this filter identical to the transaction drain: every code
          // counted here is one a fresh carrier login actually revives.
          safeErrorCode: { in: [...NATIONAL_LIFE_LOGIN_REQUIRED_CODES] },
        },
      }),
      getNationalLifeSyncStatus(agent.id, LOCAL_CONNECTOR_DEPLOYMENT_SCOPE),
    ])
    const sync = await sanitizeNationalLifeSyncStatusForAgent(agent.id, rawSync)
    return NextResponse.json({
      state: carrierSyncState({ working, blocked }),
      ...(sync ? { sync } : {}),
    })
  } catch {
    // A badge that does not know what it is saying is worse than no badge —
    // that is how the illustration reachability flag lied for hours.
    return NextResponse.json({ state: null })
  }
}
