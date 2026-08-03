import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentAgent } from '@/lib/agent-context'
import { NATIONAL_LIFE_PROVIDER } from '@/lib/national-life/constants'
import { isNationalLifeConfigured } from '@/lib/national-life/env'
import { carrierSyncState } from '@/lib/national-life/carrier-sync-state'

/// What the top bar asks once, on mount. Deliberately not a poll: the badge is
/// a reassurance, not a live monitor, and a request per agent per few seconds
/// buys nothing an agent would notice.
export async function GET() {
  if (!isNationalLifeConfigured()) {
    // No integration, no badge. Not every agent connects one.
    return NextResponse.json({ state: null })
  }
  try {
    const agent = await getCurrentAgent()
    const [working, blocked] = await Promise.all([
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
          // Only the park a carrier login actually revives — see
          // `releaseJobsBlockedOnCarrierLogin` in `job-service.ts`. Counting
          // `NATIONAL_LIFE_RECONNECT_REQUIRED` here too would tell the agent
          // that connecting clears the badge, and it would not: that code has
          // no path back to QUEUED. These two filters must not drift apart.
          safeErrorCode: 'FORESIGHT_SSO_EXPIRED',
        },
      }),
    ])
    return NextResponse.json({ state: carrierSyncState({ working, blocked }) })
  } catch {
    // A badge that does not know what it is saying is worse than no badge —
    // that is how the illustration reachability flag lied for hours.
    return NextResponse.json({ state: null })
  }
}
